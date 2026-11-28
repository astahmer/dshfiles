/**
 * Turn-quality guard for delegated children.
 *
 * A provider that reads a long brief as a handoff can finish its turn as
 * `completed` answering "no implementation yet, please reassign". The parent
 * then sees a healthy completion and a child that never started. This module
 * decides, from the child's own turn, whether that completed turn handed the
 * task back; the Host wiring turns the verdict into a continuing message.
 *
 * The decision is data, not a counter of failures. A closing text that matches a
 * hand-back pattern is a hand-back whatever the tool count: a child can spend
 * its turn on setup (fetch, rebase, install) and still hand back, which is how
 * the guard missed a real one on 2026-11-27. Only a turn that already changed
 * files or committed has advanced the task, so its wording is a report and is
 * never resumed. `minToolCalls` stays as the extra trigger for a turn that quit
 * silently: no closing text and fewer calls than that is a quit too.
 *
 * @module @dshfiles/tool-subagent/child-turn-guard
 */

/** Config for the paused-child guard, as the plugin row supplies it. */
export interface ChildTurnGuardConfig {
  /** Whether the guard runs at all; `false` is the off switch. */
  readonly enabled?: boolean
  /**
   * Tool calls that make one turn ordinary work. A hand-back is resumed whatever
   * this count is; a turn that closes with no text and fewer calls than this is a
   * silent quit and is resumed too. `0` drops the silent-quit trigger.
   */
  readonly minToolCalls?: number
  /** Continuing messages one child may receive before the parent is told instead. */
  readonly maxResumes?: number
  /** Case-insensitive regular expressions that recognize a hand-back in the closing text. */
  readonly handBackPatterns?: readonly string[]
  /**
   * Tool names whose calls change files. A turn with any of them has advanced the
   * task, so a hand-back wording in the same turn is a report, not a hand-back.
   */
  readonly fileChangeTools?: readonly string[]
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
  fileChangeTools?: string[]
  resumeMessage?: string
}

/** A complete, validated policy: every field set and bounded. */
export interface ChildTurnGuardPolicy {
  readonly enabled: boolean
  readonly minToolCalls: number
  readonly maxResumes: number
  readonly handBackPatterns: readonly string[]
  readonly fileChangeTools: readonly string[]
  readonly resumeMessage: string
}

/** One `tool/call` a child made in this turn, as the Session event recorded it. */
export interface TurnToolCall {
  readonly name: string
  readonly arguments: string
}

/** One child turn as the guard read it: how much work it did and how it closed. */
export interface TurnObservation {
  readonly toolCalls: number
  /** Calls that changed files in this turn. */
  readonly fileChanges: number
  /** Shell calls that ran `jj describe`/`jj commit` or `git commit` in this turn. */
  readonly commits: number
  readonly closingText: string
}

/** What the guard does with one completed child turn. */
export type GuardVerdict = 'resume' | 'budget-exhausted' | 'worked' | 'not-hand-back'

/** Compiled hand-back matchers and the sources that were not usable as one. */
export interface CompiledHandBackPatterns {
  readonly patterns: readonly RegExp[]
  readonly rejected: readonly string[]
}

/** How the tracker tells a turn's file changes and commits from its plain calls. */
export interface TurnWorkRules {
  readonly fileChangeTools: ReadonlySet<string>
  readonly commitCommands: RegExp
}

/** One completed turn, as the wiring asks the guard to judge it. */
export interface GuardVerdictInput {
  readonly policy: ChildTurnGuardPolicy
  readonly observation: TurnObservation | undefined
  readonly patterns: readonly RegExp[]
  readonly resumesUsed: number
}

/** The native tools that write files, including the visible-filesystem editor. */
const DEFAULT_FILE_CHANGE_TOOLS: readonly string[] = ['apply_patch', 'edit', 'write', 'str_replace_editor']

/** Shell tools: a commit is run through one of them, never as a dedicated tool. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'exec_command', 'powershell', 'pwsh', 'run_command', 'sh', 'shell', 'terminal_send', 'zsh'])

/** A shell call that records the turn's work on the repository. */
const COMMIT_COMMANDS = /\b(?:jj\s+(?:describe|commit)|git\s+commit)\b/u

/** The tool name without its namespace: `tool:edit` and `mcp_dsh.edit` both read as `edit`. */
const bareToolName = (name: string): string =>
  name
    .slice(Math.max(name.lastIndexOf('.'), name.lastIndexOf(':')) + 1)
    .trim()
    .toLowerCase()

/**
 * The guard's decision rules, as one policy object: defaults, config merge,
 * hand-back matching, per-call classification and the verdict for one completed
 * child turn.
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
      'unfinished',
      'remains unverified',
      'do not land',
      'not implemented',
      'hand(?:ing|ed)? back',
      'hand[- ]?off',
      'take over',
    ],
    fileChangeTools: DEFAULT_FILE_CHANGE_TOOLS,
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
      fileChangeTools: config?.fileChangeTools ?? ChildTurnGuard.DEFAULT.fileChangeTools,
      resumeMessage: config?.resumeMessage ?? ChildTurnGuard.DEFAULT.resumeMessage,
    }
  }

  /** The rules one tracker needs to tell a turn's work from its plain calls. */
  static workRules(policy: ChildTurnGuardPolicy): TurnWorkRules {
    return {
      fileChangeTools: new Set(policy.fileChangeTools.map(bareToolName)),
      commitCommands: COMMIT_COMMANDS,
    }
  }

  /** Whether one tool call advanced the task, by changing a file or committing. */
  static workKind(call: TurnToolCall, rules: TurnWorkRules): 'file-change' | 'commit' | 'other' {
    const name = bareToolName(call.name)
    if (rules.fileChangeTools.has(name)) return 'file-change'
    if (SHELL_TOOLS.has(name) && rules.commitCommands.test(call.arguments)) return 'commit'
    return 'other'
  }

  /** Whether this closing text hands the task back instead of reporting work. */
  static matches(text: string, patterns: readonly RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text))
  }

  /**
   * Decide one completed child turn.
   *
   * Order matters: a turn that changed files or committed is work whatever its
   * closing text says. Past that, a closing text that matches a hand-back is a
   * hand-back at any tool count, and a text-less turn with fewer than
   * `minToolCalls` calls is a silent quit. Only those spend resume budget.
   */
  static verdict(input: GuardVerdictInput): GuardVerdict {
    const observation = input.observation
    if (observation === undefined) return 'not-hand-back'
    if (observation.fileChanges > 0 || observation.commits > 0) return 'worked'
    const closing = observation.closingText.trim()
    const handBack = closing.length > 0 && ChildTurnGuard.matches(observation.closingText, input.patterns)
    const silentQuit = closing.length === 0 && input.policy.minToolCalls > 0 && observation.toolCalls < input.policy.minToolCalls
    if (!handBack && !silentQuit) return 'not-hand-back'
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
  private fileChanges = 0
  private commits = 0
  private closingText = ''

  /** `rules` decides which tool calls count as a file change or a commit. */
  constructor(private readonly rules: TurnWorkRules = ChildTurnGuard.workRules(ChildTurnGuard.DEFAULT)) {}

  /** A `turn/start` opened `turn`; a resumed or ordinary later turn starts clean. */
  turnStarted(turn: number): void {
    if (this.turn === turn) return
    this.turn = turn
    this.toolCalls = 0
    this.fileChanges = 0
    this.commits = 0
    this.closingText = ''
  }

  /** One `tool/call` ran in `turn`. */
  toolCalled(turn: number, call: TurnToolCall): void {
    this.turnStarted(turn)
    this.toolCalls += 1
    const kind = ChildTurnGuard.workKind(call, this.rules)
    if (kind === 'file-change') this.fileChanges += 1
    if (kind === 'commit') this.commits += 1
  }

  /** One `assistant/message` spoke in `turn`; the last one is the turn's closing text. */
  assistantSpoke(turn: number, text: string): void {
    this.turnStarted(turn)
    this.closingText = text
  }

  /** What the tracker saw for `turn`, or nothing when it saw no turn at all. */
  observation(turn: number): TurnObservation | undefined {
    if (this.turn !== turn) return undefined
    return { toolCalls: this.toolCalls, fileChanges: this.fileChanges, commits: this.commits, closingText: this.closingText }
  }
}
