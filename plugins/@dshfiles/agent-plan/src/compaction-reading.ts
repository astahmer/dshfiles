import { Schema } from 'effect'

/** The native token meter's `contextPressure` projection, read structurally: an older Host may publish less. */
export const ContextPressure = Schema.Struct({
  pressureTokens: Schema.optional(Schema.Finite),
  projectedTokens: Schema.optional(Schema.Finite),
  contextWindow: Schema.optional(Schema.Finite),
})

export type ContextPressure = typeof ContextPressure.Type

export interface CompactionReadingFacts {
  /** Tokens left before automatic compaction; 0 once the next step will compact. */
  readonly remainingTokens: number
  readonly thresholdTokens: number
  readonly contextWindow: number
  /** The trigger as a share of the window, the way the context ring shows occupancy. */
  readonly thresholdPercent: number
  readonly due: boolean
}

const compactTokens = (tokens: number): string => {
  if (tokens < 1_000) return String(Math.round(tokens))
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}K`
  return `${Math.round(tokens / 100_000) / 10}M`
}

export class CompactionReading {
  /** The live prompt size the context ring shows: the projected next request, else the newest provider sample. */
  static readonly usedTokens = (pressure: ContextPressure | undefined): number | undefined => pressure?.projectedTokens ?? pressure?.pressureTokens

  static readonly of = (input: {
    readonly usedTokens: number | undefined
    readonly thresholdTokens: number
    readonly contextWindow: number
    readonly auto: boolean
  }): CompactionReadingFacts | null => {
    if (!input.auto || input.usedTokens === undefined || input.contextWindow <= 0) return null
    const remainingTokens = Math.max(0, input.thresholdTokens - input.usedTokens)
    return {
      remainingTokens,
      thresholdTokens: input.thresholdTokens,
      contextWindow: input.contextWindow,
      thresholdPercent: Math.round((input.thresholdTokens / input.contextWindow) * 100),
      due: remainingTokens === 0,
    }
  }

  static readonly label = (reading: CompactionReadingFacts): string =>
    reading.due ? 'compacts next step' : `compacts in ~${compactTokens(reading.remainingTokens)}`

  static readonly detail = (reading: CompactionReadingFacts): string =>
    `Automatic compaction at ~${compactTokens(reading.thresholdTokens)} of ${compactTokens(reading.contextWindow)} (${reading.thresholdPercent}%). Run /compact to compact now.`
}
