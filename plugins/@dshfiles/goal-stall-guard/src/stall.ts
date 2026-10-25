/**
 * No-progress accounting for automatic goal rounds.
 *
 * DSH's goal-round-driver guards round count, round identity, revision, and
 * phase, but nothing notices a round that produced no assistant content. When
 * a provider returns a reasoning-only completion, every round completes with
 * zero model-visible output and the driver splices the next one indefinitely.
 * This module is the only place that decides "this round made no progress",
 * so the threshold lives here and the cordis wiring stays declarative.
 */

/** A goal-round user prompt, as recorded in the durable session log. */
export interface GoalRoundPrompt {
  readonly turn: number
  readonly round: number
}

/** One settled round: the round that ran, and whether it said anything. */
export interface RoundOutcome {
  /** The goal round this turn was continuing, when the turn was a round. */
  readonly round: GoalRoundPrompt | undefined
  /** Whether any assistant content reached the model-visible surface. */
  readonly producedContent: boolean
}

export interface StallDecision {
  /** Whether the consecutive empty-round run has reached its threshold. */
  readonly stalled: boolean
  /** Consecutive rounds so far that produced no assistant content. */
  readonly consecutiveEmptyRounds: number
  /** The round number that ended the run, absent when the turn was not a round. */
  readonly round?: number
}

export interface StallPolicy {
  /** Consecutive empty rounds that count as a stall. */
  readonly threshold: number
}

export const DEFAULT_STALL_POLICY: StallPolicy = { threshold: 3 }

const GOAL_ROUND_PATTERN = /^<goal_round>/

/**
 * Read the goal round a turn was continuing.
 *
 * Only a positive round is a continuation: DSH brands the round-zero message
 * that opened the goal, and counting that one would let the opening prompt look
 * like an empty round before any continuation happened.
 */
export const goalRoundFrom = (text: string): { round: number } | undefined => {
  const match = /^\s*<goal_round>[\s\S]*?^Round:\s*(\d+)\/\d+/m.exec(text)
  if (match === null) return undefined
  const round = Number(match[1])
  return Number.isInteger(round) && round > 0 ? { round } : undefined
}

/** Whether this user prompt opened a goal rather than continuing one. */
export const isGoalOpeningPrompt = (text: string): boolean => GOAL_ROUND_PATTERN.test(text.trimStart())

export const StallDetector = (policy: StallPolicy = DEFAULT_STALL_POLICY) => {
  let openRound: GoalRoundPrompt | undefined
  let producedContent = false
  let consecutiveEmptyRounds = 0

  return {
    /** A `turn/start` opened a turn; forget whatever the previous one decided. */
    turnStarted: (): void => {
      openRound = undefined
      producedContent = false
    },

    /**
     * A `user/message` entered the turn. Only a positive goal round opens a
     * tracked round; anything else — a human prompt, a webhook, an agent
     * message — is ordinary work and must not be counted as a stalled round.
     */
    promptEntered: (text: string): void => {
      const round = goalRoundFrom(text)
      openRound = round === undefined ? undefined : { turn: -1, round: round.round }
    },

    /** The `turn` that owns the prompt, now known from `step/start`. */
    turnIdentified: (turn: number): void => {
      if (openRound !== undefined && openRound.turn === -1) openRound = { turn, round: openRound.round }
    },

    /** An `assistant/message` reached the model-visible surface. */
    contentProduced: (): void => {
      producedContent = true
    },

    /** A `turn/end` closed the turn; returns whether to pause the goal. */
    turnEnded: (): StallDecision => {
      const empty = openRound !== undefined && !producedContent
      consecutiveEmptyRounds = empty ? consecutiveEmptyRounds + 1 : 0
      const stalled = empty && consecutiveEmptyRounds >= policy.threshold
      return {
        stalled,
        consecutiveEmptyRounds,
        ...(openRound !== undefined && { round: openRound.round }),
      }
    },
  }
}

export type StallDetector = ReturnType<typeof StallDetector>
