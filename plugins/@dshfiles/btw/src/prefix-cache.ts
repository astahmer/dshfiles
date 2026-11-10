import { Option, Schema } from 'effect'

const usageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.optional(Schema.Number),
  cacheWriteTokens: Schema.optional(Schema.Number),
})
const streamUsageSchema = Schema.Struct({ chunk: Schema.Struct({ type: Schema.Literal('usage'), usage: usageSchema }) })
const eventSchema = Schema.Struct({ type: Schema.String, data: Schema.Unknown })
type PrefixCacheEvent = Schema.Schema.Type<typeof eventSchema>
// oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the native event window hands over unknown JSON and the schema parses it
const eventOf = (raw: unknown): Option.Option<PrefixCacheEvent> => Schema.decodeUnknownOption(eventSchema)(raw)
const assistantSchema = Schema.Struct({ usage: Schema.optional(usageSchema), stream: Schema.optional(Schema.Array(Schema.Unknown)) })

export interface PrefixCacheReading {
  /** Uncached input, cache reads and cache writes of the side chat's first model request. */
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** cacheRead / (input + cacheRead + cacheWrite), as @dshfiles/usage computes its cache hit ratio. */
  readonly cacheReadShare: number
}

interface EventWindow {
  readonly entries: readonly { readonly event: unknown }[]
  readonly change: { readonly kind: string }
}

/** One pass over a side chat's events; done once an `assistant/message` after the fork seed decided the reading. */
class PrefixCacheScan {
  private afterSeed = false
  private settled = false
  private value: PrefixCacheReading | undefined

  get done(): boolean {
    return this.settled
  }

  get reading(): PrefixCacheReading | undefined {
    return this.value
  }

  readonly feed = (event: PrefixCacheEvent): void => {
    if (this.settled) return
    if (event.type === 'session/end-seed') {
      this.afterSeed = true
      return
    }
    if (!this.afterSeed || event.type !== 'assistant/message') return
    this.settled = true
    const message = Schema.decodeUnknownOption(assistantSchema)(event.data)
    if (Option.isNone(message)) return
    const usage =
      message.value.usage ??
      message.value.stream?.flatMap(entry => {
        const parsed = Schema.decodeUnknownOption(streamUsageSchema)(entry)
        return Option.isSome(parsed) ? [parsed.value.chunk.usage] : []
      })[0]
    if (usage === undefined) return
    const cacheReadTokens = usage.cacheReadTokens ?? 0
    const cacheWriteTokens = usage.cacheWriteTokens ?? 0
    const total = usage.inputTokens + cacheReadTokens + cacheWriteTokens
    this.value = { inputTokens: usage.inputTokens, cacheReadTokens, cacheWriteTokens, cacheReadShare: total === 0 ? 0 : cacheReadTokens / total }
  }
}

/** How much of a side chat's first request the provider served from its prefix cache. */
export class PrefixCache {
  /**
   * The first `assistant/message` after the fork seed ends (`session/end-seed`): the seed copies the source's own
   * requests, which must not count. Undefined until that request reports usage.
   */
  static firstRequestAfterFork(events: readonly unknown[]): PrefixCacheReading | undefined {
    const scan = new PrefixCacheScan()
    for (const raw of events) {
      const event = eventOf(raw)
      if (Option.isSome(event)) scan.feed(event.value)
      if (scan.done) break
    }
    return scan.reading
  }
}

/**
 * One side chat's reading, kept across the ticks of its growing event window. `append` is the only change that leaves
 * the scanned prefix untouched, so any other change (a replaced window, a prepended history page, a settled attempt)
 * starts a fresh scan. The reading describes a request that already happened, so it never changes once found.
 */
export class PrefixCacheReader {
  private window: EventWindow | undefined
  private scan = new PrefixCacheScan()
  private scanned = 0

  read(window: EventWindow): PrefixCacheReading | undefined {
    if (this.window === window || this.scan.done) return this.scan.reading
    if (window.change.kind !== 'append' || window.entries.length !== this.scanned + 1) {
      this.scan = new PrefixCacheScan()
      this.scanned = 0
    }
    for (let index = this.scanned; index < window.entries.length; index += 1) {
      const entry = window.entries[index]
      const event = entry === undefined ? Option.none<PrefixCacheEvent>() : eventOf(entry.event)
      if (Option.isSome(event)) this.scan.feed(event.value)
      if (this.scan.done) break
    }
    this.scanned = window.entries.length
    this.window = window
    return this.scan.reading
  }
}
