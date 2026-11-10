export interface PromptedTurnCountState {
  /** Newest started turn, `-1` before the first `turn/start`. */
  readonly turn: number
  /** Whether that turn already counted its human prompt. */
  readonly prompted: boolean
  readonly count: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    promptedTurnCount: PromptedTurnCountState
  }
  interface SessionProjectionMap {
    /** Turns a human prompt opened; the jj panel's per-thread message count. */
    promptedTurnCount: number
  }
}
