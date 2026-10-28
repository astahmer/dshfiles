import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type ImageContent,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type Tool,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { z } from 'zod'

/**
 * Claude through the official Claude Code CLI instead of the Messages API.
 *
 * A Team or Max seat's Claude Code allowance only covers requests Claude Code itself makes; the same OAuth token sent
 * over HTTP by another client is billed to the organization's extra usage (a 429 "monthly spend limit" once that cap is
 * reached, while the seat still has quota). Each DSH conversation therefore drives one `claude -p` process in
 * stream-json mode with DSH's own system prompt and no built-in tools. DSH's tools reach it through a small MCP server
 * this module starts: when Claude calls one, the call is held, the DSH step ends with `toolUse`, and the tool result in
 * DSH's next request releases it, so the same process continues the turn.
 */

const MCP_SERVER_NAME = 'dsh'
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`
/** A process nobody asked for in this long is stopped; the next request replays the transcript into a new one. */
const IDLE_PROCESS_MS = 30 * 60_000
/** Each process is a full Claude Code runtime (~150 MB); past this many, the least recently used one stops. */
const MAX_PROCESSES = 6
/** Held tool calls wait for DSH, which may run a tool for hours. */
const MCP_TOOL_TIMEOUT_MS = 24 * 60 * 60_000

/** Stdio MCP server run by the CLI: lists DSH's tools from a file and forwards each call over a unix socket. */
const MCP_BRIDGE_SOURCE = `
import { createConnection } from 'node:net'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const [toolsFile, socketPath] = process.argv.slice(1)
const tools = JSON.parse(readFileSync(toolsFile, 'utf8'))
const send = message => process.stdout.write(JSON.stringify(message) + '\\n')
const socket = createConnection(socketPath)
socket.setEncoding('utf8')
let buffer = ''
socket.on('data', chunk => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const reply = JSON.parse(buffer.slice(0, newline))
    buffer = buffer.slice(newline + 1)
    send({ jsonrpc: '2.0', id: reply.id, result: { content: reply.content, isError: reply.isError } })
  }
})
createInterface({ input: process.stdin }).on('line', line => {
  if (line.trim() === '') return
  const request = JSON.parse(line)
  if (request.method === 'initialize')
    return send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'dsh', version: '1' } } })
  if (request.method === 'tools/list') return send({ jsonrpc: '2.0', id: request.id, result: { tools } })
  if (request.method === 'tools/call') return socket.write(JSON.stringify({ id: request.id, name: request.params.name, arguments: request.params.arguments ?? {} }) + '\\n')
  if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, result: {} })
})
`

/** One line the CLI or the bridge wrote, decoded; a non-JSON line (a warning, a stray log) fails like a malformed one. */
const decodeJsonLine = <Output>(schema: z.ZodType<Output>, line: string): z.ZodSafeParseResult<Output> => {
  try {
    return schema.safeParse(JSON.parse(line))
  } catch {
    return schema.safeParse(undefined)
  }
}

/** A tool_use block's streamed input: JSON text holding an object. */
const toolInputSchema = z
  .string()
  .transform((text, context) => {
    try {
      return JSON.parse(text)
    } catch {
      context.addIssue({ code: 'custom', message: 'tool input is not JSON' })
      return z.NEVER
    }
  })
  .pipe(z.record(z.string(), z.json()))

const bridgeCallSchema = z.object({ id: z.union([z.string(), z.number()]), name: z.string(), arguments: z.record(z.string(), z.unknown()) })

const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text') }),
  z.object({ type: z.literal('thinking') }),
  z.object({ type: z.literal('redacted_thinking') }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string() }),
])
const usageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
  })
  .optional()
const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message_start'), message: z.object({ usage: usageSchema }) }),
  z.object({ type: z.literal('content_block_start'), index: z.number(), content_block: contentBlockSchema }),
  z.object({
    type: z.literal('content_block_delta'),
    index: z.number(),
    delta: z.discriminatedUnion('type', [
      z.object({ type: z.literal('text_delta'), text: z.string() }),
      z.object({ type: z.literal('thinking_delta'), thinking: z.string() }),
      z.object({ type: z.literal('input_json_delta'), partial_json: z.string() }),
      z.object({ type: z.literal('signature_delta') }),
      z.object({ type: z.literal('citations_delta') }),
    ]),
  }),
  z.object({ type: z.literal('content_block_stop'), index: z.number() }),
  z.object({ type: z.literal('message_delta'), delta: z.object({ stop_reason: z.string().nullable().optional() }), usage: usageSchema }),
  z.object({ type: z.literal('message_stop') }),
  z.object({ type: z.literal('ping') }),
])
type StreamEvent = z.infer<typeof streamEventSchema>

const cliLineSchema = z.union([
  z.object({ type: z.literal('stream_event'), event: z.unknown() }),
  z.object({ type: z.literal('result'), is_error: z.boolean().optional(), subtype: z.string().optional(), result: z.string().optional() }),
  z.object({ type: z.string() }),
])

/** Where a held tool call stands: Claude asked for it, DSH answered it, or both (then it is released). */
interface HeldCall {
  bridgeId?: string | number
  socket?: Socket
  result?: { readonly content: readonly unknown[]; readonly isError: boolean }
}

interface Session {
  readonly key: string
  readonly signature: string
  readonly child: ChildProcessWithoutNullStreams
  readonly server: Server
  readonly directory: string
  /** Transcript messages this process has seen, and the fingerprint of the last one. */
  synced: number
  lastFingerprint: string
  /** Assistant messages this process produced since the last sync, which DSH appends to its transcript. */
  produced: number
  /** The DSH stream currently receiving this process's events; events with no listener wait in `backlog`. */
  sink: ((event: CliEvent) => void) | undefined
  readonly backlog: CliEvent[]
  /** Tool calls Claude made through the bridge, by tool_use id, plus calls not yet matched to an id. */
  readonly held: Map<string, HeldCall>
  readonly unmatchedCalls: { readonly name: string; readonly argumentsJson: string; readonly bridgeId: string | number; readonly socket: Socket }[]
  readonly emittedToolUses: { readonly id: string; readonly name: string; argumentsJson: string }[]
  idleTimer: NodeJS.Timeout | undefined
  dead: boolean
}

type CliEvent = { readonly kind: 'stream'; readonly event: StreamEvent } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'exited' }

const fingerprint = (json: string): string => createHash('sha256').update(json).digest('hex').slice(0, 16)

const effortFor = (reasoning: SimpleStreamOptions['reasoning']): string | undefined => {
  if (reasoning === undefined) return undefined
  if (reasoning === 'minimal') return 'low'
  return reasoning
}

const toMcpTool = (tool: Tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })

const userBlocks = (content: string | readonly (TextContent | ImageContent)[]) =>
  !Array.isArray(content)
    ? [{ type: 'text', text: content }]
    : content.map(block =>
        block.type === 'text'
          ? { type: 'text', text: block.text }
          : { type: 'image', source: { type: 'base64', media_type: block.mimeType, data: block.data } },
      )

const toolResultContent = (content: readonly (TextContent | ImageContent)[]) =>
  content.map(block => (block.type === 'text' ? { type: 'text', text: block.text } : { type: 'image', data: block.data, mimeType: block.mimeType }))

/** Plain-text rendering of a transcript a new process must pick up, since stream-json input takes only user turns. */
const renderTranscript = (messages: TranscriptContext['messages']): string => {
  const lines: string[] = []
  for (const message of messages) {
    if (message.role === 'user')
      lines.push(
        `<user>\n${!Array.isArray(message.content) ? message.content : message.content.map(block => (block.type === 'text' ? block.text : '[image]')).join('\n')}\n</user>`,
      )
    if (message.role === 'assistant')
      for (const block of message.content) {
        if (block.type === 'text') lines.push(`<assistant>\n${block.text}\n</assistant>`)
        if (block.type === 'toolCall') lines.push(`<tool_call name="${block.name}" id="${block.id}">${JSON.stringify(block.arguments)}</tool_call>`)
      }
    if (message.role === 'toolResult')
      lines.push(
        `<tool_result name="${message.toolName}" id="${message.toolCallId}"${message.isError ? ' error="true"' : ''}>\n${message.content.map(block => (block.type === 'text' ? block.text : '[image]')).join('\n')}\n</tool_result>`,
      )
  }
  return lines.join('\n')
}

/**
 * First index of the trailing run of user messages DSH appends for one step. One CLI turn answers all of them
 * together, because the CLI treats every stdin line as a prompt of its own.
 */
const trailingUserStart = (conversation: readonly { readonly role: string }[]): number => {
  let start = conversation.length
  while (start > 0 && conversation[start - 1]?.role === 'user') start -= 1
  return start
}

export class ClaudeCliSessions {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly options: { readonly configDir: (provider: string) => string; readonly executable?: string }) {}

  /** Stream one DSH model step through the conversation's `claude` process. */
  stream(model: Model<string>, context: TranscriptContext, streamOptions: SimpleStreamOptions | undefined): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream()
    const output: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: Date.now(),
    }
    const fail = (reason: 'error' | 'aborted', message: string): void => {
      output.stopReason = reason
      output.errorMessage = message
      stream.push({ type: 'error', reason, error: output })
      stream.end(output)
    }
    try {
      const session = this.attach(model, context, streamOptions)
      this.pipe({ session, stream, output, fail, signal: streamOptions?.signal })
    } catch (error) {
      fail('error', `Claude Code CLI: ${error instanceof Error ? error.message : String(error)}`)
    }
    return stream
  }

  /** The number of live `claude` processes, for tests and diagnostics. */
  get processCount(): number {
    return this.sessions.size
  }

  private static settled(session: Session): boolean {
    return session.sink === undefined && session.held.size === 0 && session.unmatchedCalls.length === 0
  }

  dispose(): void {
    for (const session of this.sessions.values()) this.stop(session)
    this.sessions.clear()
  }

  /** The conversation's process, after handing it the transcript messages it has not seen; a new one when they diverged. */
  private attach(model: Model<string>, context: TranscriptContext, streamOptions: SimpleStreamOptions | undefined): Session {
    const messages = context.messages
    const system = getCurrentSystemPrompt(messages)
    const tools = getCurrentTools(messages)
    const effort = effortFor(streamOptions?.reasoning)
    const signature = fingerprint(JSON.stringify({ model: model.id, provider: model.provider, system, tools: tools.map(toMcpTool), effort }))
    // Title, compaction and memory requests share the Session id but not its opening, so they get processes of their own.
    const firstUser = messages.find(message => message.role === 'user')
    const firstSystem = messages.find(message => message.role === 'system')
    const key = `${streamOptions?.sessionId ?? ''}:${model.provider}:${fingerprint(JSON.stringify([firstSystem?.content ?? '', firstUser ?? '']))}`
    const existing = this.sessions.get(key)
    if (existing !== undefined && this.continues(existing, signature, messages)) {
      // Map order is recency order for eviction.
      this.sessions.delete(key)
      this.sessions.set(key, existing)
      this.feed(existing, messages)
      return existing
    }
    if (existing !== undefined) this.stopKey(key)
    // The cap is soft: a process that is streaming or holding a tool call is a live Turn, and killing it ends that
    // Turn with exit 143, so only settled processes are evicted, least recently used first.
    for (const candidate of [...this.sessions.values()]) {
      if (this.sessions.size < MAX_PROCESSES) break
      if (ClaudeCliSessions.settled(candidate)) this.stopKey(candidate.key)
    }
    const session = this.spawn({ key, signature, model, system, tools, effort, provider: model.provider })
    this.sessions.set(key, session)
    const conversation = messages.filter(message => message.role !== 'system')
    const pendingStart = trailingUserStart(conversation)
    const pending = conversation.slice(pendingStart).filter(message => message.role === 'user')
    const earlier = conversation.slice(0, pendingStart)
    const opening = earlier.length === 0 ? [] : [{ type: 'text', text: `The conversation so far, which you are continuing:\n${renderTranscript(earlier)}` }]
    const blocks =
      pending.length === 0
        ? [...opening, { type: 'text', text: 'Continue from where the conversation stopped.' }]
        : [...opening, ...pending.flatMap(message => userBlocks(message.content))]
    this.send(session, blocks)
    session.synced = messages.length
    session.lastFingerprint = fingerprint(JSON.stringify(messages.at(-1) ?? ''))
    return session
  }

  private continues(session: Session, signature: string, messages: TranscriptContext['messages']): boolean {
    if (session.dead || session.signature !== signature || messages.length < session.synced) return false
    if (session.synced > 0 && fingerprint(JSON.stringify(messages[session.synced - 1] ?? '')) !== session.lastFingerprint) return false
    let produced = session.produced
    for (const message of messages.slice(session.synced)) {
      if (message.role === 'system') return false
      if (message.role === 'assistant') {
        if (produced === 0) return false
        produced -= 1
      }
    }
    return true
  }

  /**
   * Hand the process what DSH added since the last step: tool results release held calls, then every user message of
   * this step becomes ONE CLI turn. One stdin line is one request to Claude, so sending each message separately made
   * the CLI answer each in its own turn; only the first reply belonged to the step, and the rest waited in the backlog
   * and were then shown as the answer to the next prompt (a question already answered looked asked again).
   */
  private feed(session: Session, messages: TranscriptContext['messages']): void {
    const added = messages.slice(session.synced)
    for (const message of added) {
      if (message.role === 'toolResult') this.answer(session, message.toolCallId, { content: toolResultContent(message.content), isError: message.isError })
    }
    const pending = added.filter(message => message.role === 'user')
    if (pending.length > 0)
      this.send(
        session,
        pending.flatMap(message => userBlocks(message.content)),
      )
    session.produced = 0
    session.synced = messages.length
    session.lastFingerprint = fingerprint(JSON.stringify(messages.at(-1) ?? ''))
  }

  private send(session: Session, content: readonly unknown[]): void {
    if (content.length === 0) return
    session.child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`)
  }

  private answer(session: Session, toolUseId: string, result: { readonly content: readonly unknown[]; readonly isError: boolean }): void {
    const held = session.held.get(toolUseId) ?? {}
    held.result = result
    session.held.set(toolUseId, held)
    this.release(session, toolUseId)
  }

  private release(session: Session, toolUseId: string): void {
    const held = session.held.get(toolUseId)
    if (held?.result === undefined || held.socket === undefined || held.bridgeId === undefined) return
    held.socket.write(`${JSON.stringify({ id: held.bridgeId, content: held.result.content, isError: held.result.isError })}\n`)
    session.held.delete(toolUseId)
  }

  /** A call from the bridge carries no tool_use id; it belongs to the first emitted tool use with the same name and input. */
  private matchCall(
    session: Session,
    call: { readonly name: string; readonly argumentsJson: string; readonly bridgeId: string | number; readonly socket: Socket },
  ): void {
    const index = session.emittedToolUses.findIndex(use => use.name === call.name && use.argumentsJson === call.argumentsJson)
    const fallback = index === -1 ? session.emittedToolUses.findIndex(use => use.name === call.name) : index
    if (fallback === -1) {
      session.unmatchedCalls.push(call)
      return
    }
    const [use] = session.emittedToolUses.splice(fallback, 1)
    if (use === undefined) return
    const held = session.held.get(use.id) ?? {}
    held.bridgeId = call.bridgeId
    held.socket = call.socket
    session.held.set(use.id, held)
    this.release(session, use.id)
  }

  private spawn(input: {
    readonly key: string
    readonly signature: string
    readonly model: Model<string>
    readonly system: string
    readonly tools: readonly Tool[]
    readonly effort: string | undefined
    readonly provider: string
  }): Session {
    // An empty working directory keeps project CLAUDE.md files and settings out of DSH's conversation.
    const directory = mkdtempSync(join(tmpdir(), 'dsh-claude-cli-'))
    const socketPath = join(directory, 'bridge.sock')
    writeFileSync(join(directory, 'tools.json'), JSON.stringify(input.tools.map(toMcpTool)))
    writeFileSync(join(directory, 'system.md'), input.system)
    writeFileSync(
      join(directory, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: 'stdio',
            command: process.execPath,
            args: ['--input-type=module', '-e', MCP_BRIDGE_SOURCE, join(directory, 'tools.json'), socketPath],
          },
        },
      }),
    )
    const configDir = this.options.configDir(input.provider)
    const environment: NodeJS.ProcessEnv = { ...process.env, MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) }
    // The CLI prefers an API key from the environment over its login, which would bill the API organization instead.
    delete environment['ANTHROPIC_API_KEY']
    delete environment['ANTHROPIC_AUTH_TOKEN']
    environment['CLAUDE_CONFIG_DIR'] = configDir
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model',
      input.model.id,
      '--system-prompt-file',
      join(directory, 'system.md'),
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      join(directory, 'mcp.json'),
      '--permission-mode',
      'bypassPermissions',
      '--no-session-persistence',
      '--setting-sources',
      '',
      ...(input.effort === undefined ? [] : ['--effort', input.effort]),
    ]
    const child = spawn(this.options.executable ?? 'claude', args, { cwd: directory, env: environment, stdio: ['pipe', 'pipe', 'pipe'] })
    const session: Session = {
      key: input.key,
      signature: input.signature,
      child,
      server: createServer(),
      directory,
      synced: 0,
      lastFingerprint: '',
      produced: 0,
      sink: undefined,
      backlog: [],
      held: new Map(),
      unmatchedCalls: [],
      emittedToolUses: [],
      idleTimer: undefined,
      dead: false,
    }
    session.server.on('connection', socket => {
      socket.on('error', () => undefined)
      socket.setEncoding('utf8')
      let buffer = ''
      socket.on('data', (chunk: string) => {
        buffer += chunk
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const parsed = decodeJsonLine(bridgeCallSchema, buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          if (parsed.success)
            this.matchCall(session, {
              name: parsed.data.name,
              argumentsJson: JSON.stringify(parsed.data.arguments),
              bridgeId: parsed.data.id,
              socket,
            })
          newline = buffer.indexOf('\n')
        }
      })
    })
    session.server.listen(socketPath)
    const emit = (event: CliEvent): void => {
      if (session.sink === undefined) session.backlog.push(event)
      else session.sink(event)
    }
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000)
    })
    createInterface({ input: child.stdout }).on('line', line => {
      if (line.trim() === '') return
      const parsed = decodeJsonLine(cliLineSchema, line)
      if (!parsed.success) return
      const value = parsed.data
      if (value.type === 'stream_event' && 'event' in value) {
        const event = streamEventSchema.safeParse(value.event)
        if (event.success) emit({ kind: 'stream', event: event.data })
        return
      }
      if (value.type === 'result' && 'is_error' in value && value.is_error === true)
        emit({ kind: 'failed', message: value.result ?? `Claude Code ended the turn with ${value.subtype ?? 'an error'}` })
    })
    child.on('exit', code => {
      session.dead = true
      if (code !== 0 && code !== null)
        emit({ kind: 'failed', message: `claude exited with ${String(code)}${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}` })
      emit({ kind: 'exited' })
      this.cleanup(session)
    })
    child.on('error', error => {
      session.dead = true
      emit({ kind: 'failed', message: `could not start claude: ${error.message}` })
      this.cleanup(session)
    })
    // A write after the process exited fails with EPIPE; the exit handler already reports the failure.
    child.stdin.on('error', () => undefined)
    session.server.on('error', error => {
      session.dead = true
      emit({ kind: 'failed', message: `could not open the Claude tool bridge: ${error.message}` })
      this.cleanup(session)
    })
    return session
  }

  /** Forward one process's events into one DSH step until its assistant message ends. */
  private pipe(input: {
    readonly session: Session
    readonly stream: AssistantMessageEventStream
    readonly output: AssistantMessage
    readonly fail: (reason: 'error' | 'aborted', message: string) => void
    readonly signal: AbortSignal | undefined
  }): void {
    const { session, stream, output, fail } = input
    if (session.idleTimer !== undefined) clearTimeout(session.idleTimer)
    const open = new Map<number, { readonly kind: 'text' | 'thinking' | 'toolCall'; readonly contentIndex: number; json: string }>()
    let started = false
    let finished = false
    const finish = (): void => {
      finished = true
      session.sink = undefined
      input.signal?.removeEventListener('abort', onAbort)
      session.idleTimer = setTimeout(() => this.stopKey(session.key), IDLE_PROCESS_MS)
    }
    const onAbort = (): void => {
      if (finished) return
      finish()
      // An interrupted process cannot be told which partial message DSH kept; the next step replays into a new one.
      this.stopKey(session.key)
      fail('aborted', 'Request was aborted')
    }
    input.signal?.addEventListener('abort', onAbort)
    const begin = (): void => {
      if (started) return
      started = true
      stream.push({ type: 'start', partial: output })
    }
    const handle = (cliEvent: CliEvent): void => {
      if (finished) return
      if (cliEvent.kind === 'failed') {
        finish()
        fail('error', cliEvent.message)
        return
      }
      if (cliEvent.kind === 'exited') {
        finish()
        fail('error', 'claude exited before the step finished')
        return
      }
      const event = cliEvent.event
      switch (event.type) {
        case 'message_start':
          begin()
          return
        case 'content_block_start': {
          begin()
          const block = event.content_block
          if (block.type === 'text') {
            const contentIndex = output.content.push({ type: 'text', text: '' }) - 1
            open.set(event.index, { kind: 'text', contentIndex, json: '' })
            stream.push({ type: 'text_start', contentIndex, partial: output })
          }
          if (block.type === 'thinking') {
            const contentIndex = output.content.push({ type: 'thinking', thinking: '' }) - 1
            open.set(event.index, { kind: 'thinking', contentIndex, json: '' })
            stream.push({ type: 'thinking_start', contentIndex, partial: output })
          }
          if (block.type === 'tool_use') {
            const name = block.name.startsWith(MCP_TOOL_PREFIX) ? block.name.slice(MCP_TOOL_PREFIX.length) : block.name
            const contentIndex = output.content.push({ type: 'toolCall', id: block.id, name, arguments: {} }) - 1
            open.set(event.index, { kind: 'toolCall', contentIndex, json: '' })
            stream.push({ type: 'toolcall_start', contentIndex, partial: output })
          }
          return
        }
        case 'content_block_delta': {
          const block = open.get(event.index)
          const target = block === undefined ? undefined : output.content[block.contentIndex]
          if (block === undefined || target === undefined) return
          if (event.delta.type === 'text_delta' && target.type === 'text') {
            target.text += event.delta.text
            stream.push({ type: 'text_delta', contentIndex: block.contentIndex, delta: event.delta.text, partial: output })
          }
          if (event.delta.type === 'thinking_delta' && target.type === 'thinking') {
            target.thinking += event.delta.thinking
            stream.push({ type: 'thinking_delta', contentIndex: block.contentIndex, delta: event.delta.thinking, partial: output })
          }
          if (event.delta.type === 'input_json_delta' && target.type === 'toolCall') {
            block.json += event.delta.partial_json
            stream.push({ type: 'toolcall_delta', contentIndex: block.contentIndex, delta: event.delta.partial_json, partial: output })
          }
          return
        }
        case 'content_block_stop': {
          const block = open.get(event.index)
          const target = block === undefined ? undefined : output.content[block.contentIndex]
          open.delete(event.index)
          if (block === undefined || target === undefined) return
          if (target.type === 'text') stream.push({ type: 'text_end', contentIndex: block.contentIndex, content: target.text, partial: output })
          if (target.type === 'thinking') stream.push({ type: 'thinking_end', contentIndex: block.contentIndex, content: target.thinking, partial: output })
          if (target.type === 'toolCall') {
            const parsed = toolInputSchema.safeParse(block.json === '' ? '{}' : block.json)
            target.arguments = parsed.success ? parsed.data : {}
            session.emittedToolUses.push({ id: target.id, name: target.name, argumentsJson: JSON.stringify(target.arguments) })
            const pending = session.unmatchedCalls.splice(0)
            for (const call of pending) this.matchCall(session, call)
            stream.push({ type: 'toolcall_end', contentIndex: block.contentIndex, toolCall: target, partial: output })
          }
          return
        }
        case 'message_delta': {
          const usage = event.usage
          if (usage !== undefined) {
            const cacheRead = usage.cache_read_input_tokens ?? output.usage.cacheRead
            const cacheWrite = usage.cache_creation_input_tokens ?? output.usage.cacheWrite
            const inputTokens = usage.input_tokens ?? output.usage.input
            const outputTokens = usage.output_tokens ?? output.usage.output
            output.usage = {
              ...output.usage,
              input: inputTokens,
              output: outputTokens,
              cacheRead,
              cacheWrite,
              totalTokens: inputTokens + outputTokens + cacheRead + cacheWrite,
            }
          }
          const reason = event.delta.stop_reason
          if (reason === 'tool_use') output.stopReason = 'toolUse'
          else if (reason === 'max_tokens') output.stopReason = 'length'
          else output.stopReason = 'stop'
          if (reason !== null && reason !== undefined) output.rawStopReason = reason
          return
        }
        case 'message_stop':
          finish()
          session.produced += 1
          stream.push({
            type: 'done',
            reason: output.stopReason === 'toolUse' ? 'toolUse' : output.stopReason === 'length' ? 'length' : 'stop',
            message: output,
          })
          stream.end(output)
          return
        default:
          return
      }
    }
    session.sink = handle
    for (const event of session.backlog.splice(0)) handle(event)
  }

  private stopKey(key: string): void {
    const session = this.sessions.get(key)
    if (session === undefined) return
    this.sessions.delete(key)
    this.stop(session)
  }

  private stop(session: Session): void {
    if (session.idleTimer !== undefined) clearTimeout(session.idleTimer)
    session.dead = true
    if (session.child.exitCode === null) session.child.kill()
    this.cleanup(session)
  }

  private cleanup(session: Session): void {
    session.server.close()
    rmSync(session.directory, { recursive: true, force: true })
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key)
  }
}

/** Placeholder credential for pi-ai: the CLI authenticates with its own login, so the route never sends an HTTP token. */
export const CLAUDE_CLI_TOKEN = 'claude-code-cli-login'
