import { Option, Schema } from 'effect'
import { type AgentKind, type ItemKind, TEXT_MAX, TITLE_MAX, TOOL_TEXT_MAX, type TokenTotals } from './types.js'

/**
 * Line parsers for the JSONL session logs agent CLIs write. They follow the record shapes agentsview
 * (https://github.com/kenn-io/agentsview, MIT) documents for Claude Code and Codex; the code is a fresh TypeScript
 * implementation, not a port of its Go parsers. Each log line is decoded once with a tolerant schema at the read
 * boundary (unknown fields are ignored, unknown record types decode to nothing); the summary state the parsers fold is
 * plain JSON so an index can persist it and resume a log at a byte offset.
 */

export interface SummaryState {
  title: string | null
  firstPrompt: string | null
  cwd: string | null
  gitBranch: string | null
  models: string[]
  agentVersion: string | null
  startedAt: number | null
  updatedAt: number | null
  userMessages: number
  assistantMessages: number
  toolCalls: number
  tokens: TokenTotals
  /** Claude Code writes one line per content block of a message, each repeating its usage: count a message id once. */
  lastMessageId: string | null
}

export interface ParsedItem {
  readonly kind: ItemKind
  readonly text: string
  readonly truncated: boolean
  readonly toolName: string | null
  readonly isError: boolean
  readonly at: number | null
}

/**
 * One agent CLI's log format: how to decode a line, fold it into a summary, and turn it into transcript items. The
 * summary schema leaves tool-result bodies undeclared, so the index pass pays for JSON parsing but not for decoding them.
 */
export interface AgentParser<SummaryRecord, ItemRecord> {
  readonly agent: AgentKind
  readonly label: string
  /** The session id a log file name carries, so a key resolves without parsing the file. */
  readonly sessionIdOf: (fileName: string) => string
  /**
   * Whether a line can matter, judged from its first `"type"` value before any JSON is parsed. Both CLIs write the
   * record type ahead of its body, and the large records nobody reads (request blobs, world state) are skipped this way.
   */
  readonly relevant: (type: string, line: string) => boolean
  readonly decodeSummary: (line: string) => Option.Option<SummaryRecord>
  readonly decodeItems: (line: string) => Option.Option<ItemRecord>
  readonly summarize: (state: SummaryState, record: SummaryRecord) => void
  readonly items: (record: ItemRecord) => readonly ParsedItem[]
}

const optionalString = Schema.optional(Schema.String)
const isText = Schema.is(Schema.String)
const optionalCount = Schema.optional(Schema.Number)
const textBlock = Schema.Struct({ type: Schema.String, text: optionalString })
type TextBlock = Schema.Schema.Type<typeof textBlock>

const countOf = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
const presentOf = (value: string | undefined): string | null => (value === undefined || value.length === 0 ? null : value)

const timeOf = (value: string | undefined): number | null => {
  if (value === undefined) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const clampText = (text: string, maximum: number): { readonly text: string; readonly truncated: boolean } =>
  text.length <= maximum ? { text, truncated: false } : { text: `${text.slice(0, Math.max(0, maximum - 1))}…`, truncated: true }

const oneLine = (text: string, maximum: number): string => clampText(text.replace(/\s+/g, ' ').trim(), maximum).text

const item = (input: { kind: ItemKind; text: string; toolName?: string | null; isError?: boolean; at: number | null }): ParsedItem => {
  const clamped = clampText(input.text, input.kind === 'tool-call' || input.kind === 'tool-result' ? TOOL_TEXT_MAX : TEXT_MAX)
  return { kind: input.kind, text: clamped.text, truncated: clamped.truncated, toolName: input.toolName ?? null, isError: input.isError ?? false, at: input.at }
}

const blocksText = (blocks: readonly TextBlock[]): string =>
  blocks
    .map(block => block.text ?? (block.type === 'image' || block.type === 'input_image' ? '[image]' : ''))
    .filter(text => text.length > 0)
    .join('\n')

const jsonText = (value: Schema.Json | undefined): string => (value === undefined ? '' : (JSON.stringify(value) ?? ''))

const touch = (state: SummaryState, at: number | null): void => {
  if (at === null) return
  if (state.startedAt === null || at < state.startedAt) state.startedAt = at
  if (state.updatedAt === null || at > state.updatedAt) state.updatedAt = at
}

const addModel = (state: SummaryState, model: string | undefined): void => {
  if (model === undefined || model.length === 0 || model.startsWith('<') || state.models.includes(model) || state.models.length >= 8) return
  state.models.push(model.slice(0, 120))
}

const notePrompt = (state: SummaryState, text: string): void => {
  state.userMessages += 1
  if (state.firstPrompt === null) state.firstPrompt = oneLine(text, TITLE_MAX)
}

/** Harness-injected context (`<system-reminder>`, `<command-name>`, `<environment_context>`…) opens with a tag; people rarely do. */
const TAG_OPENING = /^<[a-z][\w-]*[\s>]/i
const opensWithTag = (text: string): boolean => TAG_OPENING.test(text.trimStart())

// ---------------------------------------------------------------------------------------------------------------------
// Claude Code: ~/.claude/projects/<encoded cwd>/<session uuid>.jsonl
// ---------------------------------------------------------------------------------------------------------------------

const claudeBlock = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('thinking'), thinking: Schema.String }),
  Schema.Struct({ type: Schema.Literal('tool_use'), name: optionalString, input: Schema.optional(Schema.Json) }),
  Schema.Struct({
    type: Schema.Literal('tool_result'),
    content: Schema.optional(Schema.Union([Schema.String, Schema.Array(textBlock)])),
    is_error: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.String }),
])
type ClaudeBlock = Schema.Schema.Type<typeof claudeBlock>

/** The summary pass only reads prompt text and counts tool uses: every other block decodes to its type alone. */
const claudeSummaryBlock = Schema.Union([Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }), Schema.Struct({ type: Schema.String })])

const claudeTurnFields = {
  type: Schema.Literals(['user', 'assistant']),
  timestamp: optionalString,
  cwd: optionalString,
  gitBranch: optionalString,
  version: optionalString,
  isSidechain: Schema.optional(Schema.Boolean),
  isMeta: Schema.optional(Schema.Boolean),
}
const claudeUsage = Schema.Struct({
  input_tokens: optionalCount,
  output_tokens: optionalCount,
  cache_read_input_tokens: optionalCount,
  cache_creation_input_tokens: optionalCount,
})

const claudeTurn = Schema.Struct({ ...claudeTurnFields, message: Schema.Struct({ content: Schema.Union([Schema.String, Schema.Array(claudeBlock)]) }) })
type ClaudeTurn = Schema.Schema.Type<typeof claudeTurn>

const claudeSummaryRecord = Schema.Union([
  Schema.Struct({
    ...claudeTurnFields,
    message: Schema.Struct({
      id: optionalString,
      model: optionalString,
      content: Schema.Union([Schema.String, Schema.Array(claudeSummaryBlock)]),
      usage: Schema.optional(claudeUsage),
    }),
  }),
  Schema.Struct({ type: Schema.Literal('ai-title'), aiTitle: Schema.String }),
  Schema.Struct({ type: Schema.Literal('summary'), summary: Schema.String }),
])
type ClaudeSummaryRecord = Schema.Schema.Type<typeof claudeSummaryRecord>

const CLAUDE_META_PREFIXES = ['Caveat: ']
const isClaudeMeta = (turn: { readonly isMeta?: boolean | undefined }, text: string): boolean =>
  turn.isMeta === true || opensWithTag(text) || CLAUDE_META_PREFIXES.some(prefix => text.trimStart().startsWith(prefix))

const claudeBlocks = (content: string | readonly ClaudeBlock[]): readonly ClaudeBlock[] => (isText(content) ? [{ type: 'text', text: content }] : content)

const claudeBlockItem = (turn: ClaudeTurn, block: ClaudeBlock, at: number | null): readonly ParsedItem[] => {
  if ('text' in block) {
    if (block.text.trim().length === 0) return []
    const kind: ItemKind = turn.type === 'assistant' ? 'assistant' : isClaudeMeta(turn, block.text) ? 'meta' : 'user'
    return [item({ kind, text: block.text, at })]
  }
  if ('thinking' in block) return block.thinking.length === 0 ? [] : [item({ kind: 'thinking', text: block.thinking, at })]
  if (block.type === 'tool_use' && 'input' in block) return [item({ kind: 'tool-call', text: jsonText(block.input), toolName: presentOf(block.name), at })]
  if (block.type === 'tool_use' && 'name' in block) return [item({ kind: 'tool-call', text: '', toolName: presentOf(block.name), at })]
  if ('content' in block || 'is_error' in block) {
    const content = block.content ?? ''
    return [item({ kind: 'tool-result', text: isText(content) ? content : blocksText(content), isError: block.is_error === true, at })]
  }
  return block.type === 'image' && turn.type === 'user' ? [item({ kind: 'user', text: '[image]', at })] : []
}

const claudeItems = (record: ClaudeTurn): readonly ParsedItem[] => {
  const at = timeOf(record.timestamp)
  return claudeBlocks(record.message.content).flatMap(block => claudeBlockItem(record, block, at))
}

const claudeSummarize = (state: SummaryState, record: ClaudeSummaryRecord): void => {
  if (record.type === 'ai-title') {
    state.title = oneLine(record.aiTitle, TITLE_MAX)
    return
  }
  if (record.type === 'summary') {
    state.title ??= oneLine(record.summary, TITLE_MAX)
    return
  }
  touch(state, timeOf(record.timestamp))
  state.cwd ??= presentOf(record.cwd)
  const branch = presentOf(record.gitBranch)
  if (branch !== null && branch !== 'HEAD') state.gitBranch = branch.slice(0, TITLE_MAX)
  state.agentVersion = presentOf(record.version)?.slice(0, 60) ?? state.agentVersion
  if (record.isSidechain === true) return
  const content = record.message.content
  const blocks = isText(content) ? [{ type: 'text', text: content }] : content
  if (record.type === 'user') {
    const prompt = blocks.flatMap(block => ('text' in block ? [block.text] : [])).find(text => text.trim().length > 0 && !isClaudeMeta(record, text))
    if (prompt !== undefined) notePrompt(state, prompt)
    return
  }
  state.toolCalls += blocks.filter(block => block.type === 'tool_use').length
  const id = presentOf(record.message.id)
  if (id !== null && id === state.lastMessageId) return
  state.lastMessageId = id
  state.assistantMessages += 1
  addModel(state, record.message.model)
  const usage = record.message.usage
  state.tokens = {
    input: state.tokens.input + countOf(usage?.input_tokens),
    output: state.tokens.output + countOf(usage?.output_tokens),
    cacheRead: state.tokens.cacheRead + countOf(usage?.cache_read_input_tokens),
    cacheWrite: state.tokens.cacheWrite + countOf(usage?.cache_creation_input_tokens),
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session uuid>.jsonl
// ---------------------------------------------------------------------------------------------------------------------

const codexMessage = Schema.Struct({ type: Schema.Literal('message'), role: Schema.String, content: Schema.Array(textBlock) })
const codexOutput = Schema.Union([Schema.String, Schema.Struct({ content: Schema.String }), Schema.Array(textBlock), Schema.Json])
const codexPayload = Schema.Union([
  codexMessage,
  Schema.Struct({ type: Schema.Literal('reasoning'), summary: Schema.optional(Schema.Array(textBlock)) }),
  Schema.Struct({
    type: Schema.String,
    name: optionalString,
    arguments: Schema.optional(Schema.Json),
    input: Schema.optional(Schema.Json),
    action: Schema.optional(Schema.Json),
    output: Schema.optional(codexOutput),
  }),
])

const codexSummaryPayload = Schema.Union([codexMessage, Schema.Struct({ type: Schema.String })])

const codexRecordOf = <Payload extends Schema.Constraint>(payload: Payload) =>
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal('session_meta'),
      timestamp: optionalString,
      payload: Schema.Struct({
        timestamp: optionalString,
        cwd: optionalString,
        cli_version: optionalString,
        git: Schema.optional(Schema.Struct({ branch: optionalString })),
      }),
    }),
    Schema.Struct({ type: Schema.Literal('turn_context'), timestamp: optionalString, payload: Schema.Struct({ model: optionalString, cwd: optionalString }) }),
    Schema.Struct({
      type: Schema.Literal('event_msg'),
      timestamp: optionalString,
      payload: Schema.Struct({
        type: Schema.String,
        info: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              total_token_usage: Schema.optional(
                Schema.Struct({
                  input_tokens: optionalCount,
                  cached_input_tokens: optionalCount,
                  output_tokens: optionalCount,
                  cache_write_input_tokens: optionalCount,
                }),
              ),
            }),
          ),
        ),
      }),
    }),
    Schema.Struct({ type: Schema.Literal('response_item'), timestamp: optionalString, payload }),
  ])
const codexSummaryRecord = codexRecordOf(codexSummaryPayload)
type CodexSummaryRecord = Schema.Schema.Type<typeof codexSummaryRecord>
const codexItemRecord = Schema.Struct({ type: Schema.Literal('response_item'), timestamp: optionalString, payload: codexPayload })
type CodexItemRecord = Schema.Schema.Type<typeof codexItemRecord>
type CodexPayload = Schema.Schema.Type<typeof codexPayload>
type CodexOutput = Schema.Schema.Type<typeof codexOutput>

const CODEX_META_PREFIXES = ['# AGENTS.md instructions']
const isCodexMeta = (text: string): boolean => opensWithTag(text) || CODEX_META_PREFIXES.some(prefix => text.trimStart().startsWith(prefix))

const isOutputObject = Schema.is(Schema.Struct({ content: Schema.String }))
const isOutputBlocks = Schema.is(Schema.Array(textBlock))

/** A tool output is a string, a `{ content }` object or a block list depending on the tool; anything else stays JSON. */
const outputText = (output: CodexOutput | undefined): string => {
  if (isText(output)) return output
  if (isOutputObject(output)) return output.content
  if (isOutputBlocks(output)) return blocksText(output)
  return jsonText(output)
}

const codexPayloadItems = (payload: CodexPayload, at: number | null): readonly ParsedItem[] => {
  if ('role' in payload) {
    const text = blocksText(payload.content)
    if (text.trim().length === 0) return []
    if (payload.role === 'assistant') return [item({ kind: 'assistant', text, at })]
    return [item({ kind: payload.role === 'user' && !isCodexMeta(text) ? 'user' : 'meta', text, at })]
  }
  if (payload.type === 'reasoning' && 'summary' in payload) {
    const text = blocksText(payload.summary ?? [])
    return text.length === 0 ? [] : [item({ kind: 'thinking', text, at })]
  }
  if (!('name' in payload || 'output' in payload || 'arguments' in payload || 'input' in payload || 'action' in payload)) return []
  if (payload.type.endsWith('_call_output')) {
    return [item({ kind: 'tool-result', text: outputText(payload.output), at })]
  }
  if (payload.type.endsWith('_call')) {
    const args = payload.arguments ?? payload.input ?? payload.action
    return [
      item({ kind: 'tool-call', text: isText(args) ? args : jsonText(args), toolName: presentOf(payload.name) ?? payload.type.replace(/_call$/, ''), at }),
    ]
  }
  return []
}

const codexItems = (record: CodexItemRecord): readonly ParsedItem[] => codexPayloadItems(record.payload, timeOf(record.timestamp))

const codexSummarize = (state: SummaryState, record: CodexSummaryRecord): void => {
  const at = timeOf(record.timestamp)
  switch (record.type) {
    case 'session_meta': {
      touch(state, timeOf(record.payload.timestamp) ?? at)
      state.cwd ??= presentOf(record.payload.cwd)
      state.agentVersion = presentOf(record.payload.cli_version)?.slice(0, 60) ?? state.agentVersion
      const branch = presentOf(record.payload.git?.branch)
      if (branch !== null) state.gitBranch = branch.slice(0, TITLE_MAX)
      return
    }
    case 'turn_context':
      addModel(state, record.payload.model)
      state.cwd ??= presentOf(record.payload.cwd)
      return
    case 'event_msg': {
      touch(state, at)
      // The running total is cumulative, so the last one is the session's; input counts include the cached part.
      const totals = record.payload.info?.total_token_usage
      if (record.payload.type !== 'token_count' || totals === undefined) return
      const input = countOf(totals.input_tokens)
      const cached = countOf(totals.cached_input_tokens)
      const output = countOf(totals.output_tokens)
      if (input + output > 0)
        state.tokens = { input: Math.max(0, input - cached), output, cacheRead: cached, cacheWrite: countOf(totals.cache_write_input_tokens) }
      return
    }
    case 'response_item': {
      touch(state, at)
      const payload = record.payload
      if (!('role' in payload)) {
        if (payload.type.endsWith('_call')) state.toolCalls += 1
        return
      }
      const text = blocksText(payload.content)
      if (payload.role === 'assistant' && text.trim().length > 0) state.assistantMessages += 1
      else if (payload.role === 'user' && text.trim().length > 0 && !isCodexMeta(text)) notePrompt(state, text)
    }
  }
}

/** Assistant lines open with their message object, so its `"type":"message"` comes before the record's own type. */
const CLAUDE_TYPES: ReadonlySet<string> = new Set(['user', 'assistant', 'message', 'ai-title', 'summary'])
const CODEX_TYPES: ReadonlySet<string> = new Set(['session_meta', 'turn_context', 'response_item'])
const FIRST_TYPE = /"type"\s*:\s*"([^"]{1,64})"/
const TYPE_PREFIX = 4_096

/** The first `"type"` value of a line, looked for only near its start; null when absent there. */
const firstTypeOf = (line: string): string | null => FIRST_TYPE.exec(line.length > TYPE_PREFIX ? line.slice(0, TYPE_PREFIX) : line)?.[1] ?? null

const UUID_SUFFIX = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

/** The log formats this plugin reads, one parser per agent CLI. */
export class AgentLogs {
  static readonly claudeCode: AgentParser<ClaudeSummaryRecord, ClaudeTurn> = {
    agent: 'claude-code',
    label: 'Claude Code',
    sessionIdOf: fileName => fileName.replace(/\.jsonl$/, ''),
    relevant: type => CLAUDE_TYPES.has(type),
    decodeSummary: Schema.decodeUnknownOption(Schema.fromJsonString(claudeSummaryRecord)),
    decodeItems: Schema.decodeUnknownOption(Schema.fromJsonString(claudeTurn)),
    summarize: claudeSummarize,
    items: claudeItems,
  }

  static readonly codex: AgentParser<CodexSummaryRecord, CodexItemRecord> = {
    agent: 'codex',
    label: 'Codex',
    sessionIdOf: fileName => UUID_SUFFIX.exec(fileName)?.[1] ?? fileName.replace(/\.jsonl$/, ''),
    relevant: (type, line) => (type === 'event_msg' ? line.includes('"token_count"') : CODEX_TYPES.has(type)),
    decodeSummary: Schema.decodeUnknownOption(Schema.fromJsonString(codexSummaryRecord)),
    decodeItems: Schema.decodeUnknownOption(Schema.fromJsonString(codexItemRecord)),
    summarize: codexSummarize,
    items: codexItems,
  }

  static readonly label = (agent: AgentKind): string => (agent === 'claude-code' ? AgentLogs.claudeCode.label : AgentLogs.codex.label)

  static readonly emptySummary = (): SummaryState => ({
    title: null,
    firstPrompt: null,
    cwd: null,
    gitBranch: null,
    models: [],
    agentVersion: null,
    startedAt: null,
    updatedAt: null,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    lastMessageId: null,
  })

  /** Title for a list row: the agent's own title, else the first prompt, else the id. */
  static readonly displayTitle = (state: SummaryState, sessionId: string): string => state.title ?? state.firstPrompt ?? sessionId

  /**
   * Fold every line of one log into a summary, or collect its items: the two passes the index runs. Typed per agent, so
   * a decoded record never crosses to another agent's parser.
   */
  static readonly forAgent = (agent: AgentKind): AgentReader => (agent === 'claude-code' ? readerOf(AgentLogs.claudeCode) : readerOf(AgentLogs.codex))
}

/** An agent parser with its record type closed over: the index only ever hands it raw lines. */
export interface AgentReader {
  readonly agent: AgentKind
  readonly label: string
  readonly sessionIdOf: (fileName: string) => string
  readonly summarizeLine: (state: SummaryState, line: string) => boolean
  readonly itemsOfLine: (line: string) => readonly ParsedItem[] | null
}

const readerOf = <SummaryRecord, ItemRecord>(parser: AgentParser<SummaryRecord, ItemRecord>): AgentReader => {
  const relevant = (line: string): boolean => {
    const type = firstTypeOf(line)
    return type === null || parser.relevant(type, line)
  }
  return {
    agent: parser.agent,
    label: parser.label,
    sessionIdOf: parser.sessionIdOf,
    summarizeLine: (state, line) =>
      Option.match(relevant(line) ? parser.decodeSummary(line) : Option.none(), {
        onNone: () => false,
        onSome: record => {
          parser.summarize(state, record)
          return true
        },
      }),
    itemsOfLine: line =>
      Option.match(relevant(line) ? parser.decodeItems(line) : Option.none(), { onNone: () => null, onSome: record => parser.items(record) }),
  }
}
