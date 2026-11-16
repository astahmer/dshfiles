import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { EditLines, type LineCounts } from './edit-lines.js'

export interface ToolCallRecord {
  readonly callId: string
  readonly name: string
  readonly arguments: string
}

export interface ToolResultRecord {
  readonly callId: string
  readonly isError: boolean
  readonly text: string | undefined
}

export interface FailedCommand {
  readonly callId: string
  /** The model's own one-line description when it gave one, else the command itself. */
  readonly label: string
  /** `exit 1`, `signal SIGKILL`, or `error` for a call the tool itself rejected. */
  readonly outcome: string
}

/** One file the turn wrote, with the lines its edits added and removed (counted from the call arguments). */
export interface EditedFile {
  readonly path: string
  readonly added: number
  readonly removed: number
}

export interface CommandRun {
  readonly callId: string
  readonly label: string
  /** Undefined while the command has no result, `ok` on exit 0, else how it failed (as in FailedCommand). */
  readonly outcome: string | undefined
}

/** Test counts from the last test-runner summary a command printed this turn (Vitest, Jest or pytest). */
export interface TestCounts {
  readonly passed: number
  readonly failed: number
  readonly total: number
}

export interface TurnActivitySummary {
  readonly commands: number
  readonly failedCommands: readonly FailedCommand[]
  /** Every command in call order, for the commands list. */
  readonly commandRuns: readonly CommandRun[]
  readonly editedFiles: readonly string[]
  /** The same files with per-file line counts, in first-edit order. */
  readonly editedFileStats: readonly EditedFile[]
  readonly tests: TestCounts | undefined
  readonly readFiles: number
  readonly searches: number
  readonly otherCalls: number
  readonly failedOtherCalls: number
  /** Sequence of the turn's `workspace/changes` event once the Host summarized its changed files. */
  readonly changesSeq: number | undefined
}

/** One part of the footer and the list it opens (`files` and `commands` open lists; the others are counts). */
export interface TurnSegment {
  readonly key: 'files' | 'commands' | 'tests' | 'reads' | 'searches'
  readonly text: string
  readonly failed?: boolean
  /** Set on the failed-tests part while commands failed: it is the one red part, and opens the failures list. */
  readonly opensFailures?: boolean
}

type Category = 'command' | 'edit' | 'read' | 'search' | 'other'

const CATEGORY_BY_TOOL = new Map<string, Category>([
  ['bash', 'command'],
  ['pwsh', 'command'],
  ['terminal_send', 'command'],
  ['edit', 'edit'],
  ['write', 'edit'],
  ['apply_patch', 'edit'],
  ['str_replace_editor', 'edit'],
  ['read', 'read'],
  ['read_image', 'read'],
  ['grep', 'search'],
  ['glob', 'search'],
  ['web_search', 'search'],
  ['web_fetch', 'search'],
])

const EXIT_FOOTER = /\n\[exit code: (-?\d+|null)\]$/
const SIGNAL_FOOTER = /\n\[killed by signal: ([^\]\n]+)\]$/

/** Folds one Turn's tool calls into what a reader wants from a glance: commands run and failed, files edited. */
export class TurnActivity {
  static readonly empty: TurnActivitySummary = {
    commands: 0,
    failedCommands: [],
    commandRuns: [],
    editedFiles: [],
    editedFileStats: [],
    tests: undefined,
    readFiles: 0,
    searches: 0,
    otherCalls: 0,
    failedOtherCalls: 0,
    changesSeq: undefined,
  }

  static summarize(input: { readonly calls: readonly ToolCallRecord[]; readonly results: readonly ToolResultRecord[] }): TurnActivitySummary {
    const resultsById = new Map(input.results.map(result => [result.callId, result]))
    const editedFiles = new Map<string, { added: number; removed: number }>()
    const failedCommands: FailedCommand[] = []
    const commandRuns: CommandRun[] = []
    let tests: TestCounts | undefined
    let commands = 0
    let readFiles = 0
    let searches = 0
    let otherCalls = 0
    let failedOtherCalls = 0
    for (const call of input.calls) {
      const result = resultsById.get(call.callId)
      const category = CATEGORY_BY_TOOL.get(call.name) ?? 'other'
      if (category === 'command') {
        commands += 1
        const label = TurnActivity.commandLabel(call)
        const outcome = result === undefined ? undefined : TurnActivity.commandFailure(result)
        if (outcome !== undefined) failedCommands.push({ callId: call.callId, label, outcome })
        commandRuns.push({ callId: call.callId, label, outcome: result === undefined ? undefined : (outcome ?? 'ok') })
        tests = (result?.text === undefined ? undefined : TurnActivity.testCounts(result.text)) ?? tests
        continue
      }
      if (category === 'edit') {
        const args = PartialArguments.fromText(call.arguments)
        const file = args.text('file_path') ?? args.text('path')
        if (file !== undefined && result?.isError !== true) {
          const lines = TurnActivity.editLines(call.name, call.arguments)
          const previous = editedFiles.get(file) ?? { added: 0, removed: 0 }
          editedFiles.set(file, { added: previous.added + lines.added, removed: previous.removed + lines.removed })
        }
        continue
      }
      if (category === 'read') readFiles += 1
      else if (category === 'search') searches += 1
      else {
        otherCalls += 1
        if (result?.isError === true) failedOtherCalls += 1
      }
    }
    return {
      commands,
      failedCommands,
      commandRuns,
      editedFiles: [...editedFiles.keys()],
      editedFileStats: [...editedFiles].map(([path, lines]) => ({ path, ...lines })),
      tests,
      readFiles,
      searches,
      otherCalls,
      failedOtherCalls,
      changesSeq: undefined,
    }
  }

  /** Lines added and removed across a turn's edits. */
  static lineTotals(summary: TurnActivitySummary): LineCounts {
    return summary.editedFileStats.reduce((sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }), { added: 0, removed: 0 })
  }

  /** Lines one edit adds and removes, from its arguments; see {@link EditLines.of}. */
  static editLines(tool: string, argumentsText: string): LineCounts {
    return EditLines.of(tool, argumentsText)
  }

  /** The last test-runner summary in a command's output: Vitest `Tests  2 failed | 40 passed (42)`, Jest, pytest. */
  static testCounts(output: string): TestCounts | undefined {
    const lines = output.split('\n').filter(line => /^\s*Tests:?\s/.test(line) || /^=+ .*\b(passed|failed)\b.* in [\d.]+s/.test(line))
    const last = lines.at(-1)
    if (last === undefined) return undefined
    const count = (word: string): number => Number(new RegExp(`(\\d+) ${word}`).exec(last)?.[1] ?? 0)
    const passed = count('passed')
    const failed = count('failed')
    if (passed + failed === 0) return undefined
    const total = Number(/\((\d+)\)/.exec(last)?.[1] ?? /(\d+) total/.exec(last)?.[1] ?? passed + failed)
    return { passed, failed, total }
  }

  /** The parts of the footer line, in reading order; `includeReads` drops reads and searches when off. */
  static parts(summary: TurnActivitySummary, options: { readonly includeReads: boolean }): readonly string[] {
    const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`
    return [
      summary.commands > 0 ? `ran ${plural(summary.commands, 'command', 'commands')}` : undefined,
      summary.editedFiles.length > 0 ? `edited ${plural(summary.editedFiles.length, 'file', 'files')}` : undefined,
      options.includeReads && summary.readFiles > 0 ? `read ${plural(summary.readFiles, 'file', 'files')}` : undefined,
      options.includeReads && summary.searches > 0 ? plural(summary.searches, 'search', 'searches') : undefined,
    ].filter(part => part !== undefined)
  }

  /**
   * The footer's parts, each naming the list it opens: "Edited 3 files +42 −7 · ran 6 commands · 2 of 42 tests failed ·
   * read 4 files". Line counts and tests are left out when their option is off or nothing was counted; `editedFiles: false`
   * leaves the edits to the file chips, which already name them. Calls that are neither a command, an edit, a read nor
   * a search get no part: "1 other tool call" says nothing a reader can act on.
   */
  static segments(
    summary: TurnActivitySummary,
    options: { readonly includeReads: boolean; readonly lineCounts: boolean; readonly testResults: boolean; readonly editedFiles?: boolean },
  ): readonly TurnSegment[] {
    const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`
    const lines = TurnActivity.lineTotals(summary)
    const counted = options.lineCounts && lines.added + lines.removed > 0 ? ` +${lines.added} −${lines.removed}` : ''
    const tests = options.testResults ? summary.tests : undefined
    const segments: (TurnSegment | undefined)[] = [
      options.editedFiles !== false && summary.editedFiles.length > 0
        ? { key: 'files', text: `edited ${plural(summary.editedFiles.length, 'file', 'files')}${counted}` }
        : undefined,
      summary.commands > 0 ? { key: 'commands', text: `ran ${plural(summary.commands, 'command', 'commands')}` } : undefined,
      tests === undefined ? undefined : TurnActivity.testsSegment(summary, tests),
      options.includeReads && summary.readFiles > 0 ? { key: 'reads', text: `read ${plural(summary.readFiles, 'file', 'files')}` } : undefined,
      options.includeReads && summary.searches > 0 ? { key: 'searches', text: plural(summary.searches, 'search', 'searches') } : undefined,
    ]
    return segments.filter(segment => segment !== undefined)
  }

  /** The one test outcome: "2 of 42 tests failed" in red, opening the failed commands; else "40 tests passed". */
  private static testsSegment(summary: TurnActivitySummary, tests: TestCounts): TurnSegment {
    if (tests.failed === 0) return { key: 'tests', text: `${tests.passed} ${tests.passed === 1 ? 'test' : 'tests'} passed` }
    return {
      key: 'tests',
      text: `${tests.failed} of ${tests.total} ${tests.total === 1 ? 'test' : 'tests'} failed`,
      failed: true,
      opensFailures: summary.failedCommands.length > 0,
    }
  }

  /**
   * Failed commands the footer counts as a part of their own. While the test outcome reads "N of M tests failed", that
   * part is the turn's one red word and opens every failed command, so a second red "1 command failed" beside it would
   * spend two warnings on one failure. Without failed tests (or with test results off) the count stands alone.
   */
  static failedCommandsBeyondTests(summary: TurnActivitySummary, options: { readonly testResults: boolean }): number {
    const testsFailed = options.testResults && summary.tests !== undefined && summary.tests.failed > 0
    return testsFailed ? 0 : summary.failedCommands.length
  }

  /**
   * Whether each footer part draws "·" before it: never the first part, and never a part right after one that ends in
   * a chevron, which already separates the two ("ran 1 command › 5s", not "ran 1 command › · 5s").
   * @param endsWithChevron - for each part in reading order, whether it ends in a disclosure chevron.
   */
  static separators(endsWithChevron: readonly boolean[]): readonly boolean[] {
    return endsWithChevron.map((_chevron, index) => index > 0 && endsWithChevron[index - 1] !== true)
  }

  /** "1m 12s" for a finished turn's wall time. */
  static duration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  }

  /** The footer's duration, or undefined for a turn under a second: "0s" is not a duration worth a part. */
  static shownDuration(ms: number): string | undefined {
    return Math.round(ms / 1000) < 1 ? undefined : TurnActivity.duration(ms)
  }

  static isEmpty(summary: TurnActivitySummary): boolean {
    return summary.commands + summary.editedFiles.length + summary.readFiles + summary.searches + summary.otherCalls === 0
  }

  private static commandFailure(result: ToolResultRecord): string | undefined {
    if (result.isError) return 'error'
    const signal = result.text === undefined ? null : SIGNAL_FOOTER.exec(result.text)
    if (signal?.[1] !== undefined) return `signal ${signal[1]}`
    const exit = result.text === undefined ? null : EXIT_FOOTER.exec(result.text)
    if (exit?.[1] === undefined || exit[1] === '0') return undefined
    return exit[1] === 'null' ? 'no exit code' : `exit ${exit[1]}`
  }

  private static commandLabel(call: ToolCallRecord): string {
    const args = PartialArguments.fromText(call.arguments)
    return args.text('description')?.trim() || args.text('command')?.split('\n')[0] || call.name
  }
}
