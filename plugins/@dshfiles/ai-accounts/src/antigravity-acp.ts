import { randomBytes } from 'node:crypto'
import { closeSync, mkdirSync, mkdtempSync, openSync, promises as fsPromises, readSync, unwatchFile, watch, watchFile, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
import * as Schema from 'effect/Schema'
import { AcpRequestFailed, AcpRpc, type AcpJson } from './acp-rpc.js'
import {
  ANTIGRAVITY_EXECUTABLE,
  ANTIGRAVITY_INSTALL_HINT,
  AntigravityAccountModel,
  configOptionsSchema,
  type AcpConfigOptions,
  type AntigravityLevel,
} from './antigravity-account.js'
import type { AgyRunning, AntigravityProcessesPromise } from './antigravity-processes.js'
import { neutralSystemPrompt } from './antigravity-system-prompt.js'
import { MCP_BRIDGE_SOURCE, bridgeCallSchema, CliBridge } from './cli-bridge.js'
import { AiAccountsSchema } from './effect-schema.js'

/**
 * Gemini and the other Antigravity models through Google's official Antigravity CLI.
 *
 * Google AI plans (free, AI Pro, AI Ultra) serve coding agents only through `agy`, so each DSH conversation drives one
 * `agy acp` process: the Agent Client Protocol server Google documents for editors, signed in with the account's own
 * login. A custom agent written into the process's private Gemini folder carries a neutral DSH system prompt and
 * turns off Antigravity's built-in tools. DSH's tools reach the model through the shared MCP bridge: when the model calls
 * one, the call is held, the DSH step ends with `toolUse`, and the tool result in DSH's next request releases it, so the
 * same ACP prompt continues the turn.
 */

const MCP_SERVER_NAME = 'dsh'
/** `agy` names an MCP tool `mcp_<server>_<tool>`. */
const MCP_TOOL_PREFIX = `mcp_${MCP_SERVER_NAME}_`
const AGENT_NAME = 'dsh'
/** A process nobody asked for in this long is stopped; the next request replays the transcript into a new one. */
const IDLE_PROCESS_MS = 30 * 60_000
/** Each process is a full Antigravity runtime with its own worker; past this many, the least recently used one stops. */
const MAX_PROCESSES = 6
/**
 * `agy` answers a spent plan (429 RESOURCE_EXHAUSTED) by retrying for minutes without telling its ACP client; only its
 * worker log says so. After this many failed attempts the step fails as a spent quota, so DSH's recovery takes over.
 */
const QUOTA_ATTEMPTS = 3
const QUOTA_RETRY_LINE = /Run: attempt (\d+) failed \(RESOURCE_EXHAUSTED/u
/**
 * `agy acp` truncates a single `session/prompt` past ~192 KB (`<truncated N bytes>`), which silently drops the
 * trailing prompt blocks (the compaction instruction or the user's latest message). Capping the replayed transcript
 * below that limit keeps the trailing prompt intact.
 */
const MAX_PROMPT_BYTES = 160_000
const REPLAY_HEAD_SHARE = 0.25

const finiteCount = Schema.optional(Schema.Number.check(Schema.isFinite()))
const toolArgumentsSchema = Schema.Record(Schema.String, Schema.Json)
type ToolArguments = typeof toolArgumentsSchema.Type
const textBlockSchema = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })

const sessionUpdateSchema = Schema.Struct({
  sessionId: Schema.String,
  update: Schema.Union([
    Schema.Struct({ sessionUpdate: Schema.Literal('agent_message_chunk'), content: textBlockSchema }),
    Schema.Struct({ sessionUpdate: Schema.Literal('agent_thought_chunk'), content: textBlockSchema }),
    Schema.Struct({ sessionUpdate: Schema.Literal('usage_update'), used: finiteCount, size: finiteCount }),
    Schema.Struct({
      sessionUpdate: Schema.Literal('tool_call'),
      toolCallId: Schema.String,
      name: Schema.optional(Schema.String),
      rawInput: Schema.optional(toolArgumentsSchema),
    }),
    Schema.Struct({ sessionUpdate: Schema.String }),
  ]),
})

const permissionRequestSchema = Schema.Struct({
  toolCall: Schema.Struct({ name: Schema.optional(Schema.String) }),
  options: Schema.Array(Schema.Struct({ optionId: Schema.String, kind: Schema.String })),
})

const promptResultSchema = Schema.Struct({
  stopReason: Schema.String,
  usage: Schema.optional(Schema.Struct({ inputTokens: finiteCount, outputTokens: finiteCount, cachedReadTokens: finiteCount, cachedWriteTokens: finiteCount })),
})
type PromptResult = typeof promptResultSchema.Type

const newSessionSchema = Schema.Struct({ sessionId: Schema.String, configOptions: Schema.optional(configOptionsSchema) })
const configUpdateSchema = Schema.Struct({ configOptions: configOptionsSchema })

/** Follows one process's worker log until closed. */
interface QuotaWatch {
  readonly close: () => void
}

/** Where a held tool call stands: the model asked for it, DSH answered it, or both (then it is released). */
interface HeldCall {
  bridgeId?: string | number
  socket?: Socket
  result?: { readonly content: readonly unknown[]; readonly isError: boolean }
}

type SessionPhase =
  | { readonly kind: 'starting' }
  | { readonly kind: 'idle'; readonly cancelReap: () => void }
  | { readonly kind: 'streaming'; readonly sink: (event: AcpEvent) => void }
  | { readonly kind: 'awaitingTools' }
  | { readonly kind: 'dead' }

type AcpEvent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'thought'; readonly text: string }
  | { readonly kind: 'usage'; readonly used: number }
  | { readonly kind: 'toolCall'; readonly id: string; readonly name: string; readonly arguments: ToolArguments }
  /** The model is blocked on a DSH tool call that DSH has not answered yet. */
  | { readonly kind: 'toolsHeld' }
  | { readonly kind: 'turnEnded'; readonly result: PromptResult }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'exited' }

interface Session {
  readonly key: string
  readonly signature: string
  readonly running: AgyRunning
  readonly rpc: AcpRpc
  readonly server: Server
  /** Bridge connections the server accepted; `server.close()` leaves these open, which keeps the bridge alive. */
  readonly connections: Set<Socket>
  readonly directory: string
  /** The HOME whose `~/.gemini` login this process uses. */
  readonly home: string
  readonly tools: readonly Tool[]
  /** The ACP session, once `session/new` and the model and thought level settings have answered. */
  readonly ready: Promise<string>
  /** Whether an ACP prompt is running; a user message DSH adds meanwhile waits in `queued` for the next one. */
  prompting: boolean
  /** Number of tool-use steps already completed inside the running ACP prompt; `result.usage` sums every step. */
  promptSteps: number
  readonly queued: AcpJson[]
  /** Transcript messages this process has seen, and the fingerprint of the last one. */
  synced: number
  lastFingerprint: string
  /** Assistant messages this process produced since the last sync, which DSH appends to its transcript. */
  produced: number
  phase: SessionPhase
  /** Events emitted with no stream listening wait here. */
  readonly backlog: AcpEvent[]
  readonly held: Map<string, HeldCall>
  readonly unmatchedCalls: { readonly name: string; readonly argumentsJson: string; readonly bridgeId: string | number; readonly socket: Socket }[]
  readonly emittedToolUses: { readonly id: string; readonly name: string; readonly argumentsJson: string }[]
  readonly seenToolCalls: Set<string>
  /** Follows the worker log for spent-quota retries; closed with the process. */
  readonly quotaWatch: QuotaWatch
}

/** `agy` names an unauthenticated session "Authentication required", which says nothing about how to sign in. */
const actionableFailure = (message: string, home: string): string =>
  /authentication required|not signed in|sign in/iu.test(message)
    ? `Antigravity CLI is not signed in for this account. Run: ${AntigravityAccountModel.loginHint(home)}. Then retry. (${message})`
    : message

const levelFor = (reasoning: SimpleStreamOptions['reasoning']): AntigravityLevel | undefined => {
  if (reasoning === undefined) return undefined
  if (reasoning === 'minimal') return 'low'
  return reasoning
}

const promptBlocks = (content: string | readonly (TextContent | ImageContent)[]) =>
  !Array.isArray(content)
    ? [{ type: 'text', text: content }]
    : content.map(block => (block.type === 'text' ? { type: 'text', text: block.text } : { type: 'image', mimeType: block.mimeType, data: block.data }))

const sliceUtf8Head = (buffer: Buffer, maxBytes: number): Buffer => {
  let end = Math.min(buffer.length, maxBytes)
  while (end > 0) {
    const byte = buffer[end]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    end -= 1
  }
  return buffer.subarray(0, end)
}

const sliceUtf8Tail = (buffer: Buffer, maxBytes: number): Buffer => {
  let start = Math.max(0, buffer.length - maxBytes)
  while (start < buffer.length) {
    const byte = buffer[start]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    start += 1
  }
  return buffer.subarray(start)
}

const replayOmissionMarker = (omittedBytes: number): string => `\n[… ${String(omittedBytes)} bytes omitted to fit Antigravity CLI prompt limit …]\n`

const fitReplayTranscript = (rendered: string, maxBytes: number): string => {
  const buffer = Buffer.from(rendered, 'utf8')
  if (buffer.length <= maxBytes) return rendered
  const markerBytes = Buffer.byteLength(replayOmissionMarker(buffer.length), 'utf8')
  const available = maxBytes - markerBytes
  if (available <= 0) return ''
  const headBudget = Math.floor(available * REPLAY_HEAD_SHARE)
  const tailBudget = available - headBudget
  const head = sliceUtf8Head(buffer, headBudget)
  const tail = sliceUtf8Tail(buffer, tailBudget)
  const omitted = buffer.length - head.length - tail.length
  return `${head.toString('utf8')}${replayOmissionMarker(omitted)}${tail.toString('utf8')}`
}

/** `agy` adds its own keys (`toolSummary`) to a call's input; DSH's tool gets only the parameters it declares. */
const declaredArguments = (tool: Tool | undefined, input: ToolArguments): ToolArguments => {
  const declared = AiAccountsSchema.decodeResult(Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }), tool?.parameters)
  if (declared._tag !== 'Success') return input
  return Object.fromEntries(Object.entries(input).filter(([key]) => key in declared.success.properties))
}

/** The agent file `agy acp --agent dsh` loads: a neutral prompt replaces Antigravity's, and none of its own tools are on. */
const agentFile = (system: string): string =>
  `---\nname: ${AGENT_NAME}\ndescription: DeepSeek Harness conversation agent.\ntools: []\nmainAgent: true\nsubagent: false\n---\n${neutralSystemPrompt(system)}\n`

export class AntigravityAcpSessions {
  private readonly sessions = new Map<string, Session>()
  /** Folder removals still waiting for their process to exit. */
  private readonly removals = new Set<Promise<void>>()

  constructor(
    private readonly options: {
      readonly processes: AntigravityProcessesPromise
      readonly home: (provider: string) => string
      readonly executable?: string
    },
  ) {}

  /** Stream one DSH model step through the conversation's `agy acp` process. */
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
      fail('error', `Antigravity CLI: ${error instanceof Error ? error.message : String(error)}`)
    }
    return stream
  }

  /** The number of live `agy` processes, for tests and diagnostics. */
  get processCount(): number {
    return this.sessions.size
  }

  /** Stop every process; resolves once their process ranges and private folders are gone. */
  dispose(): Promise<void> {
    for (const session of this.sessions.values()) this.stop(session)
    this.sessions.clear()
    return Promise.all(this.removals).then(() => undefined)
  }

  private static pendingTools = (session: Session): boolean => session.held.size > 0 || session.unmatchedCalls.length > 0 || session.emittedToolUses.length > 0

  private static stopTimer(phase: SessionPhase): void {
    if (phase.kind === 'idle') phase.cancelReap()
  }

  private idleOrAwaiting(session: Session): void {
    if (AntigravityAcpSessions.pendingTools(session) || session.prompting) {
      session.phase = { kind: 'awaitingTools' }
      return
    }
    session.phase = { kind: 'idle', cancelReap: this.options.processes.after(IDLE_PROCESS_MS, () => this.stopKey(session.key)) }
  }

  /** Tool bookkeeping changed outside a step; a running stream owns those transitions while it lasts. */
  private settle(session: Session): void {
    if (session.phase.kind !== 'idle' && session.phase.kind !== 'awaitingTools') return
    AntigravityAcpSessions.stopTimer(session.phase)
    this.idleOrAwaiting(session)
  }

  /** The conversation's process, after handing it the transcript messages it has not seen; a new one when they diverged. */
  private attach(model: Model<string>, context: TranscriptContext, streamOptions: SimpleStreamOptions | undefined): Session {
    const messages = context.messages
    const system = getCurrentSystemPrompt(messages)
    const tools = getCurrentTools(messages)
    const level = levelFor(streamOptions?.reasoning)
    const signature = CliBridge.fingerprint(JSON.stringify({ model: model.id, provider: model.provider, system, tools: tools.map(CliBridge.toMcpTool), level }))
    // Title, compaction and memory requests share the Session id but not its opening, so they get processes of their own.
    const firstUser = messages.find(message => message.role === 'user')
    const firstSystem = messages.find(message => message.role === 'system')
    const key = `${streamOptions?.sessionId ?? ''}:${model.provider}:${CliBridge.fingerprint(JSON.stringify([firstSystem?.content ?? '', firstUser ?? '']))}`
    const existing = this.sessions.get(key)
    if (existing !== undefined && this.continues(existing, signature, messages)) {
      // Map order is recency order for eviction.
      this.sessions.delete(key)
      this.sessions.set(key, existing)
      this.feed(existing, messages)
      return existing
    }
    if (existing !== undefined) this.stopKey(key)
    // Only settled processes are evicted: one that streams or holds a tool call is a live Turn.
    for (const candidate of [...this.sessions.values()]) {
      if (this.sessions.size < MAX_PROCESSES) break
      if (candidate.phase.kind === 'idle') this.stopKey(candidate.key)
    }
    const session = this.spawn({ key, signature, model, system, tools, level })
    this.sessions.set(key, session)
    const conversation = messages.filter(message => message.role !== 'system')
    const pendingStart = CliBridge.trailingUserStart(conversation)
    const pending = conversation.slice(pendingStart).filter(message => message.role === 'user')
    const earlier = conversation.slice(0, pendingStart)
    const pendingBlocks =
      pending.length === 0
        ? [{ type: 'text', text: 'Continue from where the conversation stopped.' }]
        : pending.flatMap(message => promptBlocks(message.content))
    const pendingBytes = pendingBlocks.reduce((sum, block) => sum + ('text' in block ? Buffer.byteLength(block.text, 'utf8') : 0), 0)
    const openingPrefix = 'The conversation so far, which you are continuing:\n'
    const openingBudget = MAX_PROMPT_BYTES - pendingBytes - Buffer.byteLength(openingPrefix, 'utf8')
    const replay = earlier.length === 0 ? '' : fitReplayTranscript(CliBridge.renderTranscript(earlier), openingBudget)
    const opening = replay === '' ? [] : [{ type: 'text', text: `${openingPrefix}${replay}` }]
    this.prompt(session, [...opening, ...pendingBlocks])
    session.synced = messages.length
    session.lastFingerprint = CliBridge.fingerprint(JSON.stringify(messages.at(-1) ?? ''))
    return session
  }

  private continues(session: Session, signature: string, messages: TranscriptContext['messages']): boolean {
    if (session.phase.kind === 'dead' || session.signature !== signature || messages.length < session.synced) return false
    if (session.synced > 0 && CliBridge.fingerprint(JSON.stringify(messages[session.synced - 1] ?? '')) !== session.lastFingerprint) return false
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

  /** Hand the process what DSH added since the last step: tool results release held calls, user messages become one prompt. */
  private feed(session: Session, messages: TranscriptContext['messages']): void {
    const added = messages.slice(session.synced)
    for (const message of added) {
      if (message.role === 'toolResult')
        this.answer(session, message.toolCallId, { content: CliBridge.toolResultContent(message.content), isError: message.isError })
    }
    const pending = added.filter(message => message.role === 'user')
    if (pending.length > 0)
      this.prompt(
        session,
        pending.flatMap(message => promptBlocks(message.content)),
      )
    session.produced = 0
    session.synced = messages.length
    session.lastFingerprint = CliBridge.fingerprint(JSON.stringify(messages.at(-1) ?? ''))
  }

  /** ACP runs one prompt at a time per session: a prompt asked for while one runs follows it. */
  private prompt(session: Session, blocks: readonly AcpJson[]): void {
    if (blocks.length === 0) return
    if (session.prompting) {
      session.queued.push(...blocks)
      return
    }
    session.prompting = true
    session.promptSteps = 0
    void this.runPrompt(session, blocks)
  }

  private async runPrompt(session: Session, blocks: readonly AcpJson[]): Promise<void> {
    let result: AcpJson
    try {
      result = await session.rpc.request('session/prompt', { sessionId: await session.ready, prompt: blocks })
    } catch (error) {
      session.prompting = false
      session.queued.splice(0)
      this.emit(session, { kind: 'failed', message: actionableFailure(error instanceof Error ? error.message : String(error), session.home) })
      return
    }
    session.prompting = false
    const decoded = AiAccountsSchema.decodeResult(promptResultSchema, result)
    const next = session.queued.splice(0)
    // A queued prompt continues the same DSH step: its answer is the reply to what DSH asked.
    if (next.length > 0 && decoded._tag === 'Success' && decoded.success.stopReason === 'end_turn') {
      this.prompt(session, next)
      return
    }
    this.emit(
      session,
      decoded._tag === 'Success'
        ? { kind: 'turnEnded', result: decoded.success }
        : { kind: 'failed', message: 'Antigravity CLI ended the turn with an unreadable result.' },
    )
  }

  private emit(session: Session, event: AcpEvent): void {
    if (session.phase.kind === 'streaming') session.phase.sink(event)
    else session.backlog.push(event)
  }

  private answer(session: Session, toolUseId: string, result: { readonly content: readonly unknown[]; readonly isError: boolean }): void {
    const held = session.held.get(toolUseId) ?? {}
    held.result = result
    session.held.set(toolUseId, held)
    this.release(session, toolUseId)
    this.settle(session)
  }

  private release(session: Session, toolUseId: string): boolean {
    const held = session.held.get(toolUseId)
    if (held?.result === undefined || held.socket === undefined || held.bridgeId === undefined) return false
    held.socket.write(`${JSON.stringify({ id: held.bridgeId, content: held.result.content, isError: held.result.isError })}\n`)
    session.held.delete(toolUseId)
    return true
  }

  /** A call from the bridge carries no tool call id; it belongs to the first emitted tool call with the same name and input. */
  private matchCall(
    session: Session,
    call: { readonly name: string; readonly argumentsJson: string; readonly bridgeId: string | number; readonly socket: Socket },
  ): void {
    const exact = session.emittedToolUses.findIndex(use => use.name === call.name && use.argumentsJson === call.argumentsJson)
    const index = exact === -1 ? session.emittedToolUses.findIndex(use => use.name === call.name) : exact
    if (index === -1) {
      session.unmatchedCalls.push(call)
      return
    }
    const [use] = session.emittedToolUses.splice(index, 1)
    if (use === undefined) return
    const held = session.held.get(use.id) ?? {}
    held.bridgeId = call.bridgeId
    held.socket = call.socket
    session.held.set(use.id, held)
    if (!this.release(session, use.id)) this.emit(session, { kind: 'toolsHeld' })
    this.settle(session)
  }

  private onToolCall(
    session: Session,
    update: { readonly toolCallId: string; readonly name?: string | undefined; readonly rawInput?: ToolArguments | undefined },
  ): void {
    if (session.seenToolCalls.has(update.toolCallId)) return
    session.seenToolCalls.add(update.toolCallId)
    // Antigravity's own tools (task list, resources) run inside `agy`; only DSH's tools become DSH tool calls.
    if (update.name === undefined || !update.name.startsWith(MCP_TOOL_PREFIX)) return
    const name = update.name.slice(MCP_TOOL_PREFIX.length)
    const tool = session.tools.find(candidate => candidate.name === name)
    const input = declaredArguments(tool, update.rawInput ?? {})
    session.emittedToolUses.push({ id: update.toolCallId, name, argumentsJson: JSON.stringify(input) })
    this.emit(session, { kind: 'toolCall', id: update.toolCallId, name, arguments: input })
    for (const call of session.unmatchedCalls.splice(0)) this.matchCall(session, call)
  }

  /**
   * Follow the worker log in the private Gemini folder for lines that report a spent quota. `fs.watch` finds the log when
   * the worker creates it, but on macOS it does not report the appends that follow, so the file is then polled by stat.
   */
  private static watchQuota(input: { readonly geminiDir: string; readonly onSpent: () => void }): QuotaWatch {
    const offsets = new Map<string, number>()
    const read = (path: string): void => {
      let descriptor: number
      try {
        descriptor = openSync(path, 'r')
      } catch {
        return
      }
      try {
        const buffer = Buffer.alloc(64 * 1024)
        let offset = offsets.get(path) ?? 0
        let text = ''
        for (let count = readSync(descriptor, buffer, 0, buffer.length, offset); count > 0; count = readSync(descriptor, buffer, 0, buffer.length, offset)) {
          text += buffer.toString('utf8', 0, count)
          offset += count
        }
        offsets.set(path, offset)
        const attempts = text
          .split('\n')
          .map(line => Number(QUOTA_RETRY_LINE.exec(line)?.[1] ?? 0))
          .reduce((highest, attempt) => Math.max(highest, attempt), 0)
        if (attempts >= QUOTA_ATTEMPTS) input.onSpent()
      } finally {
        closeSync(descriptor)
      }
    }
    const follow = (path: string): void => {
      if (offsets.has(path)) return
      offsets.set(path, 0)
      watchFile(path, { interval: 2_000, persistent: false }, () => read(path))
      read(path)
    }
    let watcher: ReturnType<typeof watch> | undefined
    try {
      watcher = watch(input.geminiDir, { recursive: true, persistent: false }, (_event, file) => {
        if (file !== null && /acp-worker-[^/\\]*\.log$/u.test(file)) follow(join(input.geminiDir, file))
      }).on('error', () => undefined)
    } catch {
      watcher = undefined
    }
    return {
      close: () => {
        watcher?.close()
        for (const path of offsets.keys()) unwatchFile(path)
      },
    }
  }

  /** The plan is spent: fail the running step as a quota failure and stop the process, which would keep retrying. */
  private quotaSpent(session: Session): void {
    if (!session.prompting || session.phase.kind === 'dead') return
    this.emit(session, {
      kind: 'failed',
      message: `Antigravity quota exhausted: Google answers 429 RESOURCE_EXHAUSTED for this account's plan. Wait for it to reset (run ${AntigravityAccountModel.command(session.home)} and type /usage to see when), or switch this thread to another account.`,
    })
    this.stopKey(session.key)
  }

  private onNotification(session: Session, method: string, params: AcpJson): void {
    if (method !== 'session/update') return
    const decoded = AiAccountsSchema.decodeResult(sessionUpdateSchema, params)
    if (decoded._tag !== 'Success') return
    const update = decoded.success.update
    if (update.sessionUpdate === 'agent_message_chunk' && 'content' in update) this.emit(session, { kind: 'text', text: update.content.text })
    if (update.sessionUpdate === 'agent_thought_chunk' && 'content' in update) this.emit(session, { kind: 'thought', text: update.content.text })
    if (update.sessionUpdate === 'usage_update' && 'used' in update && update.used !== undefined && update.used > 0)
      this.emit(session, { kind: 'usage', used: update.used })
    if (update.sessionUpdate === 'tool_call' && 'toolCallId' in update) this.onToolCall(session, update)
  }

  /** `agy` runs with permissions skipped; should it still ask, only DSH's own tools are allowed. */
  private static answerPermission = (method: string, params: AcpJson): { readonly result: AcpJson } | undefined => {
    if (method !== 'session/request_permission') return undefined
    const decoded = AiAccountsSchema.decodeResult(permissionRequestSchema, params)
    if (decoded._tag !== 'Success') return { result: { outcome: { outcome: 'cancelled' } } }
    const runnable = decoded.success.toolCall.name?.startsWith(MCP_TOOL_PREFIX) === true
    const option = decoded.success.options.find(candidate => candidate.kind.startsWith(runnable ? 'allow' : 'reject'))
    return { result: { outcome: option === undefined ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: option.optionId } } }
  }

  private spawn(input: {
    readonly key: string
    readonly signature: string
    readonly model: Model<string>
    readonly system: string
    readonly tools: readonly Tool[]
    readonly level: AntigravityLevel | undefined
  }): Session {
    // An empty working directory keeps project instructions and settings out of DSH's conversation, and a private
    // Gemini folder keeps the conversation's files, settings and agent out of the user's own `agy` history.
    const directory = mkdtempSync(join(tmpdir(), 'dsh-agy-'))
    const geminiDir = join(directory, 'gemini')
    mkdirSync(join(geminiDir, 'config', 'agents'), { recursive: true })
    writeFileSync(join(geminiDir, 'config', 'agents', `${AGENT_NAME}.md`), agentFile(input.system))
    // Windows has no Unix domain socket files; Node serves the same stream API on a named pipe with a random name.
    const socketPath =
      process.platform === 'win32' ? `\\\\.\\pipe\\${basename(directory)}-${randomBytes(12).toString('hex')}-bridge` : join(directory, 'bridge.sock')
    writeFileSync(join(directory, 'tools.json'), JSON.stringify(input.tools.map(CliBridge.toMcpTool)))
    const home = this.options.home(input.model.provider)
    const args = [
      'acp',
      '--gemini-dir',
      geminiDir,
      '--agent',
      AGENT_NAME,
      // MCP servers given to `session/new` reach a custom agent only when the session runs in its own worker.
      '--process-per-session',
      // DSH runs and approves its own tools; nothing else is enabled for `agy` to ask about.
      '--dangerously-skip-permissions',
      '--disable-telemetry',
    ]
    let stderr = ''
    // The handlers run only once agy writes or ends, after `rpc` and `session` below exist.
    const running = this.options.processes.launch({
      executable: this.options.executable ?? ANTIGRAVITY_EXECUTABLE,
      args,
      cwd: directory,
      env: AntigravityAccountModel.cliEnvironment({ environment: process.env, home }),
      onLine: line => rpc.accept(line),
      onStderr: text => {
        stderr = `${stderr}${text}`.slice(-2_000)
      },
      onEnd: outcome => {
        this.die(session)
        rpc.close(new Error('agy exited'))
        if (outcome.kind === 'failed')
          this.emit(session, {
            kind: 'failed',
            message: outcome.missing
              ? `Antigravity CLI (agy) is not installed on the Host. Install it with: ${ANTIGRAVITY_INSTALL_HINT}. Then retry.`
              : `agy failed: ${outcome.message}`,
          })
        else if (outcome.code !== 0)
          this.emit(session, { kind: 'failed', message: `agy exited with ${String(outcome.code)}${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}` })
        this.emit(session, { kind: 'exited' })
        this.cleanup(session)
      },
    })
    const rpc = new AcpRpc({
      send: line => running.send(line),
      onNotification: (method, params) => this.onNotification(session, method, params),
      onRequest: AntigravityAcpSessions.answerPermission,
    })
    const ready = this.open({ rpc, directory, socketPath, model: input.model, level: input.level })
    // A failed opening already fails the prompt that waits on it.
    ready.catch(() => undefined)
    const session: Session = {
      key: input.key,
      signature: input.signature,
      running,
      rpc,
      server: createServer(),
      connections: new Set(),
      directory,
      home,
      tools: input.tools,
      ready,
      prompting: false,
      promptSteps: 0,
      queued: [],
      synced: 0,
      lastFingerprint: '',
      produced: 0,
      backlog: [],
      held: new Map(),
      unmatchedCalls: [],
      emittedToolUses: [],
      seenToolCalls: new Set(),
      quotaWatch: AntigravityAcpSessions.watchQuota({ geminiDir, onSpent: () => this.quotaSpent(session) }),
      phase: { kind: 'starting' },
    }
    session.server.on('connection', socket => {
      session.connections.add(socket)
      socket.once('close', () => session.connections.delete(socket))
      socket.on('error', () => undefined)
      socket.setEncoding('utf8')
      let buffer = ''
      socket.on('data', (chunk: string) => {
        buffer += chunk
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const parsed = CliBridge.decodeJsonLine(bridgeCallSchema, buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
          if (parsed._tag === 'Success')
            this.matchCall(session, { name: parsed.success.name, argumentsJson: JSON.stringify(parsed.success.arguments), bridgeId: parsed.success.id, socket })
          newline = buffer.indexOf('\n')
        }
      })
    })
    session.server.listen(socketPath)
    session.server.on('error', error => {
      this.die(session)
      this.emit(session, { kind: 'failed', message: `could not open the Antigravity tool bridge: ${error.message}` })
      this.cleanup(session)
    })
    return session
  }

  /** Start the ACP session with DSH's tools, then select the model and thought level the request asked for. */
  private async open(input: {
    readonly rpc: AcpRpc
    readonly directory: string
    readonly socketPath: string
    readonly model: Model<string>
    readonly level: AntigravityLevel | undefined
  }): Promise<string> {
    await input.rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'dsh', version: '1' },
    })
    const created = AiAccountsSchema.decodeResult(
      newSessionSchema,
      await input.rpc.request('session/new', {
        cwd: input.directory,
        mcpServers: [
          {
            name: MCP_SERVER_NAME,
            command: process.execPath,
            args: ['--input-type=module', '-e', MCP_BRIDGE_SOURCE, join(input.directory, 'tools.json'), input.socketPath],
            env: [],
          },
        ],
      }),
    )
    if (created._tag !== 'Success') throw new AcpRequestFailed('session/new', -32603, 'Antigravity CLI answered session/new with an unexpected shape.')
    const sessionId = created.success.sessionId
    let options: AcpConfigOptions | undefined = created.success.configOptions
    const select = async (configId: string, value: string): Promise<void> => {
      const updated = AiAccountsSchema.decodeResult(configUpdateSchema, await input.rpc.request('session/set_config_option', { sessionId, configId, value }))
      if (updated._tag === 'Success') options = updated.success.configOptions
    }
    if (!AntigravityAccountModel.optionValues(options, 'model').includes(input.model.id))
      throw new AcpRequestFailed(
        'session/set_config_option',
        -32602,
        `Antigravity does not offer ${input.model.id} on this account. Pick another model, or refresh the account's model list in AI Accounts.`,
      )
    await select('model', input.model.id)
    const level = input.level === undefined ? undefined : AntigravityAccountModel.clampLevel(input.level, AntigravityAccountModel.levelsOf(options))
    if (level !== undefined) await select('thought_level', level)
    return sessionId
  }

  /** Forward one process's events into one DSH step until the turn ends or the model waits on DSH's tools. */
  private pipe(input: {
    readonly session: Session
    readonly stream: AssistantMessageEventStream
    readonly output: AssistantMessage
    readonly fail: (reason: 'error' | 'aborted', message: string) => void
    readonly signal: AbortSignal | undefined
  }): void {
    const { session, stream, output, fail } = input
    let open: { readonly kind: 'text' | 'thinking'; readonly contentIndex: number } | undefined
    let started = false
    let finished = false
    let toolCalls = 0
    let stepUsed: number | undefined
    const applyStepUsage = (used: number): void => {
      output.usage = {
        ...output.usage,
        input: used,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: used,
      }
    }
    const finish = (): void => {
      finished = true
      input.signal?.removeEventListener('abort', onAbort)
      AntigravityAcpSessions.stopTimer(session.phase)
      if (session.phase.kind !== 'dead') this.idleOrAwaiting(session)
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
    const close = (): void => {
      const target = open === undefined ? undefined : output.content[open.contentIndex]
      if (open !== undefined && target?.type === 'text')
        stream.push({ type: 'text_end', contentIndex: open.contentIndex, content: target.text, partial: output })
      if (open !== undefined && target?.type === 'thinking')
        stream.push({ type: 'thinking_end', contentIndex: open.contentIndex, content: target.thinking, partial: output })
      open = undefined
    }
    const done = (reason: 'stop' | 'length' | 'toolUse'): void => {
      close()
      finish()
      session.produced += 1
      output.stopReason = reason
      stream.push({ type: 'done', reason, message: output })
      stream.end(output)
    }
    const handle = (event: AcpEvent): void => {
      if (finished) return
      switch (event.kind) {
        case 'failed':
          finish()
          fail('error', event.message)
          return
        case 'exited':
          finish()
          fail('error', 'agy exited before the step finished')
          return
        case 'text': {
          begin()
          if (open?.kind !== 'text') {
            close()
            open = { kind: 'text', contentIndex: output.content.push({ type: 'text', text: '' }) - 1 }
            stream.push({ type: 'text_start', contentIndex: open.contentIndex, partial: output })
          }
          const target = output.content[open.contentIndex]
          if (target?.type !== 'text') return
          target.text += event.text
          stream.push({ type: 'text_delta', contentIndex: open.contentIndex, delta: event.text, partial: output })
          return
        }
        case 'thought': {
          begin()
          // Each thought chunk is a separate summary; a blank line keeps them apart.
          const continuing = open?.kind === 'thinking'
          if (!continuing) {
            close()
            open = { kind: 'thinking', contentIndex: output.content.push({ type: 'thinking', thinking: '' }) - 1 }
            stream.push({ type: 'thinking_start', contentIndex: open.contentIndex, partial: output })
          }
          if (open === undefined) return
          const target = output.content[open.contentIndex]
          if (target?.type !== 'thinking') return
          const delta = continuing && target.thinking !== '' ? `\n\n${event.text}` : event.text
          target.thinking += delta
          stream.push({ type: 'thinking_delta', contentIndex: open.contentIndex, delta, partial: output })
          return
        }
        case 'usage':
          stepUsed = event.used
          return
        case 'toolCall': {
          begin()
          close()
          toolCalls += 1
          const contentIndex = output.content.push({ type: 'toolCall', id: event.id, name: event.name, arguments: { ...event.arguments } }) - 1
          const toolCall = output.content[contentIndex]
          stream.push({ type: 'toolcall_start', contentIndex, partial: output })
          if (toolCall?.type === 'toolCall') stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: output })
          return
        }
        case 'toolsHeld':
          if (toolCalls > 0) {
            if (stepUsed !== undefined) applyStepUsage(stepUsed)
            session.promptSteps += 1
            done('toolUse')
          }
          return
        case 'turnEnded': {
          begin()
          if (session.promptSteps > 0 && stepUsed !== undefined) {
            applyStepUsage(stepUsed)
          } else {
            const usage = event.result.usage
            const inputTokens = usage?.inputTokens ?? 0
            const outputTokens = usage?.outputTokens ?? 0
            const cacheRead = usage?.cachedReadTokens ?? 0
            const cacheWrite = usage?.cachedWriteTokens ?? 0
            output.usage = {
              ...output.usage,
              input: inputTokens,
              output: outputTokens,
              cacheRead,
              cacheWrite,
              totalTokens: inputTokens + outputTokens + cacheRead + cacheWrite,
            }
          }
          output.rawStopReason = event.result.stopReason
          if (event.result.stopReason === 'cancelled') {
            finish()
            fail('aborted', 'Antigravity cancelled the turn')
            return
          }
          if (event.result.stopReason === 'refusal') {
            finish()
            fail('error', 'The model refused to continue this turn.')
            return
          }
          done(event.result.stopReason === 'max_tokens' || event.result.stopReason === 'max_turn_requests' ? 'length' : 'stop')
          return
        }
      }
    }
    AntigravityAcpSessions.stopTimer(session.phase)
    session.phase = { kind: 'streaming', sink: handle }
    for (const event of session.backlog.splice(0)) handle(event)
  }

  private die(session: Session): void {
    AntigravityAcpSessions.stopTimer(session.phase)
    session.phase = { kind: 'dead' }
  }

  private stopKey(key: string): void {
    const session = this.sessions.get(key)
    if (session === undefined) return
    this.sessions.delete(key)
    this.stop(session)
  }

  private stop(session: Session): void {
    this.die(session)
    session.rpc.close(new Error('agy stopped'))
    this.cleanup(session)
  }

  private static async removeAfterExit(session: Session): Promise<void> {
    await session.running.stop()
    await fsPromises.rm(session.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined)
  }

  private cleanup(session: Session): void {
    session.quotaWatch.close()
    session.server.close()
    // Ending the accepted connections lets the bridge helper exit instead of outliving its agy process.
    for (const socket of session.connections) socket.destroy()
    session.connections.clear()
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key)
    // `agy` and its session worker may still be flushing into the folder (and on Windows lock it) until their process range
    // is gone, so the removal waits for it in the background instead of blocking the Host.
    const removal = AntigravityAcpSessions.removeAfterExit(session)
    this.removals.add(removal)
    void removal.finally(() => this.removals.delete(removal))
  }
}
