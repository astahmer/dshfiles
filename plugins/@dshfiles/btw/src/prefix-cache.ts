import { z } from 'zod'

const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
})
const streamUsageSchema = z.object({ chunk: z.object({ type: z.literal('usage'), usage: usageSchema }) })
const eventSchema = z.object({ type: z.string(), data: z.unknown() })
const assistantSchema = z.object({ usage: usageSchema.optional(), stream: z.array(z.unknown()).optional() })

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
      const event = eventSchema.safeParse(raw)
      if (!event.success) continue
      if (event.data.type === 'session/end-seed') afterSeed = true
      if (!afterSeed || event.data.type !== 'assistant/message') continue
      const message = assistantSchema.safeParse(event.data.data)
      if (!message.success) return undefined
      const usage =
        message.data.usage ??
        message.data.stream?.flatMap(entry => {
          const parsed = streamUsageSchema.safeParse(entry)
          return parsed.success ? [parsed.data.chunk.usage] : []
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
