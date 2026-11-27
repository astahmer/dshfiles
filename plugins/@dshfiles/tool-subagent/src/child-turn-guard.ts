/**
 * Turn-quality guard for delegated children.
 *
 * A provider that reads a long brief as a handoff can finish its turn as
 * `completed` after a few setup calls and answer "no implementation yet, please
 * reassign". The parent then sees a healthy completion and a child that never
 * started. This module decides, from the child's own turn, whether that
 * completed turn is such a hand-back; the Host wiring turns the verdict into a
 * continuing message.
 *
 * The decision is data, not a counter of failures: a turn that made enough tool
 * calls is work whatever it says, and a turn whose closing text does not hand
 * the task back is a normal finish and is never touched.
 *
 * @module @dshfiles/tool-subagent/child-turn-guard
 */

/** Config for the paused-child guard, as the plugin row supplies it. */
export interface ChildTurnGuardConfig {
  /** Whether the guard runs at all; `false` is the off switch. */
  readonly enabled?: boolean
  /**
   * Tool calls that make one turn ordinary work. A turn with at least this many
   * calls is never resumed; `0` drops the tool-count condition entirely.
   */
  readonly minToolCalls?: number
  /** Continuing messages one child may receive before the parent is told instead. */
  readonly maxResumes?: number
  /** Case-insensitive regular expressions that recognize a hand-back in the closing text. */
  readonly handBackPatterns?: readonly string[]
  /** The message steered into a child that handed its task back. */
  readonly resumeMessage?: string
}

/**
 * Durable attribution for the guard's own messages. A `runtime-context` source
 * would be superseded by the loop's runtime-context projection before the next
 * request, so the continuing message would never reach the model.
 */
export const CHILD_TURN_GUARD_SOURCE = { kind: 'dshfiles-child-turn-guard' } as const

/** The one continuing message a hand-back earns before the parent is told instead. */
export const DEFAULT_RESUME_MESSAGE =
  'You stopped without implementing. Continue: implement the next step of your task; only stop on a real blocker, and name it.'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dshfiles-child-turn-guard': { readonly kind: 'dshfiles-child-turn-guard' }
  }
}

/** The row shape the Loader validates: a mutable array, so Schemastery's config type matches. */
export interface ChildTurnGuardRow {
  enabled?: boolean
  minToolCalls?: number
  maxResumes?: number
  handBackPatterns?: string[]
  resumeMessage?: string
}

/** A complete, validated policy: every field set and bounded. */
export interface ChildTurnGuardPolicy {
  readonly enabled: boolean
  readonly minToolCalls: number
  readonly maxResumes: number
  readonly handBackPatterns: readonly string[]
  readonly resumeMessage: string
}

/** One child turn as the guard read it: how much work it did and how it closed. */
export interface TurnObservation {
  readonly toolCalls: number
  readonly closingText: string
}

/** What the guard does with one completed child turn. */
export type GuardVerdict = 'resume' | 'budget-exhausted' | 'worked' | 'not-hand-back'

/** Compiled hand-back matchers and the sources that were not usable as one. */
export interface CompiledHandBackPatterns {
  readonly patterns: readonly RegExp[]
  readonly rejected: readonly string[]
}

/** One completed turn, as the wiring asks the guard to judge it. */
export interface GuardVerdictInput {
  readonly policy: ChildTurnGuardPolicy
  readonly observation: TurnObservation | undefined
  readonly patterns: readonly RegExp[]
  readonly resumesUsed: number
}

/**
 * The guard's decision rules, as one policy object: defaults, config merge,
 * hand-back matching and the verdict for one completed child turn.
 */
export class ChildTurnGuard {
  static readonly DEFAULT: ChildTurnGuardPolicy = {
    enabled: true,
    minToolCalls: 3,
    maxResumes: 2,
    handBackPatterns: [
      'reassign',
      'cannot complete',
      "can't complete",
      'no implementation',
      'not implemented yet',
      'hand(?:ing|ed)? back',
      'hand[- ]?off',
      'take over',
    ],
    resumeMessage: DEFAULT_RESUME_MESSAGE,
  }

  /**
   * Compile the configured regular expressions. A row that carries an invalid
   * source keeps every other pattern and reports the rejected ones, so one typo
   * cannot disable the guard or fail the delegation tool's load.
   */
  static compile(sources: readonly string[]): CompiledHandBackPatterns {
    const patterns: RegExp[] = []
    const rejected: string[] = []
    for (const source of sources) {
      try {
        patterns.push(new RegExp(source, 'iu'))
      } catch {
        rejected.push(source)
      }
    }
    return { patterns, rejected }
  }

  /** Merge a partial row config over the defaults, without trusting any field. */
  static normalize(config: ChildTurnGuardConfig | ChildTurnGuardRow | undefined): ChildTurnGuardPolicy {
    return {
      enabled: config?.enabled ?? ChildTurnGuard.DEFAULT.enabled,
      minToolCalls: ChildTurnGuard.boundedCount(config?.minToolCalls, ChildTurnGuard.DEFAULT.minToolCalls),
      maxResumes: ChildTurnGuard.boundedCount(config?.maxResumes, ChildTurnGuard.DEFAULT.maxResumes),
      handBackPatterns: config?.handBackPatterns ?? ChildTurnGuard.DEFAULT.handBackPatterns,
      resumeMessage: config?.resumeMessage ?? ChildTurnGuard.DEFAULT.resumeMessage,
    }
  }

  /** Whether this closing text hands the task back instead of reporting work. */
  static matches(text: string, patterns: readonly RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text))
  }

  /**
   * Decide one completed child turn.
   *
   * Order matters: a closing text that is not a hand-back is a normal finish
   * whatever the tool count, and a turn that made enough calls is work however
   * it is worded. Only the remaining hand-backs spend resume budget.
   */
  static verdict(input: GuardVerdictInput): GuardVerdict {
    const observation = input.observation
    if (observation === undefined || observation.closingText.trim().length === 0) return 'not-hand-back'
    if (!ChildTurnGuard.matches(observation.closingText, input.patterns)) return 'not-hand-back'
    // minToolCalls 0 means "guard any tool count", not "no turn counts as work".
    if (input.policy.minToolCalls > 0 && observation.toolCalls >= input.policy.minToolCalls) return 'worked'
    if (input.resumesUsed >= input.policy.maxResumes) return 'budget-exhausted'
    return 'resume'
  }

  /** A bounded non-negative integer from either a config value or its default. */
  private static boundedCount(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : fallback
  }
}

/**
 * Read one turn's work and closing text from the Session events the loop
 * publishes. A steering message continues the same turn, so a resumed child
 * keeps accumulating tool calls and replaces its closing text in this tracker.
 */
export class ChildTurnTracker {
  private turn: number | undefined
  private toolCalls = 0
  private closingText = ''

  /** A `turn/start` opened `turn`; a resumed or ordinary later turn starts clean. */
  turnStarted(turn: number): void {
    if (this.turn === turn) return
    this.turn = turn
    this.toolCalls = 0
    this.closingText = ''
  }

  /** One `tool/call` ran in `turn`. */
  toolCalled(turn: number): void {
    this.turnStarted(turn)
    this.toolCalls += 1
  }

  /** One `assistant/message` spoke in `turn`; the last one is the turn's closing text. */
  assistantSpoke(turn: number, text: string): void {
    this.turnStarted(turn)
    this.closingText = text
  }

  /** What the tracker saw for `turn`, or nothing when it saw no turn at all. */
  observation(turn: number): TurnObservation | undefined {
    if (this.turn !== turn) return undefined
    return { toolCalls: this.toolCalls, closingText: this.closingText }
  }
}
