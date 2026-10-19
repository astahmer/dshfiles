import { PartialArguments } from '@deepseek-ai/dsh-util-values'

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

export interface TurnActivitySummary {
  readonly commands: number
  readonly failedCommands: readonly FailedCommand[]
  readonly editedFiles: readonly string[]
  readonly readFiles: number
  readonly searches: number
  readonly otherCalls: number
  readonly failedOtherCalls: number
}

type Category = 'command' | 'edit' | 'read' | 'search' | 'other'

const CATEGORY_BY_TOOL = new Map<string, Category>([
  ['bash', 'command'],
  ['pwsh', 'command'],
  ['terminal_send', 'command'],
  ['edit', 'edit'],
  ['write', 'edit'],
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
    editedFiles: [],
    readFiles: 0,
    searches: 0,
    otherCalls: 0,
    failedOtherCalls: 0,
  }

  static summarize(input: { readonly calls: readonly ToolCallRecord[]; readonly results: readonly ToolResultRecord[] }): TurnActivitySummary {
    const resultsById = new Map(input.results.map(result => [result.callId, result]))
    const editedFiles = new Set<string>()
    const failedCommands: FailedCommand[] = []
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
        const outcome = result === undefined ? undefined : TurnActivity.commandFailure(result)
        if (outcome !== undefined) failedCommands.push({ callId: call.callId, label: TurnActivity.commandLabel(call), outcome })
        continue
      }
      if (category === 'edit') {
        const args = PartialArguments.fromText(call.arguments)
        const file = args.text('file_path') ?? args.text('path')
        if (file !== undefined && result?.isError !== true) editedFiles.add(file)
        continue
      }
      if (category === 'read') readFiles += 1
      else if (category === 'search') searches += 1
      else {
        otherCalls += 1
        if (result?.isError === true) failedOtherCalls += 1
      }
    }
    return { commands, failedCommands, editedFiles: [...editedFiles], readFiles, searches, otherCalls, failedOtherCalls }
  }

  /** The parts of the footer line, in reading order; `includeReads` drops reads and searches when off. */
  static parts(summary: TurnActivitySummary, options: { readonly includeReads: boolean }): readonly string[] {
    const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`
    return [
      summary.commands > 0 ? `ran ${plural(summary.commands, 'command', 'commands')}` : undefined,
      summary.editedFiles.length > 0 ? `edited ${plural(summary.editedFiles.length, 'file', 'files')}` : undefined,
      options.includeReads && summary.readFiles > 0 ? `read ${plural(summary.readFiles, 'file', 'files')}` : undefined,
      options.includeReads && summary.searches > 0 ? plural(summary.searches, 'search', 'searches') : undefined,
      summary.otherCalls > 0 ? plural(summary.otherCalls, 'other tool call', 'other tool calls') : undefined,
    ].filter(part => part !== undefined)
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
