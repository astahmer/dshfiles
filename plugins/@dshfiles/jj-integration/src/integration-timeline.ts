export interface IntegrationRecord {
  readonly at: number
  readonly tipChangeId?: string | undefined
}

type Listener = () => void

/**
 * Places each land of a thread in its conversation: a land belongs to the latest Turn that started before it, so it
 * reads after the work it shipped and before the work that followed. A Turn tail only knows its own Turn, so the tails
 * of one Session publish their start times here and each reads where the next Turn begins.
 */
export class IntegrationTimeline {
  readonly #turnStarts = new Map<string, Map<number, number>>()
  readonly #listeners = new Set<Listener>()

  static forTurn(input: {
    readonly integrations: readonly IntegrationRecord[]
    readonly turnStartedAt: number
    readonly nextTurnStartedAt: number | undefined
  }): readonly IntegrationRecord[] {
    return input.integrations.filter(
      record => record.at >= input.turnStartedAt && (input.nextTurnStartedAt === undefined || record.at < input.nextTurnStartedAt),
    )
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  // A Turn's start never moves, so a start stays known after its tail scrolls away and its neighbour keeps its bound.
  publishTurnStart(input: { readonly sessionId: string; readonly turn: number; readonly startedAt: number }): void {
    const starts = this.#turnStarts.get(input.sessionId) ?? new Map<number, number>()
    if (starts.get(input.turn) === input.startedAt) return
    starts.set(input.turn, input.startedAt)
    this.#turnStarts.set(input.sessionId, starts)
    for (const listener of this.#listeners) listener()
  }

  nextTurnStartedAt(input: { readonly sessionId: string; readonly turn: number }): number | undefined {
    const starts = this.#turnStarts.get(input.sessionId)
    if (starts === undefined) return undefined
    let nextTurn: number | undefined
    for (const turn of starts.keys()) if (turn > input.turn && (nextTurn === undefined || turn < nextTurn)) nextTurn = turn
    return nextTurn === undefined ? undefined : starts.get(nextTurn)
  }
}
