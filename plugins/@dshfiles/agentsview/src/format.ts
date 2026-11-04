import type { TokenTotals } from './types.js'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** Pure presentation helpers for the panel, kept out of the components so they stay unit-testable. */
export class SessionFormat {
  static readonly count = (value: number): string => compact.format(value)

  /** Input counts what the model had to read fresh (uncached plus cache writes); cached reads are listed apart. */
  static readonly tokens = (tokens: TokenTotals) => ({
    input: SessionFormat.count(tokens.input + tokens.cacheWrite),
    output: SessionFormat.count(tokens.output),
    cached: SessionFormat.count(tokens.cacheRead),
  })

  /** A working directory shown in a row: the last two segments, since the leading home path is the same for every row. */
  static readonly shortPath = (path: string | null): string | null => {
    if (path === null) return null
    const parts = path.split('/').filter(part => part.length > 0)
    return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`
  }
}
