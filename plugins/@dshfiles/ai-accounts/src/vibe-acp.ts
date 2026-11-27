import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, promises as fsPromises, writeFileSync } from 'node:fs'
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
import { clampOptionValue, configOptionsSchema, optionValues, type AcpConfigOptions } from './acp-session-config.js'
import { bridgeCallSchema, CliBridge, MCP_BRIDGE_SOURCE } from './cli-bridge.js'
import type { CliOutcome, CliProcessesPromise, CliRunning } from './cli-processes.js'
import { AiAccountsSchema } from './effect-schema.js'
import { VibeAccountModel } from './vibe-account.js'

/**
 * Mistral Vibe through its own ACP server, `vibe-acp`.
 *
 * `vibe --setup`'s Vibe & Studio allowance billed only the CLI, and the headless `vibe` route could not run DSH's
 * tools. `vibe-acp` is the ACP agent Mistral ships for editors, so each DSH conversation drives one long-lived
 * `vibe-acp` process: DSH's tools reach it as one stdio MCP server handed to `session/new`, Vibe publishes each call
 * as a `tool_call` before running it, the DSH step ends with `toolUse` while the MCP call is held, and the tool result
 * in DSH's next request releases it, continuing the same ACP prompt.
 *
 * Vibe's own mutating tools are not offered: a private agent profile in the process's folder keeps only read-only
 * builtins and the bridged `dsh_*` tools, so every write, edit and command runs through DSH's own tools, approvals,
 * diffs and undo. Vibe publishes MCP tools as `{server}_{tool}`, hence `dsh_apply_patch`.
 */

export const VIBE_ACP_EXECUTABLE = 'vibe-acp'
export const VIBE_ACP_INSTALL_HINT =
  'Install Mistral Vibe 3.x (it ships both `vibe` and `vibe-acp`; see https://docs.mistral.ai/vibe/code/use-vibe-in-other-ides), then run `vibe --setup`'

const MCP_SERVER_NAME = 'dsh'
const MCP_TOOL_PREFIX = `${MCP_SERVER_NAME}_`
/** The agent profile written for one process, selected with `session/set_config_option`. */
const AGENT_NAME = 'dsh'
/** A process nobody asked for in this long is stopped; the next request replays the transcript into a new one. */
const IDLE_PROCESS_MS = 30 * 60_000
/** Each process is a full Vibe session with its own MCP bridge; past this many, the least recently used one stops. */
const MAX_PROCESSES = 6
/**
 * The Vibe builtins this route leaves enabled. Everything else — `write_file`, `edit`, every shell, `task` (whose
 * subagent could mutate) — is absent from `tools/list`, so a mutation has to go through DSH's `dsh_*` tools.
 */
const READ_ONLY_BUILTINS = ['read_file', 'grep', 'web_fetch', 'web_search', 'todo'] as const
/** Vibe's thinking levels, in increasing order, as its `thinking` config option takes them. */
const THINKING_ORDER = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const

const finiteCount = Schema.optional(Schema.Number.check(Schema.isFinite()))
const toolArgumentsSchema = Schema.Record(Schema.String, Schema.Json)
type ToolArguments = typeof toolArgumentsSchema.Type
const textBlockSchema = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })

const costSchema = Schema.Struct({ amount: Schema.Number.check(Schema.isFinite()), currency: Schema.String })

const sessionUpdateSchema = Schema.Struct({
  sessionId: Schema.String,
  update: Schema.Union([
    Schema.Struct({ sessionUpdate: Schema.Literal('agent_message_chunk'), content: textBlockSchema }),
    Schema.Struct({ sessionUpdate: Schema.Literal('agent_thought_chunk'), content: textBlockSchema }),
    Schema.Struct({
      sessionUpdate: Schema.Literal('usage_update'),
      used: finiteCount,
      size: finiteCount,
      cost: Schema.optional(Schema.NullOr(costSchema)),
      _meta: Schema.optional(
        Schema.Struct({
          steps: finiteCount,
          promptTokens: finiteCount,
          completionTokens: finiteCount,
          cachedTokens: finiteCount,
        }),
      ),
    }),
    Schema.Struct({
      sessionUpdate: Schema.Literal('tool_call'),
      toolCallId: Schema.String,
      name: Schema.optional(Schema.String),
      rawInput: Schema.optional(toolArgumentsSchema),
    }),
    Schema.Struct({ sessionUpdate: Schema.String }),
  ]),
})

/** Vibe sends only the call id: which tool it is comes from the `tool_call` it published first. */
const permissionRequestSchema = Schema.Struct({
  toolCall: Schema.Struct({ toolCallId: Schema.optional(Schema.String), name: Schema.optional(Schema.String) }),
  options: Schema.Array(Schema.Struct({ optionId: Schema.String, kind: Schema.String })),
})

const promptResultSchema = Schema.Struct({
  stopReason: Schema.String,
  usage: Schema.optional(Schema.Struct({ inputTokens: finiteCount, outputTokens: finiteCount, totalTokens: finiteCount, cachedReadTokens: finiteCount })),
})
type PromptResult = typeof promptResultSchema.Type

const newSessionSchema = Schema.Struct({ sessionId: Schema.String, configOptions: Schema.optional(configOptionsSchema) })
const configUpdateSchema = Schema.Struct({ configOptions: configOptionsSchema })

/** Where a held tool call stands: the model asked for it, DSH answered it, or both (then it is released). */
interface HeldCall {
  bridgeId?: string | number
  socket?: Socket
  result?: { readonly content: readonly unknown[]; readonly isError: boolean }
}

/** A holder for the session a process's callbacks need, which exists only after its own setup. */
interface SessionRef {
  current: Session | undefined
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
  | { readonly kind: 'toolCall'; readonly id: string; readonly name: string; readonly arguments: ToolArguments }
  /** The model is blocked on a DSH tool call that DSH has not answered yet. */
  | { readonly kind: 'toolsHeld' }
  | { readonly kind: 'turnEnded'; readonly result: PromptResult }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'exited' }

/** Vibe reports cumulative session totals; the ledger needs one step's share, so each take returns the delta. */
interface UsageTotals {
  prompt: number
  completion: number
  cached: number
  cost: number
}

interface Session {
  readonly key: string
  readonly signature: string
  readonly running: CliRunning
  readonly rpc: AcpRpc
  readonly server: Server
  /** Bridge connections the server accepted; `server.close()` leaves these open, which keeps the bridge alive. */
  readonly connections: Set<Socket>
  readonly directory: string
  readonly home: string
  readonly tools: readonly Tool[]
  /** The ACP session, once `session/new` and the agent, model and thinking settings have answered. */
  readonly ready: Promise<string>
  /** Whether an ACP prompt is running; a user message DSH adds meanwhile waits in `queued` for the next one. */
  prompting: boolean
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
  /** Every tool call Vibe published, so a permission request that carries only an id can be classified. */
  readonly toolNamesById: Map<string, string>
  /** The cumulative usage Vibe last reported, and what the ledger already took from it. */
  totals: UsageTotals
  reported: UsageTotals
  /** Whether a `usage_update` ever carried token meta; the prompt result is only a fallback when none did. */
  metaSeen: boolean
  /** The folder removal started for this process, so cleanup runs it once. */
  removal: Promise<void> | undefined
}

/** Vibe names an unauthenticated session after the missing login, which says nothing about how to sign in. */
const actionableFailure = (message: string, home: string): string =>
  /authentication required|not signed in|sign in|unauthorized|401/iu.test(message)
    ? `Vibe ACP is not signed in for this account. Run: ${VibeAccountModel.command(home)}. Then retry. (${message})`
    : message

const levelFor = (reasoning: SimpleStreamOptions['reasoning']): string | undefined => {
  if (reasoning === undefined) return undefined
  return reasoning === 'minimal' ? 'low' : reasoning
}

const promptBlocks = (content: string | readonly (TextContent | ImageContent)[]) =>
  !Array.isArray(content)
    ? [{ type: 'text', text: content }]
    : content.map(block => (block.type === 'text' ? { type: 'text', text: block.text } : { type: 'image', mimeType: block.mimeType, data: block.data }))

/** Vibe adds its own keys to a call's input; DSH's tool gets only the parameters it declares. */
const declaredArguments = (tool: Tool | undefined, input: ToolArguments): ToolArguments => {
  const declared = AiAccountsSchema.decodeResult(Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }), tool?.parameters)
  if (declared._tag !== 'Success') return input
  return Object.fromEntries(Object.entries(input).filter(([key]) => key in declared.success.properties))
}

/**
 * The agent profile `session/set_config_option` selects: DSH's instructions, and an `enabled_tools` allowlist holding
 * only read-only Vibe builtins plus the bridged `dsh_*` tools. Vibe reads agent files from `<root>/.vibe/agents` for
 * every root in `session/new`'s `additionalDirectories`, so this profile lives in the process's own folder and never
 * touches the account's `VIBE_HOME`.
 */
const agentFile = (system: string): string =>
  [
    'display_name = "DeepSeek Harness"',
    'description = "DSH owns this conversation: read-only Vibe tools plus DSH\'s bridged tools."',
    `instructions = ${JSON.stringify(system)}`,
    `enabled_tools = ${JSON.stringify([`${MCP_TOOL_PREFIX}*`, ...READ_ONLY_BUILTINS])}`,
    '',
  ].join('\n')

const zeroTotals = (): UsageTotals => ({ prompt: 0, completion: 0, cached: 0, cost: 0 })

const delta = (total: number, reported: number): number => Math.max(0, total - reported)

export class VibeAcpSessions {
  private readonly sessions = new Map<string, Session>()
  /** Folder removals still waiting for their process to exit. */
  private readonly removals = new Set<Promise<void>>()

  constructor(
    private readonly options: {
      readonly processes: CliProcessesPromise
      readonly home: (provider: string) => string
      readonly executable?: string
    },
  ) {}

  /** Stream one DSH model step through the conversation's `vibe-acp` process. */
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
      fail('error', `Vibe ACP: ${error instanceof Error ? error.message : String(error)}`)
    }
    return stream
  }

  /** The number of live `vibe-acp` processes, for tests and diagnostics. */
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

  /** Take one step's share of Vibe's cumulative usage. */
  private static takeUsage(session: Session): UsageTotals {
    const taken = {
      prompt: delta(session.totals.prompt, session.reported.prompt),
      completion: delta(session.totals.completion, session.reported.completion),
      cached: delta(session.totals.cached, session.reported.cached),
      cost: delta(session.totals.cost, session.reported.cost),
    }
    session.reported = { ...session.totals }
    return taken
  }

  private idleOrAwaiting(session: Session): void {
    if (VibeAcpSessions.pendingTools(session) || session.prompting) {
      session.phase = { kind: 'awaitingTools' }
      return
    }
    session.phase = { kind: 'idle', cancelReap: this.options.processes.after(IDLE_PROCESS_MS, () => this.stopKey(session.key)) }
  }

  /** Tool bookkeeping changed outside a step; a running stream owns those transitions while it lasts. */
  private settle(session: Session): void {
    if (session.phase.kind !== 'idle' && session.phase.kind !== 'awaitingTools') return
    VibeAcpSessions.stopTimer(session.phase)
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
    const replay = earlier.length === 0 ? '' : CliBridge.renderTranscript(earlier)
    const opening = replay === '' ? [] : [{ type: 'text', text: `The conversation so far, which you are continuing:\n${replay}` }]
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
    if (decoded._tag === 'Success') this.absorbPromptUsage(session, decoded.success)
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
        : { kind: 'failed', message: 'Vibe ACP ended the turn with an unreadable result.' },
    )
  }

  /** Vibe's prompt usage is cumulative; it is the fallback only when no `usage_update` carried token meta. */
  private absorbPromptUsage(session: Session, result: PromptResult): void {
    if (session.metaSeen) return
    const usage = result.usage
    if (usage === undefined) return
    session.totals = {
      prompt: usage.inputTokens ?? session.totals.prompt,
      completion: usage.outputTokens ?? session.totals.completion,
      cached: usage.cachedReadTokens ?? session.totals.cached,
      cost: session.totals.cost,
    }
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
    // Vibe republishes a call as it progresses; only the first update carries the call itself.
    if (session.toolNamesById.has(update.toolCallId)) return
    if (update.name !== undefined) session.toolNamesById.set(update.toolCallId, update.name)
    // Vibe's own tools (read, grep, web) run inside `vibe-acp`; only DSH's tools become DSH tool calls.
    if (update.name === undefined || !update.name.startsWith(MCP_TOOL_PREFIX)) return
    const name = update.name.slice(MCP_TOOL_PREFIX.length)
    const tool = session.tools.find(candidate => candidate.name === name)
    const input = declaredArguments(tool, update.rawInput ?? {})
    session.emittedToolUses.push({ id: update.toolCallId, name, argumentsJson: JSON.stringify(input) })
    this.emit(session, { kind: 'toolCall', id: update.toolCallId, name, arguments: input })
    for (const call of session.unmatchedCalls.splice(0)) this.matchCall(session, call)
  }

  private onNotification(session: Session, method: string, params: AcpJson): void {
    if (method !== 'session/update') return
    const decoded = AiAccountsSchema.decodeResult(sessionUpdateSchema, params)
    if (decoded._tag !== 'Success') return
    const update = decoded.success.update
    if (update.sessionUpdate === 'agent_message_chunk' && 'content' in update) this.emit(session, { kind: 'text', text: update.content.text })
    if (update.sessionUpdate === 'agent_thought_chunk' && 'content' in update) this.emit(session, { kind: 'thought', text: update.content.text })
    if (update.sessionUpdate === 'usage_update') {
      if ('_meta' in update && update._meta !== undefined) {
        session.metaSeen = true
        session.totals = {
          prompt: update._meta.promptTokens ?? session.totals.prompt,
          completion: update._meta.completionTokens ?? session.totals.completion,
          cached: update._meta.cachedTokens ?? session.totals.cached,
          cost: update.cost?.amount ?? session.totals.cost,
        }
      }
    }
    if (update.sessionUpdate === 'tool_call' && 'toolCallId' in update) this.onToolCall(session, update)
  }

  /**
   * Vibe asks before it runs a tool the active policy gates, and names only the call id. DSH's own tools are allowed
   * because DSH is what gates them; a read-only builtin is allowed; anything else is rejected, so a mutating tool that
   * somehow reached this session still cannot run unattended.
   */
  private answerPermission(session: Session, method: string, params: AcpJson): { readonly result: AcpJson } | undefined {
    if (method !== 'session/request_permission') return undefined
    const decoded = AiAccountsSchema.decodeResult(permissionRequestSchema, params)
    if (decoded._tag !== 'Success') return { result: { outcome: { outcome: 'cancelled' } } }
    const id = decoded.success.toolCall.toolCallId
    const name = (id === undefined ? undefined : session.toolNamesById.get(id)) ?? decoded.success.toolCall.name
    const runnable = name !== undefined && (name.startsWith(MCP_TOOL_PREFIX) || READ_ONLY_BUILTINS.some(builtin => builtin === name))
    const option = decoded.success.options.find(candidate => candidate.kind.startsWith(runnable ? 'allow' : 'reject'))
    return { result: { outcome: option === undefined ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: option.optionId } } }
  }

  private spawn(input: {
    readonly key: string
    readonly signature: string
    readonly model: Model<string>
    readonly system: string
    readonly tools: readonly Tool[]
    readonly level: string | undefined
  }): Session {
    // A private folder keeps the conversation's files and the managed agent profile out of the account's own
    // `VIBE_HOME`; the empty `workspace` cwd keeps a project's AGENTS.md and config out of the conversation.
    const directory = mkdtempSync(join(tmpdir(), 'dsh-vibe-acp-'))
    const workspace = join(directory, 'workspace')
    const agentRoot = join(directory, 'agent')
    mkdirSync(workspace)
    mkdirSync(join(agentRoot, '.vibe', 'agents'), { recursive: true })
    writeFileSync(join(agentRoot, '.vibe', 'agents', `${AGENT_NAME}.toml`), agentFile(input.system))
    // Windows has no Unix domain socket files; Node serves the same stream API on a named pipe with a random name.
    const socketPath =
      process.platform === 'win32' ? `\\\\.\\pipe\\${basename(directory)}-${randomBytes(12).toString('hex')}-bridge` : join(directory, 'bridge.sock')
    writeFileSync(join(directory, 'tools.json'), JSON.stringify(input.tools.map(CliBridge.toMcpTool)))
    const home = this.options.home(input.model.provider)
    let stderr = ''
    // A missing executable ends the process before the session object exists: hold that outcome until it does.
    let ended: CliOutcome | undefined
    const holder: SessionRef = { current: undefined }
    const sessionOf = (): Session => {
      if (holder.current === undefined) throw new Error('the Vibe ACP session was not set up')
      return holder.current
    }
    const running = this.options.processes.launch({
      executable: this.options.executable ?? VIBE_ACP_EXECUTABLE,
      args: [],
      cwd: workspace,
      env: VibeAccountModel.cliEnvironment({ environment: process.env, home }),
      onLine: line => rpc.accept(line),
      onStderr: text => {
        stderr = `${stderr}${text}`.slice(-2_000)
      },
      onEnd: outcome => {
        if (holder.current === undefined) ended = outcome
        else this.ended(holder.current, outcome, stderr)
      },
    })
    const rpc = new AcpRpc({
      send: line => running.send(line),
      onNotification: (method, params) => this.onNotification(sessionOf(), method, params),
      onRequest: (method, params) => this.answerPermission(sessionOf(), method, params),
    })
    const ready = this.open({ rpc, workspace, agentRoot, directory, socketPath, model: input.model, level: input.level })
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
      queued: [],
      synced: 0,
      lastFingerprint: '',
      produced: 0,
      backlog: [],
      held: new Map(),
      unmatchedCalls: [],
      emittedToolUses: [],
      toolNamesById: new Map(),
      totals: zeroTotals(),
      reported: zeroTotals(),
      metaSeen: false,
      removal: undefined,
      phase: { kind: 'starting' },
    }
    holder.current = session
    if (ended !== undefined) {
      this.ended(session, ended, stderr)
      ended = undefined
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
      this.emit(session, { kind: 'failed', message: `could not open the Vibe tool bridge: ${error.message}` })
      this.cleanup(session)
    })
    return session
  }

  /** Start the ACP session with DSH's tools, then select the managed agent, the model and the thinking level. */
  private async open(input: {
    readonly rpc: AcpRpc
    readonly workspace: string
    readonly agentRoot: string
    readonly directory: string
    readonly socketPath: string
    readonly model: Model<string>
    readonly level: string | undefined
  }): Promise<string> {
    await input.rpc.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'dsh', version: '1' },
    })
    const created = AiAccountsSchema.decodeResult(
      newSessionSchema,
      await input.rpc.request('session/new', {
        cwd: input.workspace,
        // Vibe discovers agent profiles per workspace root, so the managed profile reaches it without a VIBE_HOME write.
        additionalDirectories: [input.agentRoot],
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
    if (created._tag !== 'Success') throw new AcpRequestFailed('session/new', -32603, 'Vibe ACP answered session/new with an unexpected shape.')
    const sessionId = created.success.sessionId
    let options: AcpConfigOptions | undefined = created.success.configOptions
    const select = async (configId: string, value: string): Promise<void> => {
      const updated = AiAccountsSchema.decodeResult(configUpdateSchema, await input.rpc.request('session/set_config_option', { sessionId, configId, value }))
      if (updated._tag === 'Success') options = updated.success.configOptions
    }
    if (!optionValues(options, 'agent').includes(AGENT_NAME))
      throw new AcpRequestFailed(
        'session/set_config_option',
        -32602,
        'Vibe ACP did not load the managed DSH agent profile, so its own write, edit and shell tools would stay enabled. Refusing to run this step; update Mistral Vibe and retry.',
      )
    await select('agent', AGENT_NAME)
    const modelId = VibeAccountModel.canonicalModelId(input.model.id)
    if (!optionValues(options, 'model').includes(modelId))
      throw new AcpRequestFailed(
        'session/set_config_option',
        -32602,
        `Vibe does not offer ${input.model.id} on this account. Pick another model, or refresh the account's model list in AI Accounts.`,
      )
    await select('model', modelId)
    const thinking = input.level === undefined ? undefined : clampOptionValue(input.level, optionValues(options, 'thinking'), THINKING_ORDER)
    if (thinking !== undefined) await select('thinking', thinking)
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
    const applyUsage = (): void => {
      const step = VibeAcpSessions.takeUsage(session)
      output.usage = {
        ...output.usage,
        input: step.prompt,
        output: step.completion,
        cacheRead: step.cached,
        totalTokens: step.prompt + step.completion + step.cached,
        cost: { ...output.usage.cost, total: step.cost },
      }
    }
    const finish = (): void => {
      finished = true
      input.signal?.removeEventListener('abort', onAbort)
      VibeAcpSessions.stopTimer(session.phase)
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
      applyUsage()
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
          fail('error', 'vibe-acp exited before the step finished')
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
          const text = continuing && target.thinking !== '' ? `\n\n${event.text}` : event.text
          target.thinking += text
          stream.push({ type: 'thinking_delta', contentIndex: open.contentIndex, delta: text, partial: output })
          return
        }
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
          if (toolCalls > 0) done('toolUse')
          return
        case 'turnEnded': {
          begin()
          output.rawStopReason = event.result.stopReason
          if (event.result.stopReason === 'cancelled') {
            finish()
            fail('aborted', 'Vibe cancelled the turn')
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
    VibeAcpSessions.stopTimer(session.phase)
    session.phase = { kind: 'streaming', sink: handle }
    for (const event of session.backlog.splice(0)) handle(event)
  }

  /** The process ended: fail the step that was waiting on it, then forget the session and its folder. */
  private ended(session: Session, outcome: CliOutcome, stderr: string): void {
    // Fail before the phase dies: a dying phase only queues events, and no later step drains them.
    if (outcome.kind === 'failed')
      this.emit(session, {
        kind: 'failed',
        message: outcome.missing
          ? `Vibe ACP (vibe-acp) is not installed on the Host. ${VIBE_ACP_INSTALL_HINT}. Then retry.`
          : `vibe-acp failed: ${outcome.message}`,
      })
    else if (outcome.code !== 0)
      this.emit(session, { kind: 'failed', message: `vibe-acp exited with ${String(outcome.code)}${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}` })
    this.die(session)
    session.rpc.close(new Error('vibe-acp exited'))
    this.emit(session, { kind: 'exited' })
    this.cleanup(session)
  }

  private die(session: Session): void {
    VibeAcpSessions.stopTimer(session.phase)
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
    session.rpc.close(new Error('vibe-acp stopped'))
    this.cleanup(session)
  }

  private static async removeAfterExit(session: Session): Promise<void> {
    await session.running.stop()
    await fsPromises.rm(session.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined)
  }

  private cleanup(session: Session): void {
    session.server.close()
    // Ending the accepted connections lets the bridge helper exit instead of outliving its vibe-acp process.
    for (const socket of session.connections) socket.destroy()
    session.connections.clear()
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key)
    if (session.removal !== undefined) return
    const removal = VibeAcpSessions.removeAfterExit(session)
    session.removal = removal
    this.removals.add(removal)
    void removal.finally(() => this.removals.delete(removal))
  }
}
