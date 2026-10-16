import { z } from 'zod'
import type { LogRecord } from './session-log.js'

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

export type RequestPurpose = (typeof UsageFoldModel.REQUEST_PURPOSES)[number]
export type RequestStatus = (typeof UsageFoldModel.REQUEST_STATUSES)[number]

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

const stepKey = (turn: number, step: number): string => `${String(turn)}:${String(step)}`

const foldStateSchema = z.object({
  session: z
    .object({
      id: z.string(),
      cwd: z.string().nullable(),
      parentSession: z.string().nullable(),
      subagent: z.boolean(),
      createdAt: z.number().nullable(),
      title: z.string().nullable(),
    })
    .nullable(),
  route: z.object({ provider: z.string(), model: z.string() }).nullable(),
  stepStarts: z.record(z.string(), z.number()),
  settledSteps: z.array(z.string()),
  silentSteps: z.array(z.object({ turn: z.number(), step: z.number(), seq: z.number(), startedAt: z.number(), endedAt: z.number() })),
  compactionStarts: z.record(z.string(), z.number()),
  pendingTitle: z.object({ seq: z.number(), startedAt: z.number(), provider: z.string(), model: z.string() }).nullable(),
  /** Attempts that ended without a finish chunk: a retry or the turn's end says whether they failed or were aborted. */
  openAttempts: z.array(z.object({ key: z.string(), row: z.custom<RequestRow>(value => typeof value === 'object' && value !== null) })),
})

export type FoldState = z.infer<typeof foldStateSchema>

const headerSchema = z.object({
  id: z.string(),
  createdAt: z.number().optional(),
  cwd: z.string().optional(),
  parentSession: z.string().optional(),
  origin: z.string().optional(),
})
const routeSchema = z.object({ provider: z.string(), model: z.string() })
const requestHeaderSchema = z.object({ header: z.object({ config: routeSchema }) })
const turnStepSchema = z.object({ turn: z.number(), step: z.number() })
const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
})
const streamEntrySchema = z.object({
  type: z.string(),
  time: z.number().optional(),
  chunk: z
    .object({
      type: z.string(),
      usage: usageSchema.optional(),
      reason: z.object({ kind: z.string(), failure: z.object({ code: z.string().optional() }).optional() }).optional(),
    })
    .optional(),
})
const assistantSchema = z.object({
  turn: z.number(),
  step: z.number(),
  usage: usageSchema.optional(),
  stream: z.array(z.unknown()).optional(),
  message: z
    .object({
      id: z.string().optional(),
      source: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          replayState: z.object({ response: z.object({ stopReason: z.string().optional() }).optional() }).optional(),
        })
        .optional(),
    })
    .optional(),
})
const turnEndSchema = z.object({
  turn: z.number(),
  reason: z.object({ kind: z.string(), error: z.object({ code: z.string().optional() }).optional() }).optional(),
})
const retrySchema = z.object({ turn: z.number(), step: z.number(), failure: z.object({ code: z.string().optional() }).optional() })
const compactionStartSchema = z.object({ compactionId: z.string() })
const compactionSummarySchema = z.object({ compactionId: z.string(), provider: z.string(), model: z.string(), usage: usageSchema.optional() })
const titleRequestSchema = z.object({ route: routeSchema })
const titleSchema = z.object({ title: z.string(), source: z.object({ kind: z.string() }).optional() })

const toUsage = (sample: z.infer<typeof usageSchema>): TokenUsage => ({
  input: sample.inputTokens,
  cacheRead: sample.cacheReadTokens ?? 0,
  cacheWrite: sample.cacheWriteTokens ?? 0,
  output: sample.outputTokens,
  reasoning: sample.reasoningTokens ?? 0,
})

/** pi-ai's names for the finish kinds DSH records, so settled and failed rows read alike. */
const STOP_REASON_BY_FINISH: Readonly<Record<string, string>> = { 'tool-calls': 'toolUse', stop: 'stop', 'max-tokens': 'length' }

const ABORTED_TURN_REASONS = new Set(['aborted', 'interrupted'])

export class UsageFoldModel {
  static readonly REQUEST_PURPOSES = ['agent', 'subagent', 'compaction', 'title', 'memory', 'other'] as const
  static readonly REQUEST_STATUSES = ['ok', 'aborted', 'failed'] as const

  static readonly initialFoldState = (): FoldState => ({
    session: null,
    route: null,
    stepStarts: {},
    settledSteps: [],
    silentSteps: [],
    compactionStarts: {},
    pendingTitle: null,
    openAttempts: [],
  })

  /** A stored state that no longer decodes restarts the fold from the file's first byte. */
  static readonly decodeFoldState = (raw: string): FoldState | undefined => {
    try {
      const parsed = foldStateSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  static readonly foldRecords = (input: {
    readonly state: FoldState
    readonly records: readonly LogRecord[]
    /** Fallback session id when the header record was folded in an earlier pass (always in state then). */
    readonly sessionId: string
  }): { readonly state: FoldState; readonly rows: RequestRow[] } => {
    const state: FoldState = structuredClone(input.state)
    const rows: RequestRow[] = []
    const sessionId = (): string => state.session?.id ?? input.sessionId
    const agentPurpose = (): RequestPurpose => (state.session?.subagent === true ? 'subagent' : 'agent')

    for (const record of input.records) {
      const time = typeof record.time === 'number' ? record.time : null
      const seq = typeof record.seq === 'number' ? record.seq : null
      switch (record.type) {
        case 'session': {
          const header = headerSchema.safeParse(record)
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
          const parsed = requestHeaderSchema.safeParse(record.data)
          if (parsed.success) state.route = { provider: parsed.data.header.config.provider, model: parsed.data.header.config.model }
          break
        }
        case 'request/context':
        case 'model/selection': {
          const parsed = routeSchema.safeParse(record.data)
          if (parsed.success) state.route = { provider: parsed.data.provider, model: parsed.data.model }
          break
        }
        case 'step/start': {
          const parsed = turnStepSchema.safeParse(record.data)
          if (parsed.success && time !== null) state.stepStarts[stepKey(parsed.data.turn, parsed.data.step)] = time
          break
        }
        case 'assistant/message':
        case 'assistant/attempt': {
          const parsed = assistantSchema.safeParse(record.data)
          if (!parsed.success || seq === null) break
          const data = parsed.data
          const key = stepKey(data.turn, data.step)
          let usage = data.usage === undefined ? null : toUsage(data.usage)
          let firstChunkAt: number | null = null
          let finish: { readonly kind: string; readonly code: string | null; readonly at: number | null } | null = null
          for (const raw of data.stream ?? []) {
            const entry = streamEntrySchema.safeParse(raw)
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
            stopReason: source?.replayState?.response?.stopReason ?? (finish === null ? null : (STOP_REASON_BY_FINISH[finish.kind] ?? finish.kind)),
            errorCode: finish?.code ?? null,
          }
          if (record.type === 'assistant/attempt' && finish === null) state.openAttempts.push({ key, row })
          else rows.push(row)
          if (!state.settledSteps.includes(key)) state.settledSteps.push(key)
          break
        }
        case 'llm/retry': {
          const parsed = retrySchema.safeParse(record.data)
          if (!parsed.success) break
          const key = stepKey(parsed.data.turn, parsed.data.step)
          const code = parsed.data.failure?.code ?? null
          for (const open of state.openAttempts.filter(attempt => attempt.key === key)) rows.push({ ...open.row, status: 'failed', errorCode: code })
          state.openAttempts = state.openAttempts.filter(attempt => attempt.key !== key)
          break
        }
        case 'step/end': {
          const parsed = turnStepSchema.safeParse(record.data)
          if (!parsed.success || seq === null || time === null) break
          const key = stepKey(parsed.data.turn, parsed.data.step)
          const startedAt = state.stepStarts[key]
          if (startedAt !== undefined && !state.settledSteps.includes(key))
            state.silentSteps.push({ turn: parsed.data.turn, step: parsed.data.step, seq, startedAt, endedAt: time })
          break
        }
        case 'turn/end': {
          const parsed = turnEndSchema.safeParse(record.data)
          if (!parsed.success) break
          const reason = parsed.data.reason?.kind ?? null
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
          const parsed = compactionStartSchema.safeParse(record.data)
          if (parsed.success && time !== null) state.compactionStarts[parsed.data.compactionId] = time
          break
        }
        case 'compaction/summary': {
          const parsed = compactionSummarySchema.safeParse(record.data)
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
          const parsed = titleRequestSchema.safeParse(record.data)
          if (!parsed.success || seq === null || time === null) break
          state.pendingTitle = { seq, startedAt: time, provider: parsed.data.route.provider, model: parsed.data.route.model }
          rows.push(titleRow(sessionId(), state.pendingTitle, null))
          break
        }
        case 'session/title': {
          const parsed = titleSchema.safeParse(record.data)
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
    return { state, rows }
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
