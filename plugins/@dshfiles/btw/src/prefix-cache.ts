import { Option, Schema } from 'effect'

const usageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.optional(Schema.Number),
  cacheWriteTokens: Schema.optional(Schema.Number),
})
const streamUsageSchema = Schema.Struct({ chunk: Schema.Struct({ type: Schema.Literal('usage'), usage: usageSchema }) })
const eventSchema = Schema.Struct({ type: Schema.String, data: Schema.Unknown })
const assistantSchema = Schema.Struct({ usage: Schema.optional(usageSchema), stream: Schema.optional(Schema.Array(Schema.Unknown)) })

export interface PrefixCacheReading {
  /** Uncached input, cache reads and cache writes of the side chat's first model request. */
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** cacheRead / (input + cacheRead + cacheWrite), as @dshfiles/usage computes its cache hit ratio. */
  readonly cacheReadShare: number
}

/** How much of a side chat's first request the provider served from its prefix cache. */
export class PrefixCache {
  /**
   * The first `assistant/message` after the fork seed ends (`session/end-seed`): the seed copies the source's own
   * requests, which must not count. Undefined until that request reports usage.
   */
  static firstRequestAfterFork(events: readonly unknown[]): PrefixCacheReading | undefined {
    let afterSeed = false
    for (const raw of events) {
      const event = Schema.decodeUnknownOption(eventSchema)(raw)
      if (Option.isNone(event)) continue
      if (event.value.type === 'session/end-seed') afterSeed = true
      if (!afterSeed || event.value.type !== 'assistant/message') continue
      const message = Schema.decodeUnknownOption(assistantSchema)(event.value.data)
      if (Option.isNone(message)) return undefined
      const usage =
        message.value.usage ??
        message.value.stream?.flatMap(entry => {
          const parsed = Schema.decodeUnknownOption(streamUsageSchema)(entry)
          return Option.isSome(parsed) ? [parsed.value.chunk.usage] : []
        })[0]
      if (usage === undefined) return undefined
      const cacheReadTokens = usage.cacheReadTokens ?? 0
      const cacheWriteTokens = usage.cacheWriteTokens ?? 0
      const total = usage.inputTokens + cacheReadTokens + cacheWriteTokens
      return { inputTokens: usage.inputTokens, cacheReadTokens, cacheWriteTokens, cacheReadShare: total === 0 ? 0 : cacheReadTokens / total }
    }
    return undefined
  }
}
