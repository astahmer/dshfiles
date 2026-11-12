/**
 * dshfiles (productivity pass T4.1): the pure rules of find in thread. The transcript mounts only its newest rows, so
 * browser find misses older Turns; the find bar asks the Host's session-search index for every matching event of the
 * thread instead, then pages the hit's Turn in and reveals it.
 *
 * Numbering counts from the newest match ("1 of 12" is the newest), because a reader opens a long thread at its tail:
 * ↵ steps to the next older match, ⇧↵ back toward the newest, both wrapping.
 */

/** One match, as the index or the loaded-window fallback reports it. */
export interface FindHit {
  /** Session event sequence of the matching event; null for a loaded-window match, which has only its row. */
  readonly seq: number | null
  /** Rendered Chat row (`data-chat-node-key`) holding a loaded-window match. */
  readonly nodeKey?: string
  /** Which occurrence inside that row (loaded-window search finds several per row). */
  readonly occurrence?: number
  /** Event type the index reports (`user/message`, `tool/result`, …), so a hit inside folded work finds its fold. */
  readonly type?: string
  readonly snippet: string
}

/** Where the answer came from: the whole-thread index, or only the rows the transcript has loaded. */
export type FindSource = 'index' | 'loaded'

export interface FindTurnAnchor {
  readonly turn: number
  readonly seq: number | null
}

const TERM = /"([^"]*)"?|(\S+)/gu
const WORDISH = /[\p{L}\p{N}]$/u

export class ThreadFindModel {
  /** Shortest query the find bar sends; one character matches half the thread and says nothing. */
  static readonly minQueryLength = 2

  /**
   * The text sent to the index: what the user typed, with a prefix `*` on a last word still being typed, so "quart"
   * already finds "quartzite". A trailing space, a closed phrase or an explicit `*` is left as typed.
   */
  static readonly indexQuery = (text: string): string | null => {
    const trimmed = text.trim()
    if (trimmed.length < ThreadFindModel.minQueryLength) return null
    if (/\s$/u.test(text) || trimmed.endsWith('"') || trimmed.endsWith('*')) return trimmed
    const quotes = (trimmed.match(/"/gu) ?? []).length
    if (quotes % 2 === 1 || !WORDISH.test(trimmed)) return trimmed
    return `${trimmed}*`
  }

  /** Lower-cased words and phrases to highlight in the rendered row, longest first. */
  static readonly terms = (text: string): readonly string[] => {
    const terms = new Set<string>()
    for (const match of text.matchAll(TERM)) {
      const raw = (match[1] ?? match[2] ?? '').replace(/^\*+|\*+$/gu, '').trim().toLowerCase()
      if (raw.length > 0) terms.add(raw)
    }
    return [...terms].sort((left, right) => right.length - left.length)
  }

  /**
   * The Turn holding an event: the last Turn whose `turn/start` sequence is at or before it.
   * @param turns - every known Turn, ascending; Turns without a sequence are skipped.
   */
  static readonly turnOf = (turns: readonly FindTurnAnchor[], seq: number): number | null => {
    let low = 0
    let high = turns.length - 1
    let found: number | null = null
    while (low <= high) {
      const middle = (low + high) >> 1
      const candidate = turns[middle]
      if (candidate === undefined) break
      if (candidate.seq === null) {
        // A Turn without a sequence cannot order the search; fall back to a linear pass.
        return ThreadFindModel.turnOfLinear(turns, seq)
      }
      if (candidate.seq <= seq) {
        found = candidate.turn
        low = middle + 1
      } else high = middle - 1
    }
    return found
  }

  private static readonly turnOfLinear = (turns: readonly FindTurnAnchor[], seq: number): number | null => {
    let found: number | null = null
    for (const turn of turns) if (turn.seq !== null && turn.seq <= seq && (found === null || turn.turn > found)) found = turn.turn
    return found
  }

  /**
   * The match a new search lands on: the newest one at or above where the reader is (the last sequence on screen),
   * else the newest.
   * @param hits - oldest first.
   */
  static readonly initialIndex = (hits: readonly FindHit[], readerSeq: number | null): number => {
    if (hits.length === 0) return -1
    if (readerSeq !== null) {
      for (let index = hits.length - 1; index >= 0; index -= 1) {
        const seq = hits[index]?.seq
        if (seq !== null && seq !== undefined && seq <= readerSeq) return index
      }
    }
    return hits.length - 1
  }

  /** ↵ goes older (`-1`), ⇧↵ newer (`+1`); both wrap. */
  static readonly step = (index: number, count: number, direction: 'older' | 'newer'): number => {
    if (count <= 0) return -1
    if (index < 0) return count - 1
    return (index + (direction === 'older' ? -1 : 1) + count) % count
  }

  /** The Chat row kind that renders an indexed event type, used to search an opened fold. */
  static readonly rowKindOf = (type: string | undefined): string | undefined => {
    switch (type) {
      case 'tool/call':
      case 'tool/result':
        return 'tool-call'
      case 'assistant/message':
        return 'assistant-step'
      case 'user/message':
        return 'user'
      default:
        return undefined
    }
  }

  /**
   * "3 of 12": the position counted from the newest match. A `total` above the hits returned means the index holds
   * older matches the bar did not ask for ("3 of 500+").
   */
  static readonly label = (index: number, count: number, total: number): string => {
    if (count === 0 || index < 0) return '0 of 0'
    return `${String(count - index)} of ${String(count)}${total > count ? '+' : ''}`
  }

  /**
   * The Chat row an event renders in: the last loaded row of that Turn whose first sequence is at or before it.
   * @param rows - loaded rows of the Turn, in transcript order, with their first sequence.
   */
  static readonly rowFor = (rows: readonly { readonly key: string; readonly seq: number }[], seq: number): string | null => {
    let found: string | null = null
    let foundSeq = -1
    for (const row of rows) {
      if (row.seq <= seq && row.seq >= foundSeq) {
        found = row.key
        foundSeq = row.seq
      }
    }
    return found
  }
}
