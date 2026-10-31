import type { RegistryToolSource } from '@dshfiles/dshx/api'
import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { Result, Schema } from 'effect'
import type { LogRecord } from './session-log.js'
import { identifyCommand, isOptionalShellToolArguments, type ShellToolArguments } from './command-identifiers.js'
import { REQUEST_PURPOSES, REQUEST_STATUSES } from './fold-contracts.js'

/**
 * Turns one session log into model requests. Every request is keyed by the
 * sequence number of the event that settled it, so folding the same events
 * twice (a re-index, a rewritten generation file) upserts identical rows.
 *
 * Where each field comes from:
 * - agent requests: `assistant/message` (settled) and `assistant/attempt`
 *   (failed before settling); usage is `data.usage` or the stream's last
 *   `usage` chunk; the stop reason is the provider's `replayState.response.stopReason`,
 *   else the `finish` chunk's kind; start is the step's `step/start` time, so
 *   TTFT is the first stream chunk's time minus that start;
 * - aborted requests: a `step/start` with no assistant event before its
 *   `step/end`, in a turn that ends `aborted` or `interrupted`;
 * - compaction: `compaction/start` → `compaction/summary`, which carries
 *   route and usage but no stream, so no TTFT;
 * - title generation: `session/title-llm-request` → the next provider
 *   `session/title`; the log keeps no usage for it.
 */

export type RequestPurpose = (typeof REQUEST_PURPOSES)[number]
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export interface TokenUsage {
  /** Prompt tokens billed at the input rate (not read from or written to the cache). */
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
  readonly reasoning: number
}

export interface RequestRow {
  readonly id: string
  readonly sessionId: string
  readonly seq: number | null
  readonly messageId: string | null
  readonly turn: number | null
  readonly step: number | null
  readonly purpose: RequestPurpose
  readonly source: 'log' | 'live'
  readonly provider: string
  readonly model: string
  readonly startedAt: number
  readonly endedAt: number | null
  readonly ttftMs: number | null
  readonly usage: TokenUsage | null
  readonly status: RequestStatus
  readonly stopReason: string | null
  readonly errorCode: string | null
}

export interface SessionMeta {
  readonly id: string
  readonly cwd: string | null
  readonly parentSession: string | null
  readonly subagent: boolean
  readonly createdAt: number | null
  readonly title: string | null
}

export type ToolCategory = RegistryToolSource | 'skill' | 'other'

export interface ToolSourceMetadata {
  readonly source: RegistryToolSource
  readonly owner: string | null
}

export interface ToolExecutionRow {
  readonly id: string
  readonly sessionId: string
  readonly seq: number
  readonly turn: number | null
  readonly step: number | null
  readonly name: string
  readonly category: ToolCategory
  readonly owner: string | null
  readonly normalizedCommand?: string | null
  readonly testRunner?: string | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly outcome: 'success' | 'error' | 'interrupted' | 'unknown' | 'pending'
  /** Text characters the tool returned, so callers can estimate output tokens. Never the text itself. */
  readonly resultChars?: number | null
}

const stepKey = (turn: number, step: number): string => `${String(turn)}:${String(step)}`
const MAX_OPEN_TOOL_CALLS = 2_000

const toolResultSchema = Schema.Struct({
  message: Schema.Struct({
    toolCallId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
    isError: Schema.optional(Schema.Boolean),
    content: Schema.optional(Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) }))),
  }),
})

const skillSchema = Schema.StructWithRest(Schema.Struct({ name: Schema.String.check(Schema.isPattern(/^[\w.-]{1,80}$/)) }), [
  Schema.Record(Schema.String.check(Schema.isPattern(/^(?!name$)[\s\S]*$/)), Schema.Never),
])

/** Characters of text a tool returned. Image and binary parts carry no `text` and are not counted. */
const resultCharsOf = (content: readonly { readonly text?: string | undefined }[] | undefined): number => {
  let total = 0
  for (const part of content ?? []) total += part.text?.length ?? 0
  return total
}

const nullableNumber = Schema.NullOr(Schema.Number)
const nullableString = Schema.NullOr(Schema.String)
const requestRowSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  seq: nullableNumber,
  messageId: nullableString,
  turn: nullableNumber,
  step: nullableNumber,
  purpose: Schema.Literals(['agent', 'subagent', 'compaction', 'title', 'memory', 'other']),
  source: Schema.Literals(['log', 'live']),
  provider: Schema.String,
  model: Schema.String,
  startedAt: Schema.Number,
  endedAt: nullableNumber,
  ttftMs: nullableNumber,
  usage: Schema.NullOr(
    Schema.Struct({ input: Schema.Number, cacheRead: Schema.Number, cacheWrite: Schema.Number, output: Schema.Number, reasoning: Schema.Number }),
  ),
  status: Schema.Literals(['ok', 'aborted', 'failed']),
  stopReason: nullableString,
  errorCode: nullableString,
})

const foldStateSchema = Schema.Struct({
  session: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      cwd: nullableString,
      parentSession: nullableString,
      subagent: Schema.Boolean,
      createdAt: nullableNumber,
      title: nullableString,
    }),
  ),
  route: Schema.NullOr(Schema.Struct({ provider: Schema.String, model: Schema.String })),
  stepStarts: Schema.Record(Schema.String, Schema.Number),
  settledSteps: Schema.mutable(Schema.Array(Schema.String)),
  silentSteps: Schema.mutable(
    Schema.Array(Schema.Struct({ turn: Schema.Number, step: Schema.Number, seq: Schema.Number, startedAt: Schema.Number, endedAt: Schema.Number })),
  ),
  compactionStarts: Schema.Record(Schema.String, Schema.Number),
  pendingTitle: Schema.NullOr(Schema.Struct({ seq: Schema.Number, startedAt: Schema.Number, provider: Schema.String, model: Schema.String })),
  openAttempts: Schema.mutable(Schema.Array(Schema.Struct({ key: Schema.String, row: requestRowSchema }))),
  openTools: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        callId: Schema.String,
        seq: Schema.Number,
        turn: nullableNumber,
        step: nullableNumber,
        name: Schema.String,
        category: Schema.Literals(['api', 'mcp', 'plugin', 'tool', 'skill', 'other']),
        owner: nullableString,
        normalizedCommand: Schema.NullOr(Schema.String.check(Schema.isMaxLength(80))),
        testRunner: Schema.NullOr(Schema.String.check(Schema.isMaxLength(80))),
        startedAt: Schema.Number,
      }),
    ).check(Schema.isMaxLength(MAX_OPEN_TOOL_CALLS)),
  ),
  activeTurn: nullableNumber,
})

export type FoldState = Schema.Schema.Type<typeof foldStateSchema>
type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T

const safeParse = <A, E>(result: Result.Result<A, E>) =>
  Result.isSuccess(result) ? { success: true as const, data: result.success } : { success: false as const, error: result.failure }

interface FoldRecordsResult {
  readonly state: FoldState
  readonly rows: RequestRow[]
  readonly tools: ToolExecutionRow[]
}

const headerSchema = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.optional(Schema.Number),
  cwd: Schema.optional(Schema.String),
  parentSession: Schema.optional(Schema.String),
  origin: Schema.optional(Schema.String),
})
const routeSchema = Schema.Struct({ provider: Schema.String, model: Schema.String })
const requestHeaderSchema = Schema.Struct({ header: Schema.Struct({ config: routeSchema }) })
const turnStepSchema = Schema.Struct({ turn: Schema.Number, step: Schema.Number })
const usageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.optional(Schema.Number),
  cacheWriteTokens: Schema.optional(Schema.Number),
  reasoningTokens: Schema.optional(Schema.Number),
})
const streamEntrySchema = Schema.Struct({
  type: Schema.String,
  time: Schema.optional(Schema.Number),
  chunk: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      usage: Schema.optional(usageSchema),
      reason: Schema.optional(Schema.Struct({ kind: Schema.String, failure: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })) })),
    }),
  ),
})
const assistantSchema = Schema.Struct({
  turn: Schema.Number,
  step: Schema.Number,
  usage: Schema.optional(usageSchema),
  stream: Schema.optional(Schema.Array(Schema.Unknown)),
  message: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      source: Schema.optional(
        Schema.Struct({
          provider: Schema.optional(Schema.String),
          model: Schema.optional(Schema.String),
          replayState: Schema.optional(Schema.Struct({ response: Schema.optional(Schema.Struct({ stopReason: Schema.optional(Schema.String) })) })),
        }),
      ),
    }),
  ),
})
const turnEndSchema = Schema.Struct({
  turn: Schema.Number,
  reason: Schema.optional(Schema.Struct({ kind: Schema.String, error: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })) })),
})
const retrySchema = Schema.Struct({
  turn: Schema.Number,
  step: Schema.Number,
  failure: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String) })),
})
const compactionStartSchema = Schema.Struct({ compactionId: Schema.String })
const compactionSummarySchema = Schema.Struct({
  compactionId: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  usage: Schema.optional(usageSchema),
})
const titleRequestSchema = Schema.Struct({ route: routeSchema })
const titleSchema = Schema.Struct({ title: Schema.String, source: Schema.optional(Schema.Struct({ kind: Schema.String })) })

const toUsage = (sample: Schema.Schema.Type<typeof usageSchema>): TokenUsage => ({
  input: sample.inputTokens,
  cacheRead: sample.cacheReadTokens ?? 0,
  cacheWrite: sample.cacheWriteTokens ?? 0,
  output: sample.outputTokens,
  reasoning: sample.reasoningTokens ?? 0,
})

/** pi-ai's names for the finish kinds DSH records, so settled and failed rows read alike. */
const STOP_REASON_BY_FINISH = new Map<string, string>([
  ['tool-calls', 'toolUse'],
  ['stop', 'stop'],
  ['max-tokens', 'length'],
])

const ABORTED_TURN_REASONS = new Set(['aborted', 'interrupted'])

export class UsageFoldModel {
  static readonly REQUEST_PURPOSES = REQUEST_PURPOSES
  static readonly REQUEST_STATUSES = REQUEST_STATUSES

  static readonly initialFoldState = (): FoldState => ({
    session: null,
    route: null,
    stepStarts: {},
    settledSteps: [],
    silentSteps: [],
    compactionStarts: {},
    pendingTitle: null,
    openAttempts: [],
    openTools: [],
    activeTurn: null,
  })

  /** A stored state that no longer decodes restarts the fold from the file's first byte. */
  static readonly decodeFoldState = (raw: string): FoldState | undefined => {
    try {
      const parsed = safeParse(Schema.decodeUnknownResult(foldStateSchema)(decodeJson(jsonValueSchema, raw)))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  static readonly foldRecords = (input: {
    readonly state: FoldState
    readonly records: readonly LogRecord[]
    readonly sessionId: string
    readonly toolSources?: ReadonlyMap<string, ToolSourceMetadata>
  }): FoldRecordsResult => {
    const state: Mutable<FoldState> = {
      session: input.state.session === null ? null : { ...input.state.session },
      route: input.state.route === null ? null : { ...input.state.route },
      stepStarts: { ...input.state.stepStarts },
      settledSteps: [...input.state.settledSteps],
      silentSteps: input.state.silentSteps.map(step => ({ ...step })),
      compactionStarts: { ...input.state.compactionStarts },
      pendingTitle: input.state.pendingTitle === null ? null : { ...input.state.pendingTitle },
      openAttempts: input.state.openAttempts.map(attempt => ({ key: attempt.key, row: structuredClone(attempt.row) })),
      openTools: input.state.openTools.map(call => ({ ...call })),
      activeTurn: input.state.activeTurn,
    }
    const rows: RequestRow[] = []
    const tools: ToolExecutionRow[] = []
    const sessionId = (): string => state.session?.id ?? input.sessionId
    const agentPurpose = (): RequestPurpose => (state.session?.subagent === true ? 'subagent' : 'agent')
    const classifyTool = (
      name: string,
      args?: ShellToolArguments,
    ): Pick<ToolExecutionRow, 'name' | 'category' | 'owner'> & { readonly normalizedCommand: string | null; readonly testRunner: string | null } => {
      const identifiers = identifyCommand({ toolName: name, arguments: args })
      if (/^(?:functions\.)?(?:skill|load_skill|read_skill)$/.test(name)) {
        const skillArguments = safeParse(Schema.decodeUnknownResult(Schema.String.check(Schema.isMaxLength(4_096)))(args))
        if (skillArguments.success) {
          let parsedArguments: JsonValue | undefined
          try {
            parsedArguments = decodeJson(jsonValueSchema, skillArguments.data)
          } catch {
            parsedArguments = undefined
          }
          const skill = safeParse(Schema.decodeUnknownResult(skillSchema)(parsedArguments))
          if (skill.success) return { name: skill.data.name, category: 'skill', owner: null, ...identifiers }
        }
        return { name: 'skill', category: 'skill', owner: null, ...identifiers }
      }
      const registered = input.toolSources?.get(name)
      const category = registered?.source ?? (name.startsWith('mcp__') ? 'mcp' : 'other')
      return {
        name: name.replace(/[^\w.-]/g, '_').slice(0, 120) || 'other',
        category,
        owner: registered?.owner ?? null,
        ...identifiers,
      }
    }
    const trackOpenTool = (call: FoldState['openTools'][number]): void => {
      const previous = state.openTools.findIndex(open => open.callId === call.callId)
      if (previous >= 0) {
        const replaced = state.openTools.splice(previous, 1)[0]
        if (replaced !== undefined)
          tools.push({
            id: `${sessionId()}#${String(replaced.seq)}`,
            sessionId: sessionId(),
            seq: replaced.seq,
            turn: replaced.turn,
            step: replaced.step,
            name: replaced.name,
            category: replaced.category,
            owner: replaced.owner,
            normalizedCommand: replaced.normalizedCommand,
            testRunner: replaced.testRunner,
            startedAt: replaced.startedAt,
            endedAt: null,
            outcome: 'unknown',
          })
      }
      state.openTools.push(call)
      if (state.openTools.length <= MAX_OPEN_TOOL_CALLS) return
      const dropped = state.openTools.shift()
      if (dropped !== undefined)
        tools.push({
          id: `${sessionId()}#${String(dropped.seq)}`,
          sessionId: sessionId(),
          seq: dropped.seq,
          turn: dropped.turn,
          step: dropped.step,
          name: dropped.name,
          category: dropped.category,
          owner: dropped.owner,
          normalizedCommand: dropped.normalizedCommand,
          testRunner: dropped.testRunner,
          startedAt: dropped.startedAt,
          endedAt: null,
          outcome: 'unknown',
        })
    }

    for (const record of input.records) {
      const time = typeof record.time === 'number' ? record.time : null
      const seq = typeof record.seq === 'number' ? record.seq : null
      switch (record.type) {
        case 'tool/call': {
          const parsed = safeParse(
            Schema.decodeUnknownResult(
              Schema.Struct({
                callId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
                name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
                arguments: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
                turn: Schema.optional(Schema.Number),
                step: Schema.optional(Schema.Number),
              }),
            )(record.data),
          )
          if (!parsed.success || seq === null || time === null) break
          trackOpenTool({
            callId: parsed.data.callId,
            seq,
            turn: parsed.data.turn ?? null,
            step: parsed.data.step ?? null,
            ...classifyTool(parsed.data.name, parsed.data.arguments),
            startedAt: time,
          })
          break
        }
        case 'tool/result': {
          const parsed = safeParse(Schema.decodeUnknownResult(toolResultSchema)(record.data))
          if (!parsed.success || seq === null || time === null) break
          const index = state.openTools.findIndex(call => call.callId === parsed.data.message.toolCallId)
          if (index < 0) break
          const [call] = state.openTools.splice(index, 1)
          if (call === undefined) break
          tools.push({
            id: `${sessionId()}#${String(call.seq)}`,
            sessionId: sessionId(),
            seq: call.seq,
            turn: call.turn,
            step: call.step,
            name: call.name,
            category: call.category,
            owner: call.owner,
            normalizedCommand: call.normalizedCommand,
            testRunner: call.testRunner,
            startedAt: call.startedAt,
            endedAt: time,
            outcome: parsed.data.message.isError === true ? 'error' : parsed.data.message.isError === false ? 'success' : 'unknown',
            resultChars: resultCharsOf(parsed.data.message.content),
          })
          break
        }
        case 'tool/ptc-dispatch-start': {
          const parsed = safeParse(
            Schema.decodeUnknownResult(
              Schema.Struct({
                subCallId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
                name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
                arguments: Schema.optional(Schema.Unknown),
              }),
            )(record.data),
          )
          if (!parsed.success || seq === null || time === null) break
          const commandArguments = isOptionalShellToolArguments(parsed.data.arguments) ? parsed.data.arguments : undefined
          trackOpenTool({
            callId: parsed.data.subCallId,
            seq,
            turn: state.activeTurn,
            step: null,
            ...classifyTool(parsed.data.name, commandArguments),
            startedAt: time,
          })
          break
        }
        case 'tool/ptc-dispatch': {
          const parsed = safeParse(
            Schema.decodeUnknownResult(
              Schema.Struct({
                subCallId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
                isError: Schema.optional(Schema.Boolean),
              }),
            )(record.data),
          )
          if (!parsed.success || seq === null || time === null) break
          const index = state.openTools.findIndex(call => call.callId === parsed.data.subCallId)
          if (index < 0) break
          const [call] = state.openTools.splice(index, 1)
          if (call === undefined) break
          tools.push({
            id: `${sessionId()}#${String(call.seq)}`,
            sessionId: sessionId(),
            seq: call.seq,
            turn: call.turn,
            step: call.step,
            name: call.name,
            category: call.category,
            owner: call.owner,
            normalizedCommand: call.normalizedCommand,
            testRunner: call.testRunner,
            startedAt: call.startedAt,
            endedAt: time,
            outcome: parsed.data.isError === true ? 'error' : parsed.data.isError === false ? 'success' : 'unknown',
          })
          break
        }
        case 'session': {
          const header = safeParse(Schema.decodeUnknownResult(headerSchema)(record))
          if (!header.success) break
          state.session = {
            id: header.data.id,
            cwd: header.data.cwd ?? null,
            parentSession: header.data.parentSession ?? null,
            subagent: header.data.origin === 'subagent',
            createdAt: header.data.createdAt ?? null,
            title: state.session?.title ?? null,
          }
          break
        }
        case 'request/header': {
          const parsed = safeParse(Schema.decodeUnknownResult(requestHeaderSchema)(record.data))
          if (parsed.success) state.route = { provider: parsed.data.header.config.provider, model: parsed.data.header.config.model }
          break
        }
        case 'request/context':
        case 'model/selection': {
          const parsed = safeParse(Schema.decodeUnknownResult(routeSchema)(record.data))
          if (parsed.success) state.route = { provider: parsed.data.provider, model: parsed.data.model }
          break
        }
        case 'step/start': {
          const parsed = safeParse(Schema.decodeUnknownResult(turnStepSchema)(record.data))
          if (parsed.success && time !== null) {
            state.stepStarts[stepKey(parsed.data.turn, parsed.data.step)] = time
            state.activeTurn = parsed.data.turn
          }
          break
        }
        case 'assistant/message':
        case 'assistant/attempt': {
          const parsed = safeParse(Schema.decodeUnknownResult(assistantSchema)(record.data))
          if (!parsed.success || seq === null) break
          const data = parsed.data
          const key = stepKey(data.turn, data.step)
          let usage = data.usage === undefined ? null : toUsage(data.usage)
          let firstChunkAt: number | null = null
          let finish: { readonly kind: string; readonly code: string | null; readonly at: number | null } | null = null
          for (const raw of data.stream ?? []) {
            const entry = safeParse(Schema.decodeUnknownResult(streamEntrySchema)(raw))
            if (!entry.success) continue
            const at = entry.data.time ?? null
            const chunk = entry.data.chunk
            // A stream that only carries its error `finish` never produced a token.
            if (firstChunkAt === null && at !== null && chunk?.type !== 'finish' && chunk?.type !== 'usage') firstChunkAt = at
            if (chunk?.type === 'usage' && chunk.usage !== undefined && data.usage === undefined) usage = toUsage(chunk.usage)
            if (chunk?.type === 'finish' && chunk.reason !== undefined) finish = { kind: chunk.reason.kind, code: chunk.reason.failure?.code ?? null, at }
          }
          const stepStart = state.stepStarts[key]
          const startedAt = stepStart ?? firstChunkAt ?? finish?.at ?? time ?? 0
          const failed = finish?.kind === 'error' || record.type === 'assistant/attempt'
          const aborted = finish !== null && ABORTED_TURN_REASONS.has(finish.kind)
          const source = data.message?.source
          const row: RequestRow = {
            id: `${sessionId()}#${String(seq)}`,
            sessionId: sessionId(),
            seq,
            messageId: data.message?.id ?? null,
            turn: data.turn,
            step: data.step,
            purpose: agentPurpose(),
            source: 'log',
            provider: source?.provider ?? state.route?.provider ?? '',
            model: source?.model ?? state.route?.model ?? '',
            startedAt,
            endedAt: finish?.at ?? time,
            ttftMs: stepStart !== undefined && firstChunkAt !== null ? Math.max(0, firstChunkAt - stepStart) : null,
            usage,
            status: failed ? 'failed' : aborted ? 'aborted' : 'ok',
            stopReason: source?.replayState?.response?.stopReason ?? (finish === null ? null : (STOP_REASON_BY_FINISH.get(finish.kind) ?? finish.kind)),
            errorCode: finish?.code ?? null,
          }
          if (record.type === 'assistant/attempt' && finish === null) state.openAttempts.push({ key, row })
          else rows.push(row)
          if (!state.settledSteps.includes(key)) state.settledSteps.push(key)
          break
        }
        case 'llm/retry': {
          const parsed = safeParse(Schema.decodeUnknownResult(retrySchema)(record.data))
          if (!parsed.success) break
          const key = stepKey(parsed.data.turn, parsed.data.step)
          const code = parsed.data.failure?.code ?? null
          for (const open of state.openAttempts.filter(attempt => attempt.key === key)) rows.push({ ...open.row, status: 'failed', errorCode: code })
          state.openAttempts = state.openAttempts.filter(attempt => attempt.key !== key)
          break
        }
        case 'step/end': {
          const parsed = safeParse(Schema.decodeUnknownResult(turnStepSchema)(record.data))
          if (!parsed.success || seq === null || time === null) break
          const key = stepKey(parsed.data.turn, parsed.data.step)
          const startedAt = state.stepStarts[key]
          if (startedAt !== undefined && !state.settledSteps.includes(key))
            state.silentSteps.push({ turn: parsed.data.turn, step: parsed.data.step, seq, startedAt, endedAt: time })
          break
        }
        case 'turn/end': {
          const parsed = safeParse(Schema.decodeUnknownResult(turnEndSchema)(record.data))
          if (!parsed.success) break
          const reason = parsed.data.reason?.kind ?? null
          if (state.activeTurn === parsed.data.turn) state.activeTurn = null
          const turnTools = state.openTools.filter(tool => tool.turn === parsed.data.turn)
          for (const tool of turnTools)
            tools.push({
              id: `${sessionId()}#${String(tool.seq)}`,
              sessionId: sessionId(),
              seq: tool.seq,
              turn: tool.turn,
              step: tool.step,
              name: tool.name,
              category: tool.category,
              owner: tool.owner,
              normalizedCommand: tool.normalizedCommand,
              testRunner: tool.testRunner,
              startedAt: tool.startedAt,
              endedAt: time,
              outcome: ABORTED_TURN_REASONS.has(reason ?? '') ? 'interrupted' : 'unknown',
            })
          const turnToolIds = new Set(turnTools.map(tool => tool.callId))
          state.openTools = state.openTools.filter(tool => !turnToolIds.has(tool.callId))
          const turnPrefix = `${String(parsed.data.turn)}:`
          for (const open of state.openAttempts.filter(attempt => attempt.key.startsWith(turnPrefix))) {
            const aborted = reason !== null && ABORTED_TURN_REASONS.has(reason)
            rows.push({
              ...open.row,
              status: aborted ? 'aborted' : 'failed',
              stopReason: aborted ? reason : open.row.stopReason,
              errorCode: aborted ? null : (parsed.data.reason?.error?.code ?? open.row.errorCode),
            })
          }
          state.openAttempts = state.openAttempts.filter(attempt => !attempt.key.startsWith(turnPrefix))
          if (reason !== null && ABORTED_TURN_REASONS.has(reason)) {
            for (const silent of state.silentSteps.filter(step => step.turn === parsed.data.turn)) {
              rows.push({
                id: `${sessionId()}#${String(silent.seq)}`,
                sessionId: sessionId(),
                seq: silent.seq,
                messageId: null,
                turn: silent.turn,
                step: silent.step,
                purpose: agentPurpose(),
                source: 'log',
                provider: state.route?.provider ?? '',
                model: state.route?.model ?? '',
                startedAt: silent.startedAt,
                endedAt: silent.endedAt,
                ttftMs: null,
                usage: null,
                status: 'aborted',
                stopReason: reason,
                errorCode: null,
              })
            }
          }
          // A turn's step bookkeeping is never needed again once it ends.
          state.stepStarts = Object.fromEntries(Object.entries(state.stepStarts).filter(([key]) => !key.startsWith(turnPrefix)))
          state.settledSteps = state.settledSteps.filter(key => !key.startsWith(turnPrefix))
          state.silentSteps = state.silentSteps.filter(step => step.turn !== parsed.data.turn)
          break
        }
        case 'compaction/start': {
          const parsed = safeParse(Schema.decodeUnknownResult(compactionStartSchema)(record.data))
          if (parsed.success && time !== null) state.compactionStarts[parsed.data.compactionId] = time
          break
        }
        case 'compaction/summary': {
          const parsed = safeParse(Schema.decodeUnknownResult(compactionSummarySchema)(record.data))
          if (!parsed.success || seq === null) break
          const startedAt = state.compactionStarts[parsed.data.compactionId] ?? time ?? 0
          delete state.compactionStarts[parsed.data.compactionId]
          rows.push({
            id: `${sessionId()}#${String(seq)}`,
            sessionId: sessionId(),
            seq,
            messageId: null,
            turn: null,
            step: null,
            purpose: 'compaction',
            source: 'log',
            provider: parsed.data.provider,
            model: parsed.data.model,
            startedAt,
            endedAt: time,
            ttftMs: null,
            usage: parsed.data.usage === undefined ? null : toUsage(parsed.data.usage),
            status: 'ok',
            stopReason: null,
            errorCode: null,
          })
          break
        }
        case 'session/title-llm-request': {
          const parsed = safeParse(Schema.decodeUnknownResult(titleRequestSchema)(record.data))
          if (!parsed.success || seq === null || time === null) break
          state.pendingTitle = { seq, startedAt: time, provider: parsed.data.route.provider, model: parsed.data.route.model }
          rows.push(titleRow(sessionId(), state.pendingTitle, null))
          break
        }
        case 'session/title': {
          const parsed = safeParse(Schema.decodeUnknownResult(titleSchema)(record.data))
          if (!parsed.success) break
          if (state.session !== null) state.session = { ...state.session, title: parsed.data.title }
          if (parsed.data.source?.kind === 'provider' && state.pendingTitle !== null && time !== null) {
            rows.push(titleRow(sessionId(), state.pendingTitle, time))
            state.pendingTitle = null
          }
          break
        }
      }
    }
    for (const call of state.openTools)
      tools.push({
        id: `${sessionId()}#${String(call.seq)}`,
        sessionId: sessionId(),
        seq: call.seq,
        turn: call.turn,
        step: call.step,
        name: call.name,
        category: call.category,
        owner: call.owner,
        normalizedCommand: call.normalizedCommand,
        testRunner: call.testRunner,
        startedAt: call.startedAt,
        endedAt: null,
        outcome: 'pending',
      })
    return { state, rows, tools }
  }
}

const titleRow = (sessionId: string, pending: NonNullable<FoldState['pendingTitle']>, endedAt: number | null): RequestRow => ({
  id: `${sessionId}#${String(pending.seq)}`,
  sessionId,
  seq: pending.seq,
  messageId: null,
  turn: null,
  step: null,
  purpose: 'title',
  source: 'log',
  provider: pending.provider,
  model: pending.model,
  startedAt: pending.startedAt,
  endedAt,
  ttftMs: null,
  usage: null,
  status: 'ok',
  stopReason: null,
  errorCode: null,
})
