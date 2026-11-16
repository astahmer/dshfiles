/**
 * What a tool call is, in words a supervisor reads: "Running a command", "Searching", "Waiting for an answer". One
 * table for the thread list's live activity line (folded on the Host from the turn's calls) and the subagent run card
 * (which only knows the name of the tool in flight), so a tool is never shown by its identifier. Pure.
 */

/** `mcp__dsh__bash` and `bash` are the same tool to a reader. */
const toolName = (name: string): string => (name.split('__').at(-1) ?? name).toLowerCase()

const EDIT_TOOLS: ReadonlySet<string> = new Set(['edit', 'write', 'apply_patch', 'editor_write', 'str_replace_editor', 'multiedit', 'notebookedit'])
const SHELL_TOOLS: ReadonlySet<string> = new Set(['bash', 'shell', 'pwsh', 'powershell', 'terminal', 'exec', 'multi_host_exec'])
const READ_TOOLS: ReadonlySet<string> = new Set(['read', 'read_image'])

/** The call that stops a turn until the user answers it. */
const QUESTION_TOOL = 'ask_user_question'
/** Calls that hold the caller until someone answers: the user, or the thread that started it. */
const ANSWER_TOOLS: ReadonlySet<string> = new Set([QUESTION_TOOL, 'ask_parent_question', 'ask_thread_question'])

const FIXED_STEPS: ReadonlyMap<string, string> = new Map([
  ['grep', 'Searching'],
  ['glob', 'Searching'],
  ['find_threads', 'Searching'],
  ['memory_search', 'Searching'],
  ['web_search', 'Searching the web'],
  ['web_fetch', 'Reading a web page'],
  ['subagent', 'Delegating to a subagent'],
  ['subagent_fork', 'Delegating to a subagent'],
  ['workflow', 'Delegating to a subagent'],
  [QUESTION_TOOL, 'Asking you a question'],
  ['todo_write', 'Planning'],
])

const MAX_TOOL_WORDS = 60

/** A tool with no wording of its own, by its name in plain words ("jj details"), never with underscores or a prefix. */
const usingWords = (tool: string): string => {
  const words = tool.replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
  return `Using ${words.length > MAX_TOOL_WORDS ? `${words.slice(0, MAX_TOOL_WORDS - 1)}…` : words}`
}

export interface ToolStep {
  /** The step in words. */
  readonly words: string
  /** The caller is held until someone answers: it is not progressing. */
  readonly waitsForAnswer: boolean
}

/** One call as a reader sees it from its name alone (no arguments): the subagent card's step. */
const ofName = (name: string): ToolStep => {
  const tool = toolName(name)
  if (ANSWER_TOOLS.has(tool)) return { words: 'Waiting for an answer', waitsForAnswer: true }
  if (SHELL_TOOLS.has(tool)) return { words: 'Running a command', waitsForAnswer: false }
  if (EDIT_TOOLS.has(tool)) return { words: 'Editing a file', waitsForAnswer: false }
  if (READ_TOOLS.has(tool)) return { words: 'Reading a file', waitsForAnswer: false }
  return { words: FIXED_STEPS.get(tool) ?? usingWords(tool), waitsForAnswer: false }
}

export class ToolSteps {
  static readonly toolName = toolName
  static readonly EDIT_TOOLS = EDIT_TOOLS
  static readonly SHELL_TOOLS = SHELL_TOOLS
  static readonly QUESTION_TOOL = QUESTION_TOOL
  static readonly FIXED_STEPS = FIXED_STEPS
  static readonly usingWords = usingWords
  static readonly ofName = ofName
}
