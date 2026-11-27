import z from '@deepseek-ai/schemastery'

const SEEN_TURNS_KEY = 'dshfiles-chat:seen-turns'
/** Enough for every thread a person returns to; the oldest entries drop first. */
const SEEN_TURNS_LIMIT = 500
const SeenTurnsSchema = z.array(z.tuple([z.string(), z.number()]))

interface TurnStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * Per-browser read position: the highest Turn the reader has reached in each Session. The turn rail draws its read
 * boundary below this Turn, the same place Chat's "New" divider marks; a Session whose newest Turn is past it holds
 * content the reader has not scrolled through yet. The Host unread record outranks this memory when a thread opens
 * with unseen Turns (`reset` seeds it). Storage failures degrade to memory only.
 */
export class SeenTurns {
  private readonly turns: Map<string, number>

  constructor(private readonly storage: TurnStorage | null, private readonly limit = SEEN_TURNS_LIMIT) {
    this.turns = SeenTurns.decode(storage)
  }

  private static decode(storage: TurnStorage | null): Map<string, number> {
    try {
      return new Map(SeenTurnsSchema(JSON.parse(storage?.getItem(SEEN_TURNS_KEY) ?? '[]'))
        .flatMap(([sessionId, turn]) => sessionId === undefined || turn === undefined
          || !Number.isSafeInteger(turn) || turn < 0
          ? []
          : [[sessionId, turn] as const]))
    } catch {
      return new Map()
    }
  }

  read(sessionId: string): number | null {
    return this.turns.get(sessionId) ?? null
  }

  /** Record a Turn the reader just reached; a lower Turn never moves the mark back. */
  markSeen(sessionId: string, turn: number): void {
    const current = this.turns.get(sessionId)
    if (current !== undefined && current >= turn) return
    this.turns.delete(sessionId)
    this.turns.set(sessionId, turn)
    this.persist()
  }

  /** Seed the mark from the Host unread record, which can move it back: null means every Turn is unseen. */
  reset(sessionId: string, turn: number | null): void {
    if (turn === null) {
      if (!this.turns.delete(sessionId)) return
    } else {
      if (this.turns.get(sessionId) === turn) return
      this.turns.delete(sessionId)
      this.turns.set(sessionId, turn)
    }
    this.persist()
  }

  private persist(): void {
    for (const oldest of this.turns.keys()) {
      if (this.turns.size <= this.limit) break
      this.turns.delete(oldest)
    }
    try {
      this.storage?.setItem(SEEN_TURNS_KEY, JSON.stringify([...this.turns]))
    } catch {
      // A full or unavailable storage keeps this tab's memory.
    }
  }
}
