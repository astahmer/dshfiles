// Ported from @loongsuite/dsh-plugin 0.1.3 (src/coordinator.ts), Apache-2.0; see NOTICE and UPSTREAM.md for what
// changed (dshx spans, active context around tool bodies and model streams, subagent parenting, wait spans).
import type { StreamChunk, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm'
import { activeSpanContext, redactIdentifier, startSpan, tracingEnabled, withActiveSpan, type Span, type SpanContext } from '@dshfiles/dshx/tracing'
import { z } from 'zod'
import { CostAttributes, type PriceCall } from './cost.js'
import {
  AGENT_SYSTEM,
  GenAi,
  GenAiNames,
  operationAttributes,
  type Attributes,
  type CapturedMessage,
  type GenAiMessage,
  type LooseBlock,
  type UsageTotals,
  messageSchema,
} from './genai.js'

export interface ObservedSession {
  readonly id: string
  readonly header: {
    readonly cwd?: string | undefined
    readonly parentSession?: string | undefined
    readonly origin?: string | undefined
    readonly delegationDepth?: number | undefined
    readonly agentPreset?: string | undefined
  }
}

export interface ObservedEvent {
  readonly type: string
  readonly data: unknown
}

/** The fields of a `tools/execute` dispatch telemetry reads; DSH's `ObservedToolCall` satisfies it. */
export interface ObservedToolCall {
  readonly callId: string
  readonly rootCallId: string
  readonly name: string
  readonly agent?: { readonly id: string } | undefined
  /** Set on a nested dispatch (a `run_code` sub-call); its value is an opaque token. */
  readonly parent?: unknown
}

export interface ObservedToolResult {
  readonly isError: boolean
  readonly error?: { readonly info?: { readonly code: string } | undefined } | undefined
}

/** The fields of an `llm/stream` request telemetry reads; DSH's `ObservedLlmRequest` satisfies it. */
export interface ObservedLlmRequest {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
  readonly system?: string | undefined
  readonly tools?: readonly ToolSchema[] | undefined
  readonly temperature?: number | undefined
  readonly maxTokens?: number | undefined
  readonly stop?: readonly string[] | undefined
  readonly signal?: AbortSignal | undefined
  readonly sessionId?: string | undefined
  readonly purpose?: string | undefined
}

export interface CoordinatorOptions {
  /** Read at every span that may carry content, so the setting and the environment apply live. */
  readonly captureContent: () => boolean
  readonly warn: (message: string) => void
  /** List price of one model call; absent or undefined leaves the span without `dshx.cost.usd`. */
  readonly priceCall?: PriceCall | undefined
}

/** How a turn's root span found its parent; recorded as `dsh.trace.parent_link` so the choice is visible in a trace. */
type ParentLink = 'root' | 'async-context' | 'created-in-tool' | 'running-tool' | 'parent-turn'

interface TurnParent {
  readonly parent: SpanContext | null
  readonly link: ParentLink
}

interface ToolState {
  readonly span: Span
  readonly name: string
  readonly startedAt: number
  ended: boolean
}

interface LlmState {
  readonly span: Span
  readonly options: ObservedLlmRequest
  readonly inputMessages: readonly GenAiMessage[]
  readonly blocks: LooseBlock[]
  readonly startedAt: number
  readonly step: StepState | undefined
  usage: TokenUsage | undefined
  firstTokenSeen: boolean
  ended: boolean
}

interface StepState {
  readonly turn: number
  readonly step: number
  readonly span: Span
  readonly tools: Map<string, ToolState>
  readonly llms: Set<LlmState>
  nextAttempt: number
  lastFinishReason: string | undefined
}

interface TurnState {
  readonly turn: number
  readonly entry: Span
  readonly agent: Span
  step: StepState | undefined
  readonly contextMessages: CapturedMessage[]
  readonly inputs: GenAiMessage[]
  readonly outputs: GenAiMessage[]
  readonly usage: UsageTotals
  costUsd: number | undefined
  splicedMessages: number
}

interface SessionState {
  readonly session: ObservedSession
  readonly creationParent: SpanContext | undefined
  turn: TurnState | undefined
  readonly approvals: Map<string, Span>
  readonly retries: Map<string, Span>
  readonly compactions: Map<string, Span>
}

const DELEGATION_TOOLS = new Set(['subagent', 'subagent_fork', 'workflow', 'send_message'])

const idSchema = z.union([z.string(), z.number()]).transform(String)
const turnSchema = z.object({ turn: z.number() })
const stepSchema = z.object({ turn: z.number(), step: z.number() })
const turnEndSchema = z.object({
  turn: z.number(),
  reason: z.looseObject({ kind: z.string(), error: z.looseObject({ code: z.string().optional() }).optional() }),
})
const toolCallSchema = z.object({ turn: z.number(), step: z.number(), callId: idSchema, name: z.string(), arguments: z.string().catch('') })
const toolResultSchema = z.object({
  turn: z.number(),
  step: z.number(),
  message: messageSchema,
  error: z.looseObject({ name: z.string(), code: z.string() }).optional(),
})
const assistantMessageSchema = z.object({ turn: z.number(), step: z.number(), message: messageSchema })
const approvalAskedSchema = z.object({ id: idSchema, toolName: z.string(), callId: idSchema.optional() })
const approvalDecidedSchema = z.object({ id: idSchema, outcome: z.string() })
const llmRetrySchema = z.object({
  retryId: idSchema,
  turn: z.number(),
  step: z.number(),
  provider: z.string(),
  mode: z.string(),
  retry: z.number(),
  maxRetries: z.number().optional(),
  delayMs: z.number(),
  failure: z.looseObject({ code: z.string().optional() }),
})
const llmRetryStartedSchema = z.object({ retryId: idSchema })
const compactionStartSchema = z.object({ compactionId: idSchema, turn: z.number().nullable() })
const compactionEndSchema = z.object({ compactionId: idSchema, error: z.string().optional() })
const jobRegisteredSchema = z.object({ jobId: idSchema, kind: z.string(), toolCall: z.object({ callId: idSchema }).optional() })
const jobSettledSchema = z.object({ jobId: idSchema, status: z.string(), cause: z.string(), producerReported: z.boolean() })
const inboxSplicedSchema = z.object({ inserted: z.array(z.unknown()), outcome: z.string().optional() })

const contextOf = (span: Span | undefined): SpanContext | null => span?.context ?? null

const errorMessage = (error: unknown): string => (error instanceof Error ? error.name : 'NonError')

const errorName = (error: unknown, fallback: string): string => (error instanceof Error ? error.name : fallback)

/** The span status message is a type, never free text: DSH and provider failure messages can quote user content. */
const fail = (span: Span, type: string): void => {
  span.setAttribute('error.type', type)
  span.setStatus('error', type)
}

const sessionAttributes = (session: ObservedSession, turn: number): Attributes => {
  const header = session.header
  return {
    'gen_ai.agent.system': AGENT_SYSTEM,
    'gen_ai.session.id': session.id,
    'gen_ai.turn.id': `${session.id}:${String(turn)}`,
    'dsh.session.id': session.id,
    'dsh.turn': turn,
    'dsh.session.cwd': header.cwd,
    'dsh.session.parent_id': header.parentSession,
    'dsh.session.origin': header.origin,
    'dsh.session.delegation_depth': header.delegationDepth,
    'dsh.agent.preset': header.agentPreset,
    'gen_ai.agent.name': header.agentPreset || AGENT_SYSTEM,
  }
}

const stepAttributes = (session: ObservedSession, turn: number, step: number): Attributes => ({
  ...sessionAttributes(session, turn),
  'gen_ai.step.id': `${session.id}:${String(turn)}:${String(step)}`,
  'dsh.step': step,
})

const turnFailure = (reason: z.infer<typeof turnEndSchema>['reason']): string | undefined => {
  if (reason.kind === 'error') return reason.error?.code ?? 'ERROR'
  if (reason.kind === 'aborted' || reason.kind === 'interrupted') return reason.kind.toUpperCase()
  return undefined
}

/**
 * Owns the live GenAI span tree of every observed DSH session. Every Host callback enters through a contained method:
 * a telemetry failure is logged and never changes the model, tool or session path.
 */
export const createCoordinator = (options: CoordinatorOptions) => {
  const sessions = new Map<string, SessionState>()
  const jobs = new Map<string, Span>()

  const contained = <T>(label: string, fallback: T, run: () => T): T => {
    try {
      return run()
    } catch (error) {
      options.warn(`agent-telemetry: ${label} failed: ${errorMessage(error)}`)
      return fallback
    }
  }

  const adopt = (session: ObservedSession, creationParent: SpanContext | undefined): SessionState => {
    const previous = sessions.get(session.id)
    if (previous?.session === session) return previous
    if (previous?.turn !== undefined) closeTurn(previous, { kind: 'interrupted' })
    const state: SessionState = { session, creationParent, turn: undefined, approvals: new Map(), retries: new Map(), compactions: new Map() }
    sessions.set(session.id, state)
    return state
  }

  const ensure = (session: ObservedSession): SessionState => {
    const existing = sessions.get(session.id)
    return existing?.session === session ? existing : adopt(session, undefined)
  }

  const runningDelegationTool = (parent: SessionState | undefined): ToolState | undefined => {
    const tools = [...(parent?.turn?.step?.tools.values() ?? [])].filter(tool => !tool.ended)
    return tools.filter(tool => DELEGATION_TOOLS.has(tool.name)).at(-1) ?? tools.at(-1)
  }

  /**
   * A top-level session's turn is its own trace. A subagent's turn joins its parent's: the span active where DSH
   * started it (the parent's `subagent` tool body runs with its `execute_tool` span active), else the one captured when
   * its session was created, else the parent's running delegation tool, else the parent's turn.
   */
  const turnParent = (state: SessionState): TurnParent => {
    if (state.session.header.origin !== 'subagent') return { parent: null, link: 'root' }
    const active = activeSpanContext()
    if (active !== undefined) return { parent: active, link: 'async-context' }
    if (state.creationParent !== undefined) return { parent: state.creationParent, link: 'created-in-tool' }
    const parentId = state.session.header.parentSession
    const parent = parentId === undefined ? undefined : sessions.get(parentId)
    const tool = runningDelegationTool(parent)
    if (tool?.span.context !== undefined) return { parent: tool.span.context, link: 'running-tool' }
    if (parent?.turn?.agent.context !== undefined) return { parent: parent.turn.agent.context, link: 'parent-turn' }
    return { parent: null, link: 'root' }
  }

  const startTurn = (state: SessionState, turn: number): void => {
    if (state.turn !== undefined) closeTurn(state, { kind: 'interrupted' })
    const attributes = sessionAttributes(state.session, turn)
    const agentName = state.session.header.agentPreset || AGENT_SYSTEM
    const { parent, link } = turnParent(state)
    const entry = startSpan(GenAiNames.entrySpan, {
      kind: 'server',
      parent,
      attributes: { ...attributes, ...operationAttributes.entry, 'dsh.trace.parent_link': link },
    })
    const agent = startSpan(GenAiNames.invokeAgentSpan(agentName), {
      kind: 'client',
      parent: contextOf(entry),
      attributes: {
        ...attributes,
        ...operationAttributes.agent,
        'gen_ai.provider.name': AGENT_SYSTEM,
        'gen_ai.agent.id': agentName,
        'gen_ai.conversation.id': state.session.id,
      },
    })
    state.turn = {
      turn,
      entry,
      agent,
      step: undefined,
      contextMessages: [],
      inputs: [],
      outputs: [],
      usage: GenAi.emptyTotals(),
      costUsd: undefined,
      splicedMessages: 0,
    }
  }

  const startStep = (state: SessionState, turn: number, step: number): void => {
    const active = state.turn
    if (active?.turn !== turn) return
    if (active.step !== undefined) closeStep(state, active, 'interrupted')
    const span = startSpan(GenAiNames.reactStepSpan, {
      parent: contextOf(active.agent),
      attributes: { ...stepAttributes(state.session, turn, step), ...operationAttributes.step, 'gen_ai.react.round': step },
    })
    active.step = { turn, step, span, tools: new Map(), llms: new Set(), nextAttempt: 1, lastFinishReason: undefined }
  }

  const failTool = (tool: ToolState, type: string): void => {
    if (tool.ended) return
    tool.ended = true
    fail(tool.span, type)
    tool.span.end()
  }

  const toolSpan = (input: { readonly state: SessionState; readonly step: StepState; readonly callId: string; readonly name: string }): ToolState => {
    const span = startSpan(GenAiNames.executeToolSpan(input.name), {
      parent: contextOf(input.step.span),
      attributes: {
        ...stepAttributes(input.state.session, input.step.turn, input.step.step),
        ...operationAttributes.tool,
        'gen_ai.tool.name': input.name,
        'gen_ai.tool.call.id': input.callId,
      },
    })
    return { span, name: input.name, startedAt: performance.now(), ended: false }
  }

  const startTool = (state: SessionState, data: z.infer<typeof toolCallSchema>): void => {
    const step = state.turn?.step
    if (state.turn?.turn !== data.turn || step?.step !== data.step) return
    const existing = step.tools.get(data.callId)
    if (existing !== undefined && !existing.ended) {
      if (existing.name === data.name) return captureToolArguments(existing, data.arguments)
      failTool(existing, 'DUPLICATE_TOOL_CALL_ID')
    }
    const tool = toolSpan({ state, step, callId: data.callId, name: data.name })
    captureToolArguments(tool, data.arguments)
    step.tools.set(data.callId, tool)
  }

  const captureToolArguments = (tool: ToolState, raw: string): void => {
    if (options.captureContent()) tool.span.setAttribute('gen_ai.tool.call.arguments', GenAi.serializeCaptured(GenAi.parseToolArguments(raw)))
  }

  const endTool = (state: SessionState, data: z.infer<typeof toolResultSchema>): void => {
    const turn = state.turn
    const step = turn?.step
    if (turn?.turn !== data.turn || step?.step !== data.step) return
    if (options.captureContent()) turn.contextMessages.push(data.message)
    const callId = data.message.source.callId
    const tool = callId === undefined ? undefined : step.tools.get(callId)
    if (tool === undefined || tool.ended) return
    tool.ended = true
    const resultBlock = data.message.content.find(block => block.type === 'tool-result')
    if (options.captureContent()) {
      tool.span.setAttribute(
        'gen_ai.tool.call.result',
        GenAi.serializeCaptured(GenAi.mapContent(resultBlock === undefined ? data.message.content : GenAi.contentBlocks.parse(resultBlock.content))),
      )
    }
    const isError = data.error !== undefined || resultBlock?.isError === true
    if (isError) {
      tool.span.setAttribute('dsh.tool.error.name', redactIdentifier(data.error?.name))
      fail(tool.span, data.error?.code ?? 'TOOL_ERROR')
    } else tool.span.setStatus('ok')
    tool.span.end()
  }

  const closeStep = (state: SessionState, turn: TurnState, forcedReason?: string): void => {
    const step = turn.step
    if (step === undefined) return
    for (const llm of step.llms) if (!llm.ended) failLlm(llm, 'STEP_ENDED_BEFORE_STREAM')
    for (const tool of step.tools.values()) failTool(tool, 'STEP_ENDED_BEFORE_RESULT')
    for (const [id, retry] of state.retries) {
      retry.end()
      state.retries.delete(id)
    }
    const reason = forcedReason ?? step.lastFinishReason ?? 'completed'
    step.span.setAttribute('gen_ai.react.finish_reason', reason)
    const failure = forcedReason ?? (reason === 'error' || reason === 'cancelled' ? reason : undefined)
    if (failure === undefined) step.span.setStatus('ok')
    else fail(step.span, failure.toUpperCase())
    step.span.end()
    turn.step = undefined
  }

  const closeTurn = (state: SessionState, reason: z.infer<typeof turnEndSchema>['reason']): void => {
    const turn = state.turn
    if (turn === undefined) return
    if (turn.step !== undefined) closeStep(state, turn, 'interrupted')
    turn.agent.setAttributes({
      ...GenAi.totalsAttributes(turn.usage),
      [CostAttributes.usd]: turn.costUsd,
      'gen_ai.response.finish_reasons': [GenAi.finishReason(reason.kind)],
      'dsh.turn.end_reason': reason.kind,
      'dsh.inbox.spliced_messages': turn.splicedMessages > 0 ? turn.splicedMessages : undefined,
    })
    turn.entry.setAttribute('dsh.turn.end_reason', reason.kind)
    if (options.captureContent()) {
      const captured = GenAi.capturedConversationAttributes({ inputs: turn.inputs, outputs: turn.outputs })
      turn.agent.setAttributes(captured)
      turn.entry.setAttributes(captured)
    }
    const failure = turnFailure(reason)
    for (const span of [turn.agent, turn.entry]) {
      if (failure === undefined) span.setStatus('ok')
      else fail(span, failure)
      span.end()
    }
    state.turn = undefined
  }

  const captureTurnInput = (state: SessionState, message: CapturedMessage): void => {
    if (state.turn === undefined) return
    if (options.captureContent()) state.turn.contextMessages.push(message)
    if (message.source.kind === 'user') state.turn.inputs.push(GenAi.inputMessage(message))
  }

  const captureTurnOutput = (state: SessionState, data: z.infer<typeof assistantMessageSchema>): void => {
    const turn = state.turn
    if (turn?.turn !== data.turn) return
    const reason = turn.step?.step === data.step ? (turn.step.lastFinishReason ?? 'unknown') : 'unknown'
    if (options.captureContent()) turn.contextMessages.push(data.message)
    turn.outputs.push(GenAi.outputMessage(data.message, reason))
  }

  const waitParent = (state: SessionState, callId: string | undefined): SpanContext | null => {
    const step = state.turn?.step
    const tool = callId === undefined ? undefined : step?.tools.get(callId)
    return contextOf(tool?.span ?? step?.span ?? state.turn?.agent)
  }

  const startApproval = (state: SessionState, data: z.infer<typeof approvalAskedSchema>): void => {
    const turn = state.turn?.turn ?? 0
    state.approvals.set(
      data.id,
      startSpan('approval wait', {
        parent: waitParent(state, data.callId),
        attributes: {
          'dsh.session.id': state.session.id,
          'dsh.turn': turn,
          'dsh.wait.kind': 'approval',
          'gen_ai.tool.name': data.toolName,
          'gen_ai.tool.call.id': data.callId,
        },
      }),
    )
  }

  const endApproval = (state: SessionState, data: z.infer<typeof approvalDecidedSchema>): void => {
    const span = state.approvals.get(data.id)
    if (span === undefined) return
    state.approvals.delete(data.id)
    span.setAttribute('dsh.approval.outcome', redactIdentifier(data.outcome))
    span.end()
  }

  const startRetry = (state: SessionState, data: z.infer<typeof llmRetrySchema>): void => {
    const step = state.turn?.step
    const parent = step?.turn === data.turn && step.step === data.step ? step.span : state.turn?.agent
    state.retries.set(
      data.retryId,
      startSpan('llm retry wait', {
        parent: contextOf(parent),
        attributes: {
          ...stepAttributes(state.session, data.turn, data.step),
          'dsh.wait.kind': 'llm-retry',
          'gen_ai.provider.name': data.provider,
          'dsh.llm.retry': data.retry,
          'dsh.llm.retry.max': data.maxRetries,
          'dsh.llm.retry.mode': redactIdentifier(data.mode),
          'dsh.llm.retry.delay_ms': data.delayMs,
          'error.type': redactIdentifier(data.failure.code),
        },
      }),
    )
  }

  const endRetry = (state: SessionState, retryId: string): void => {
    state.retries.get(retryId)?.end()
    state.retries.delete(retryId)
  }

  const startCompaction = (state: SessionState, data: z.infer<typeof compactionStartSchema>): void => {
    const turn = state.turn
    const parent = turn !== undefined && (data.turn === null || data.turn === turn.turn) ? (turn.step?.span ?? turn.agent) : undefined
    state.compactions.set(
      data.compactionId,
      startSpan('compaction', {
        parent: parent === undefined ? (activeSpanContext() ?? null) : contextOf(parent),
        attributes: { 'dsh.session.id': state.session.id, 'dsh.turn': data.turn ?? undefined, 'dsh.compaction.id': data.compactionId },
      }),
    )
  }

  const endCompaction = (state: SessionState, data: z.infer<typeof compactionEndSchema>): void => {
    const span = state.compactions.get(data.compactionId)
    if (span === undefined) return
    state.compactions.delete(data.compactionId)
    if (data.error === undefined) span.setStatus('ok')
    else fail(span, 'COMPACTION_FAILED')
    span.end()
  }

  const startJob = (state: SessionState, data: z.infer<typeof jobRegisteredSchema>): void => {
    const kind = redactIdentifier(data.kind) ?? 'job'
    jobs.set(
      data.jobId,
      startSpan(`job ${kind}`, {
        kind: 'producer',
        parent: waitParent(state, data.toolCall?.callId),
        attributes: { 'dsh.session.id': state.session.id, 'dsh.job.id': data.jobId, 'dsh.job.kind': kind, 'gen_ai.tool.call.id': data.toolCall?.callId },
      }),
    )
  }

  const endJob = (data: z.infer<typeof jobSettledSchema>): void => {
    const span = jobs.get(data.jobId)
    if (span === undefined) return
    jobs.delete(data.jobId)
    span.setAttributes({
      'dsh.job.status': redactIdentifier(data.status),
      'dsh.job.cause': redactIdentifier(data.cause),
      'dsh.job.producer_reported': data.producerReported,
    })
    if (data.status === 'failed') fail(span, 'JOB_FAILED')
    else if (data.status === 'completed') span.setStatus('ok')
    span.end()
  }

  const onEvent = (session: ObservedSession, event: ObservedEvent): void =>
    contained(`observing ${event.type}`, undefined, () => {
      const state = ensure(session)
      switch (event.type) {
        case 'turn/start':
          return startTurn(state, turnSchema.parse(event.data).turn)
        case 'turn/end': {
          const data = turnEndSchema.parse(event.data)
          if (state.turn?.turn === data.turn) closeTurn(state, data.reason)
          return
        }
        case 'step/start': {
          const data = stepSchema.parse(event.data)
          return startStep(state, data.turn, data.step)
        }
        case 'step/end': {
          const data = stepSchema.parse(event.data)
          const step = state.turn?.step
          if (state.turn !== undefined && step?.turn === data.turn && step.step === data.step) closeStep(state, state.turn)
          return
        }
        case 'user/message':
          return captureTurnInput(state, messageSchema.parse(event.data))
        case 'assistant/message':
          return captureTurnOutput(state, assistantMessageSchema.parse(event.data))
        case 'tool/call':
          return startTool(state, toolCallSchema.parse(event.data))
        case 'tool/result':
          return endTool(state, toolResultSchema.parse(event.data))
        case 'approval/asked':
          return startApproval(state, approvalAskedSchema.parse(event.data))
        case 'approval/decided':
          return endApproval(state, approvalDecidedSchema.parse(event.data))
        case 'llm/retry':
          return startRetry(state, llmRetrySchema.parse(event.data))
        case 'llm/retry-started':
          return endRetry(state, llmRetryStartedSchema.parse(event.data).retryId)
        case 'compaction/start':
          return startCompaction(state, compactionStartSchema.parse(event.data))
        case 'compaction/end':
          return endCompaction(state, compactionEndSchema.parse(event.data))
        case 'job/registered':
          return startJob(state, jobRegisteredSchema.parse(event.data))
        case 'job/settled':
          return endJob(jobSettledSchema.parse(event.data))
        case 'agent/inbox/spliced': {
          const data = inboxSplicedSchema.parse(event.data)
          if (state.turn !== undefined && data.outcome === undefined) state.turn.splicedMessages += data.inserted.length
          return
        }
        default:
          return
      }
    })

  /** A step's tool call, created here when `tools/execute` runs before its `tool/call` event was observed. */
  const rootTool = (exec: ObservedToolCall): ToolState | undefined => {
    const sessionId = exec.agent?.id
    const state = sessionId === undefined ? undefined : sessions.get(sessionId)
    const step = state?.turn?.step
    if (state === undefined || step === undefined) return undefined
    const existing = step.tools.get(exec.callId)
    if (existing !== undefined) return existing.ended ? undefined : existing
    if (exec.parent !== undefined) return undefined
    const tool = toolSpan({ state, step, callId: exec.callId, name: exec.name })
    step.tools.set(exec.callId, tool)
    return tool
  }

  const nestedTool = (exec: ObservedToolCall): Span =>
    startSpan(GenAiNames.executeToolSpan(exec.name), {
      attributes: {
        ...operationAttributes.tool,
        'dsh.session.id': exec.agent?.id,
        'gen_ai.tool.name': exec.name,
        'gen_ai.tool.call.id': exec.callId,
        'dsh.tool.root_call_id': exec.rootCallId,
      },
    })

  /**
   * The `tools/execute` around-dispatch hook: the tool body runs with its `execute_tool` span active, so every dshx
   * API dispatch, jj run, secret lookup or Jev call it triggers nests under it. A model-requested call's span is ended
   * by its `tool/result` event (post-execute included, as LoongSuite timed it); a nested dispatch (a `run_code`
   * sub-call) gets its own span parented to the active one and ended here.
   */
  const runTool = <Result extends ObservedToolResult>(exec: ObservedToolCall, next: () => Promise<Result>): Promise<Result> => {
    const plan = contained<{ readonly kind: 'event'; readonly span: Span } | { readonly kind: 'nested'; readonly span: Span } | { readonly kind: 'none' }>(
      `tool ${exec.name}`,
      { kind: 'none' },
      () => {
        if (!tracingEnabled()) return { kind: 'none' }
        const tool = rootTool(exec)
        if (tool !== undefined) return { kind: 'event', span: tool.span }
        return { kind: 'nested', span: nestedTool(exec) }
      },
    )
    if (plan.kind === 'none') return next()
    if (plan.kind === 'event') return withActiveSpan(plan.span, next)
    const span = plan.span
    return withActiveSpan(span, next).then(
      result => {
        contained('nested tool result', undefined, () => {
          if (result.isError) fail(span, result.error?.info?.code ?? 'TOOL_ERROR')
          else span.setStatus('ok')
          span.end()
        })
        return result
      },
      (error: unknown) => {
        contained('nested tool failure', undefined, () => {
          span.recordFailure(error)
          span.end()
        })
        throw error
      },
    )
  }

  /**
   * A purpose call (title, compaction) or any model call outside a live step: parented to its compaction, the session's
   * live step or turn, the active span (a plugin's own work), or a new trace.
   */
  const standaloneParent = (request: ObservedLlmRequest, state: SessionState | undefined): SpanContext | null => {
    if (request.purpose === 'compaction') {
      const compaction = [...(state?.compactions.values() ?? [])].at(-1)
      if (compaction?.context !== undefined) return compaction.context
    }
    const sessionSpan = state?.turn?.step?.span ?? state?.turn?.agent
    if (sessionSpan?.context !== undefined) return sessionSpan.context
    return activeSpanContext() ?? null
  }

  const llmAttributes = (request: ObservedLlmRequest): Attributes => ({
    ...operationAttributes.chat,
    'gen_ai.request.model': request.model,
    'gen_ai.provider.name': request.provider,
    'gen_ai.response.model': request.model,
    'gen_ai.conversation.id': request.sessionId,
    'gen_ai.request.temperature': request.temperature,
    'gen_ai.request.max_tokens': request.maxTokens,
    'gen_ai.request.stop_sequences': request.stop === undefined ? undefined : [...request.stop],
    'gen_ai.request.reasoning_effort': request.reasoningEffort,
    'gen_ai.agent.system': AGENT_SYSTEM,
    'dsh.llm.purpose': request.purpose,
  })

  const startLlm = (request: ObservedLlmRequest): LlmState => {
    const state = request.sessionId === undefined ? undefined : sessions.get(request.sessionId)
    const turn = state?.turn
    const step = request.purpose === undefined ? turn?.step : undefined
    if (state === undefined || turn === undefined || step === undefined) {
      const span = startSpan(GenAiNames.chatSpan(request.model), {
        kind: 'client',
        parent: standaloneParent(request, state),
        attributes: { ...llmAttributes(request), 'dsh.session.id': request.sessionId, 'dsh.llm.standalone': true },
      })
      return {
        span,
        options: request,
        inputMessages: [],
        blocks: [],
        startedAt: performance.now(),
        step: undefined,
        usage: undefined,
        firstTokenSeen: false,
        ended: false,
      }
    }
    const attempt = step.nextAttempt
    step.nextAttempt += 1
    const capture = options.captureContent()
    const inputMessages = capture ? turn.contextMessages.map(message => GenAi.inputMessage(message)) : []
    const span = startSpan(GenAiNames.chatSpan(request.model), {
      kind: 'client',
      parent: contextOf(step.span),
      attributes: { ...stepAttributes(state.session, turn.turn, step.step), ...llmAttributes(request), 'dsh.llm.attempt': attempt },
    })
    const llm: LlmState = {
      span,
      options: request,
      inputMessages,
      blocks: [],
      startedAt: performance.now(),
      step,
      usage: undefined,
      firstTokenSeen: false,
      ended: false,
    }
    step.llms.add(llm)
    turn.agent.setAttributes({ 'gen_ai.provider.name': request.provider, 'gen_ai.request.model': request.model })
    return llm
  }

  const priceOf = (llm: LlmState): number | undefined => {
    const usage = llm.usage
    const priceCall = options.priceCall
    if (usage === undefined || priceCall === undefined) return undefined
    const price = contained('pricing a model call', undefined, () => priceCall({ provider: llm.options.provider, model: llm.options.model, usage }))
    if (price === undefined) return undefined
    llm.span.setAttributes({ [CostAttributes.usd]: price.usd, [CostAttributes.priceId]: price.priceId ?? undefined })
    return price.usd
  }

  const settleLlm = (llm: LlmState, reason: string): void => {
    llm.span.setAttribute('gen_ai.response.finish_reasons', [reason])
    if (llm.usage !== undefined) llm.span.setAttributes(GenAi.usageAttributes(llm.usage))
    const costUsd = priceOf(llm)
    if (llm.step !== undefined && options.captureContent()) {
      llm.span.setAttributes(
        GenAi.capturedLlmAttributes({
          system: llm.options.system,
          tools: llm.options.tools,
          inputMessages: llm.inputMessages,
          outputMessages: [{ role: 'assistant', parts: GenAi.mapContent(llm.blocks), finishReason: reason }],
        }),
      )
    }
    const step = llm.step
    const turn = step === undefined || llm.options.sessionId === undefined ? undefined : sessions.get(llm.options.sessionId)?.turn
    if (step === undefined || turn?.step !== step || !step.llms.has(llm)) return
    if (llm.usage !== undefined) GenAi.addUsage(turn.usage, llm.usage)
    if (costUsd !== undefined) turn.costUsd = (turn.costUsd ?? 0) + costUsd
    step.lastFinishReason = reason
  }

  const finishLlm = (llm: LlmState, chunk: Extract<StreamChunk, { type: 'finish' }>): void => {
    if (llm.ended) return
    llm.ended = true
    const reason = GenAi.finishReason(chunk.reason.kind)
    settleLlm(llm, reason)
    if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') fail(llm.span, chunk.reason.failure.code || chunk.reason.kind.toUpperCase())
    else llm.span.setStatus('ok')
    llm.span.end()
  }

  const failLlm = (llm: LlmState, type: string): void => {
    if (llm.ended) return
    llm.ended = true
    settleLlm(llm, llm.options.signal?.aborted === true ? 'cancelled' : 'error')
    fail(llm.span, type)
    llm.span.end()
  }

  const observeChunk = (llm: LlmState, chunk: StreamChunk): void => {
    if (llm.ended) return
    if (!llm.firstTokenSeen && GenAi.isVisibleToken(chunk)) {
      llm.firstTokenSeen = true
      llm.span.setAttributes({
        'gen_ai.response.time_to_first_token': Math.round((performance.now() - llm.startedAt) * 1e6),
        'langfuse.observation.completion_start_time': new Date().toISOString(),
      })
    }
    if (chunk.type === 'block-end') {
      const block = GenAi.contentBlock.safeParse(chunk.block)
      if (block.success) llm.blocks.push(block.data)
    } else if (chunk.type === 'usage') llm.usage = chunk.usage
    else if (chunk.type === 'finish') finishLlm(llm, chunk)
  }

  /**
   * Re-yields the provider stream unchanged, pulling every chunk with the `chat` span active so anything the adapter
   * does per request (a gateway call, a credential lookup) nests under it.
   */
  async function* observeStream(llm: LlmState, stream: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk, void, undefined> {
    const iterator = withActiveSpan(llm.span, () => stream[Symbol.asyncIterator]())
    let done = false
    try {
      for (;;) {
        const step = await withActiveSpan(llm.span, () => iterator.next())
        if (step.done === true) {
          done = true
          break
        }
        contained('observing a model chunk', undefined, () => observeChunk(llm, step.value))
        yield step.value
      }
      contained('closing a model stream', undefined, () => failLlm(llm, 'STREAM_ENDED_WITHOUT_FINISH'))
    } catch (error) {
      done = true
      contained('failing a model stream', undefined, () => failLlm(llm, errorName(error, llm.options.signal?.aborted === true ? 'AbortError' : 'Error')))
      throw error
    } finally {
      if (!done) {
        contained('stopping a model stream', undefined, () => failLlm(llm, llm.options.signal?.aborted === true ? 'ABORTED' : 'CONSUMER_STOPPED'))
        await iterator.return?.()
      }
    }
  }

  /** The `llm/stream` waterfall: one `chat <model>` span per attempt, active while the provider stream is pulled. */
  const interceptLlm = (request: ObservedLlmRequest, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> => {
    const llm = contained<LlmState | undefined>('starting a model span', undefined, () => (tracingEnabled() ? startLlm(request) : undefined))
    if (llm === undefined) return next()
    let stream: AsyncIterable<StreamChunk>
    try {
      stream = withActiveSpan(llm.span, next)
    } catch (error) {
      contained('failing a model request', undefined, () => failLlm(llm, errorName(error, 'Error')))
      throw error
    }
    return observeStream(llm, stream)
  }

  const onCreated = (session: ObservedSession): void =>
    contained('adopting a session', undefined, () => {
      adopt(session, activeSpanContext())
    })

  const onDisposed = (session: ObservedSession): void =>
    contained('disposing a session', undefined, () => {
      const state = sessions.get(session.id)
      if (state?.session !== session) return
      closeTurn(state, { kind: 'interrupted' })
      for (const span of [...state.approvals.values(), ...state.retries.values(), ...state.compactions.values()]) span.end()
      sessions.delete(session.id)
    })

  const closeAll = (): void =>
    contained('closing live spans', undefined, () => {
      for (const state of sessions.values()) {
        closeTurn(state, { kind: 'error', error: { code: 'PLUGIN_UNLOADED' } })
        for (const span of [...state.approvals.values(), ...state.retries.values(), ...state.compactions.values()]) span.end()
      }
      for (const span of jobs.values()) span.end()
      sessions.clear()
      jobs.clear()
    })

  return {
    /** Adopt identity only: replaying a live session's history would duplicate spans after a plugin reload. */
    adopt: (session: ObservedSession) => contained('adopting a session', undefined, () => void adopt(session, undefined)),
    onCreated,
    onDisposed,
    onEvent,
    runTool,
    interceptLlm,
    closeAll,
  }
}

export type Coordinator = ReturnType<typeof createCoordinator>
