export class JevChatTurnTimeline {
  readonly #latestTurns = new Map<string, number>()
  readonly #listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  readonly publish = (sessionId: string, turn: number): void => {
    const latest = this.#latestTurns.get(sessionId)
    if (latest !== undefined && latest >= turn) return
    this.#latestTurns.set(sessionId, turn)
    for (const listener of this.#listeners) listener()
  }

  readonly isLatest = (sessionId: string, turn: number): boolean => this.#latestTurns.get(sessionId) === turn
}
