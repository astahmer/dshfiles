import { createHash } from 'node:crypto'
import { z } from 'zod'
import { SessionLogs, type SessionLogRef } from './self-improve-log.ts'

/**
 * Turns Session logs into bounded, cross-Session behavioural signals.
 *
 * A signal is a *candidate* for investigation, never a diagnosed problem: the
 * extractor records what the logs show (a tool errored, a command repeated, a
 * user pushed back) with a capped excerpt, so a later pass can read the
 * original evidence. Recall is preferred over precision; ranking and the
 * `recurring` flag are what separate a pattern from an incident.
 *
 * Extraction output is per-Session and compact by construction (grouped,
 * counted, capped) so it can be cached and re-aggregated without holding 850
 * conversations in memory.
 */

/** Bump when extraction changes so a cached extraction is not reused. */
const EXTRACTOR_VERSION = 4

const MAX_EXCERPT = 240
const MAX_SAMPLES_PER_SIGNAL = 3
const MAX_SIGNATURES_PER_SESSION = 40
const MAX_PROMPTS_PER_SESSION = 60
const MIN_REPEATED_CALLS = 3
const SLOW_TOOL_MS = 30_000
/** A normal ending (`completed`, `stop`) is not evidence; only these read as friction. */
const ABNORMAL_TURN_ENDINGS: ReadonlySet<string> = new Set(['interrupted', 'aborted', 'cancelled', 'failed', 'error', 'timeout', 'usage-limit'])

export type SignalCategory = 'tools' | 'memory' | 'skills' | 'ux' | 'infra' | 'agent'

export interface RepeatedCallFact {
  readonly name: string
  readonly argsKey: string
  readonly family: string
  readonly count: number
  readonly firstSeq: number
  readonly firstTime: number
  readonly callId: string
  readonly excerpt: string
}

export interface ToolStatFact {
  readonly name: string
  readonly count: number
  readonly slowCount: number
  readonly totalMs: number
  readonly worstMs: number
}

export interface ToolErrorFact {
  readonly name: string
  readonly signature: string
  readonly count: number
  readonly seq: number
  readonly time: number
  readonly callId: string
  readonly excerpt: string
}

export interface JobFact {
  readonly kind: string
  readonly label: string
  readonly detail: string
}

export interface RetryFact {
  readonly provider: string
  readonly code: string
  readonly message: string
  readonly count: number
}

export interface PromptFact {
  readonly seq: number
  readonly time: number
  readonly kind: 'initial' | 'peer' | 'followup'
  readonly excerpt: string
  readonly themes: readonly string[]
}

export interface JjFact {
  readonly subcommand: string
  readonly count: number
  readonly seq: number
  readonly excerpt: string
  readonly error: string
}

export interface TokenTotals {
  readonly input: number
  readonly cacheRead: number
  readonly output: number
}

export interface SessionFacts {
  readonly sessionId: string
  readonly project: string
  readonly path: string
  readonly title: string
  readonly cwd: string
  readonly provider: string
  readonly model: string
  readonly createdAt: number
  readonly lastEventAt: number
  readonly durationMs: number
  readonly turns: number
  readonly steps: number
  readonly compactions: number
  readonly peerMessages: number
  readonly turnEnds: Readonly<Record<string, number>>
  readonly repeatedCalls: readonly RepeatedCallFact[]
  readonly toolStats: Readonly<Record<string, ToolStatFact>>
  readonly toolErrors: readonly ToolErrorFact[]
  readonly failedJobs: readonly JobFact[]
  readonly retries: readonly RetryFact[]
  readonly prompts: readonly PromptFact[]
  readonly jjFailures: readonly JjFact[]
  readonly goals: readonly string[]
  readonly skillLoads: Readonly<Record<string, number>>
  readonly fileEdits: Readonly<Record<string, number>>
  readonly revisions: readonly string[]
  readonly tokens: TokenTotals
  readonly toolCallCount: number
  readonly toolErrorCount: number
  readonly corrections: number
}

/** Validates a cached extraction; a corrupt cache must fail loudly, not skew a report. */
const sessionFactsSchema: z.ZodType<SessionFacts> = z.object({
  sessionId: z.string(),
  project: z.string(),
  path: z.string(),
  title: z.string(),
  cwd: z.string(),
  provider: z.string(),
  model: z.string(),
  createdAt: z.number(),
  lastEventAt: z.number(),
  durationMs: z.number(),
  turns: z.number(),
  steps: z.number(),
  compactions: z.number(),
  peerMessages: z.number(),
  turnEnds: z.record(z.string(), z.number()),
  repeatedCalls: z.array(
    z.object({
      name: z.string(),
      argsKey: z.string(),
      family: z.string(),
      count: z.number(),
      firstSeq: z.number(),
      firstTime: z.number(),
      callId: z.string(),
      excerpt: z.string(),
    }),
  ),
  toolStats: z.record(z.string(), z.object({ name: z.string(), count: z.number(), slowCount: z.number(), totalMs: z.number(), worstMs: z.number() })),
  toolErrors: z.array(
    z.object({ name: z.string(), signature: z.string(), count: z.number(), seq: z.number(), time: z.number(), callId: z.string(), excerpt: z.string() }),
  ),
  failedJobs: z.array(z.object({ kind: z.string(), label: z.string(), detail: z.string() })),
  retries: z.array(z.object({ provider: z.string(), code: z.string(), message: z.string(), count: z.number() })),
  prompts: z.array(
    z.object({ seq: z.number(), time: z.number(), kind: z.enum(['initial', 'peer', 'followup']), excerpt: z.string(), themes: z.array(z.string()) }),
  ),
  jjFailures: z.array(z.object({ subcommand: z.string(), count: z.number(), seq: z.number(), excerpt: z.string(), error: z.string() })),
  goals: z.array(z.string()),
  skillLoads: z.record(z.string(), z.number()),
  fileEdits: z.record(z.string(), z.number()),
  revisions: z.array(z.string()),
  tokens: z.object({ input: z.number(), cacheRead: z.number(), output: z.number() }),
  toolCallCount: z.number(),
  toolErrorCount: z.number(),
  corrections: z.number(),
})

const textPartSchema = z.object({ type: z.string(), text: z.string().optional() })
const contentSchema = z.array(textPartSchema)
const messageSchema = z
  .object({ role: z.string().optional(), content: contentSchema.optional(), isError: z.boolean().optional(), toolCallId: z.string().optional() })
  .passthrough()
const usageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
})
const failureSchema = z.object({ message: z.string().optional(), code: z.string().optional() })

const sessionRecordSchema = z.object({ id: z.string(), createdAt: z.number().optional(), cwd: z.string().optional() })
const titleSchema = z.object({ title: z.string() })
const toolCallSchema = z.object({ callId: z.string(), name: z.string(), arguments: z.string().optional() })
const toolResultSchema = z.object({ message: messageSchema })
const turnEndSchema = z.object({ reason: z.object({ kind: z.string() }).optional() })
const attemptSchema = z.object({
  stream: z
    .array(z.object({ chunk: z.object({ type: z.string(), reason: z.object({ kind: z.string(), failure: failureSchema.optional() }).optional() }).optional() }))
    .optional(),
})
const retrySchema = z.object({ provider: z.string(), failure: failureSchema.optional() })
const jobSettledSchema = z.object({ kind: z.string(), label: z.string().optional(), status: z.string(), detail: z.string().optional() })
const goalSchema = z.object({ operation: z.string(), goal: z.object({ objective: z.string() }) })
const inboxSchema = z.object({ inserted: z.array(messageSchema).optional() })
const assistantSchema = z.object({
  usage: usageSchema.optional(),
  message: z
    .object({ source: z.object({ provider: z.string().optional(), model: z.string().optional() }).optional() })
    .passthrough()
    .optional(),
})
const editArgsSchema = z.object({ file_path: z.string().optional(), command: z.string().optional() })
const skillArgsSchema = z.object({ name: z.string() })

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b(?:password|passwd|secret|token|api[_-]?key|authorization)\b\s*[:=]\s*["']?[^\s"',]{6,}/gi,
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
]

/** Stored excerpts never carry credential-shaped text; reports are copied into plans and chat. */
const redact = (text: string): string => {
  let output = text
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, '[redacted]')
  return output
}

const excerptOf = (text: string): string => redact(collapse(text)).slice(0, MAX_EXCERPT)

/** Groups error text that differs only by volatile detail (paths, ids, timings, counts). */
const errorSignature = (text: string): string => {
  const line = collapse(text.split('\n').find(candidate => candidate.trim().length > 0) ?? text)
  return line
    .replace(/[A-Za-z0-9_./-]*\/[A-Za-z0-9_./-]+/g, '<path>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\b\d+(\.\d+)?(ms|s|m)\b/g, '<n>')
    .replace(/\d+/g, '<n>')
    .slice(0, 120)
}

const digest = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 12)

const commandFamily = (command: string): string => collapse(command).replace(/\|.*$/, '').split(/\s+/).slice(0, 3).join(' ').replace(/\d+/g, '<n>').slice(0, 60)

const toolArgumentsSchema = z
  .object({ command: z.string().optional(), pattern: z.string().optional(), query: z.string().optional(), file_path: z.string().optional() })
  .passthrough()

export interface CallKeys {
  readonly argsKey: string
  readonly family: string
}

/** Literal identity for "the same call again"; a softer family key for "the same shape of call again". */

const callKeys = (toolName: string, rawArguments: string | undefined): CallKeys => {
  const parsed = rawArguments === undefined ? undefined : SessionLogs.decodeJsonSafe(toolArgumentsSchema, rawArguments)
  if (parsed === undefined) return { argsKey: digest(`${toolName}:${rawArguments ?? ''}`), family: `${toolName}:?` }
  const hint = parsed.command ?? parsed.pattern ?? parsed.query ?? parsed.file_path
  const family = parsed.command !== undefined ? commandFamily(parsed.command) : collapse(hint ?? '').slice(0, 60)
  const canonical = Object.keys(parsed)
    .sort()
    .map(key => `${key}=${JSON.stringify(parsed[key])}`)
    .join('\u0000')
  return { argsKey: digest(`${toolName}:${canonical}`), family: `${toolName}:${family}` }
}

const CORRECTION_THEMES: ReadonlyArray<{ readonly theme: string; readonly patterns: readonly RegExp[] }> = [
  {
    theme: 'misunderstood-requirement',
    patterns: [/\bnot what i\b/i, /\bi didn'?t ask\b/i, /\bthat'?s not\b/i, /^no[,.!\s]/i, /\bwrong\b/i, /\bincorrect\b/i, /\bmisunderst/i, /\bi meant\b/i],
  },
  {
    theme: 'incomplete-or-unfixed',
    patterns: [
      /\bstill (broken|failing|fails|not|doesn'?t|does not|isn'?t|no|wrong|same|shows|missing)\b/i,
      /\bagain\b.{0,60}\b(fail|failed|broke|broken|error|same|not fixed)\b/i,
      /\b(you )?(forgot|missed|skipped)\b/i,
      /\b(you )?didn'?t (fix|do|add|change|implement|remove|update|work)\b/i,
      /\bnot fixed\b/i,
      /\b(doesn'?t|does not|don'?t|do not) work\b/i,
      /\bstill broken\b/i,
    ],
  },
  {
    theme: 'unwanted-change',
    patterns: [/\brevert\b/i, /\bundo\b/i, /\bwhy did you\b/i, /\bdon'?t change\b/i, /\btoo much\b/i, /\boverengineer/i],
  },
  {
    theme: 'stop-and-replan',
    patterns: [/^stop\b/i, /^wait\b/i, /\bhold on\b/i, /\btake a step back\b/i, /\bre-?pitch\b/i, /\bthink again\b/i],
  },
  {
    theme: 'process-complaint',
    patterns: [/\btoo slow\b/i, /\bwast(e|ing)\b/i, /\bkeep (looping|retrying|polling)\b/i, /\bwhy are you\b/i, /\bdon'?t (sleep|poll)\b/i],
  },
]

/**
 * Only the opening of a message is scored: pushback lives in the first sentence,
 * while a long multi-part brief routinely contains "again", "missing" or "still"
 * as ordinary instructions. Matching the whole brief is what made
 * `incomplete-or-unfixed` the loudest signal of the week while its sampled hits
 * were follow-up requests ("investigate again, then work on the solution").
 */
const CORRECTION_HEAD_CHARS = 400

const correctionThemes = (text: string): readonly string[] => {
  const head = collapse(text).slice(0, CORRECTION_HEAD_CHARS)
  return CORRECTION_THEMES.filter(entry => entry.patterns.some(pattern => pattern.test(head))).map(entry => entry.theme)
}

const SEARCH_TOOLS: ReadonlySet<string> = new Set([
  'find_threads',
  'related_threads',
  'memory_search',
  'grep',
  'glob',
  'web_search',
  'web_fetch',
  'dshx_comm_history',
  'session_search_health',
  'activity_timeline_page',
  'activity_timeline_search',
])

const partsText = (message: z.infer<typeof messageSchema>): string => (message.content ?? []).map(part => part.text ?? '').join('\n')

interface MutableCallGroup {
  readonly name: string
  readonly argsKey: string
  readonly family: string
  count: number
  readonly firstSeq: number
  readonly firstTime: number
  readonly callId: string
  readonly excerpt: string
}

const extractSession = async (ref: SessionLogRef): Promise<SessionFacts> => {
  const callGroups = new Map<string, MutableCallGroup>()
  const toolStats = new Map<string, { count: number; slowCount: number; totalMs: number; worstMs: number }>()
  const errorGroups = new Map<string, ToolErrorFact & { count: number }>()
  const failedJobs: JobFact[] = []
  const retryGroups = new Map<string, RetryFact & { count: number }>()
  const prompts: PromptFact[] = []
  const jjFailures = new Map<string, JjFact & { count: number }>()
  const goals: string[] = []
  const skillLoads: Record<string, number> = {}
  const fileEdits: Record<string, number> = {}
  const revisions: string[] = []
  const turnEnds: Record<string, number> = {}
  const tokens = { input: 0, cacheRead: 0, output: 0 }
  const pendingCalls = new Map<string, { readonly name: string; readonly time: number }>()
  const pendingJj = new Map<string, { readonly subcommand: string; readonly seq: number; readonly excerpt: string }>()
  let title = ''
  let cwd = ''
  let provider = ''
  let model = ''
  let createdAt = 0
  let lastEventAt = 0
  let turns = 0
  let steps = 0
  let compactions = 0
  let peerMessages = 0
  let sawAgentWork = false
  let toolCallCount = 0
  let toolErrorCount = 0
  let corrections = 0
  let sessionId = ref.sessionId

  const pushPrompt = (input: { readonly seq: number; readonly time: number; readonly kind: PromptFact['kind']; readonly text: string }): void => {
    if (prompts.length >= MAX_PROMPTS_PER_SESSION) return
    const isFollowup = input.kind === 'followup'
    const themes = isFollowup ? correctionThemes(input.text) : []
    if (isFollowup && themes.length > 0) corrections += 1
    prompts.push({ seq: input.seq, time: input.time, kind: input.kind, excerpt: excerptOf(input.text), themes })
  }

  /**
   * DSH appends runtime context, the skill catalog, compaction checkpoints,
   * background-job notices and peer-agent messages as `user`-role records. The
   * log marks the origin structurally in `data.source.kind`; only `user` is a
   * human. Text matching alone produced a signal claiming ~630 Sessions of
   * pushback whose every inspected hit was injected text, so origin wins and the
   * text check only covers logs written before that field existed.
   */
  const isHumanPrompt = (text: string, sourceKind: string | undefined): boolean => {
    if (sourceKind !== undefined) return sourceKind === 'user'
    return !/^<system-reminder|^Current runtime context\.|^This is an automatically generated checkpoint|^Background subagent |^Agent .* sent a message:|^Time sampled while preparing/.test(
      text,
    )
  }

  for await (const record of SessionLogs.stream(ref.path)) {
    const at = record.time ?? 0
    if (at > lastEventAt) lastEventAt = at
    switch (record.type) {
      case 'session': {
        const parsed = sessionRecordSchema.safeParse(record)
        if (!parsed.success) break
        sessionId = parsed.data.id
        createdAt = parsed.data.createdAt ?? 0
        cwd = parsed.data.cwd ?? ''
        break
      }
      case 'session/title': {
        const parsed = titleSchema.safeParse(record.data)
        if (parsed.success) title = parsed.data.title
        break
      }
      case 'step/start':
        steps += 1
        break
      case 'turn/start':
        turns += 1
        break
      case 'turn/end': {
        const parsed = turnEndSchema.safeParse(record.data)
        const kind = parsed.success ? (parsed.data.reason?.kind ?? 'unknown') : 'unknown'
        if (ABNORMAL_TURN_ENDINGS.has(kind)) turnEnds[kind] = (turnEnds[kind] ?? 0) + 1
        break
      }
      case 'compaction/start':
        compactions += 1
        break
      case 'tool/call': {
        const parsed = toolCallSchema.safeParse(record.data)
        if (!parsed.success) break
        sawAgentWork = true
        toolCallCount += 1
        const keys = callKeys(parsed.data.name, parsed.data.arguments)
        const groupKey = `${parsed.data.name}\u0000${keys.argsKey}`
        const group = callGroups.get(groupKey)
        if (group === undefined) {
          callGroups.set(groupKey, {
            name: parsed.data.name,
            argsKey: keys.argsKey,
            family: keys.family,
            count: 1,
            firstSeq: record.seq ?? 0,
            firstTime: at,
            callId: parsed.data.callId,
            excerpt: excerptOf(parsed.data.arguments ?? ''),
          })
        } else {
          group.count += 1
        }
        pendingCalls.set(parsed.data.callId, { name: parsed.data.name, time: at })
        if (pendingCalls.size > 200) {
          const oldest = pendingCalls.keys().next().value
          if (oldest !== undefined) pendingCalls.delete(oldest)
        }
        const args = editArgsSchema.safeParse(SessionLogs.decodeJsonSafe(editArgsSchema, parsed.data.arguments ?? '{}') ?? {})
        if (parsed.data.name === 'skill') {
          const named = skillArgsSchema.safeParse(SessionLogs.decodeJsonSafe(skillArgsSchema, parsed.data.arguments ?? '{}') ?? {})
          if (named.success) skillLoads[named.data.name] = (skillLoads[named.data.name] ?? 0) + 1
        }
        if (args.success && args.data.file_path !== undefined) fileEdits[args.data.file_path] = (fileEdits[args.data.file_path] ?? 0) + 1
        const command = args.success ? args.data.command : undefined
        if (command === undefined) break
        const jjCommand =
          /\bjj\s+(commit|describe|new|squash|rebase|abandon|bookmark|workspace|git|duplicate|split|resolve|undo|restore|edit|status|log|show|diff|file|op)\b/.exec(
            command,
          )
        if (jjCommand !== null)
          pendingJj.set(parsed.data.callId, { subcommand: jjCommand[1] ?? '', seq: record.seq ?? 0, excerpt: excerptOf(command.slice(0, 120)) })
        const describe = /jj\s+describe[^\n]*?(?:-m|--message)\s+(?:"([^"]{4,120})"|'([^']{4,120})'|([^\n;]{4,120}))/.exec(command)
        const revisionTitle = describe?.[1] ?? describe?.[2] ?? describe?.[3]
        if (revisionTitle !== undefined && revisions.length < 40) revisions.push(excerptOf(revisionTitle))
        break
      }
      case 'tool/result': {
        const parsed = toolResultSchema.safeParse(record.data)
        if (!parsed.success) break
        const callId = parsed.data.message.toolCallId ?? ''
        const call = pendingCalls.get(callId)
        pendingCalls.delete(callId)
        const jjCall = pendingJj.get(callId)
        pendingJj.delete(callId)
        if (call !== undefined) {
          const stat = toolStats.get(call.name) ?? { count: 0, slowCount: 0, totalMs: 0, worstMs: 0 }
          const duration = Math.max(0, at - call.time)
          toolStats.set(call.name, {
            count: stat.count + 1,
            slowCount: stat.slowCount + (duration >= SLOW_TOOL_MS ? 1 : 0),
            totalMs: stat.totalMs + duration,
            worstMs: Math.max(stat.worstMs, duration),
          })
        }
        if (parsed.data.message.isError !== true) break
        toolErrorCount += 1
        if (jjCall !== undefined) {
          const jjKey = `${jjCall.subcommand}\u0000${errorSignature(partsText(parsed.data.message))}`
          const existingJj = jjFailures.get(jjKey)
          if (existingJj !== undefined) existingJj.count += 1
          else
            jjFailures.set(jjKey, {
              subcommand: jjCall.subcommand,
              count: 1,
              seq: jjCall.seq,
              excerpt: jjCall.excerpt,
              error: errorSignature(partsText(parsed.data.message)),
            })
        }
        const name = call?.name ?? 'unknown'
        const text = partsText(parsed.data.message)
        const signature = errorSignature(text)
        const key = `${name}\u0000${signature}`
        const existing = errorGroups.get(key)
        if (existing !== undefined) {
          existing.count += 1
          break
        }
        if (errorGroups.size >= MAX_SIGNATURES_PER_SESSION) break
        errorGroups.set(key, { name, signature, count: 1, seq: record.seq ?? 0, time: at, callId, excerpt: excerptOf(text) })
        break
      }
      case 'job/settled': {
        const parsed = jobSettledSchema.safeParse(record.data)
        if (!parsed.success || parsed.data.status === 'completed') break
        if (failedJobs.length >= 20) break
        failedJobs.push({ kind: parsed.data.kind, label: excerptOf(parsed.data.label ?? ''), detail: excerptOf(parsed.data.detail ?? parsed.data.status) })
        break
      }
      case 'llm/retry': {
        const parsed = retrySchema.safeParse(record.data)
        if (!parsed.success) break
        const key = `${parsed.data.provider}\u0000${parsed.data.failure?.code ?? 'UNKNOWN'}`
        const existing = retryGroups.get(key)
        if (existing !== undefined) {
          existing.count += 1
          break
        }
        retryGroups.set(key, {
          provider: parsed.data.provider,
          code: parsed.data.failure?.code ?? 'UNKNOWN',
          message: excerptOf(parsed.data.failure?.message ?? ''),
          count: 1,
        })
        break
      }
      case 'assistant/attempt': {
        const parsed = attemptSchema.safeParse(record.data)
        if (!parsed.success) break
        for (const entry of parsed.data.stream ?? []) {
          const failure = entry.chunk?.type === 'finish' ? entry.chunk.reason?.failure : undefined
          if (entry.chunk?.reason?.kind !== 'error' || failure === undefined) continue
          const key = `${provider}\u0000${failure.code ?? 'UNKNOWN'}`
          const existing = retryGroups.get(key)
          if (existing !== undefined) {
            existing.count += 1
            continue
          }
          retryGroups.set(key, { provider, code: failure.code ?? 'UNKNOWN', message: excerptOf(failure.message ?? ''), count: 1 })
        }
        break
      }
      case 'assistant/message': {
        const parsed = assistantSchema.safeParse(record.data)
        if (!parsed.success) break
        sawAgentWork = true
        const source = parsed.data.message?.source
        if (source?.provider !== undefined) provider = source.provider
        if (source?.model !== undefined) model = source.model
        const usage = parsed.data.usage
        if (usage === undefined) break
        tokens.input += usage.inputTokens ?? 0
        tokens.cacheRead += usage.cacheReadTokens ?? 0
        tokens.output += usage.outputTokens ?? 0
        break
      }
      case 'goal/change': {
        const parsed = goalSchema.safeParse(record.data)
        if (parsed.success && parsed.data.operation === 'create') goals.push(excerptOf(parsed.data.goal.objective))
        break
      }
      case 'user/message': {
        const parsed = z.object({ content: contentSchema, source: z.object({ kind: z.string() }).passthrough().optional() }).safeParse(record.data)
        if (!parsed.success) break
        const text = partsText({ content: parsed.data.content })
        if (!isHumanPrompt(text, parsed.data.source?.kind)) break
        pushPrompt({ seq: record.seq ?? 0, time: at, kind: sawAgentWork ? 'followup' : 'initial', text })
        break
      }
      case 'agent/inbox/spliced': {
        const parsed = inboxSchema.safeParse(record.data)
        if (!parsed.success) break
        for (const message of parsed.data.inserted ?? []) {
          peerMessages += 1
          pushPrompt({ seq: record.seq ?? 0, time: at, kind: 'peer', text: partsText(message) })
        }
        break
      }
      default:
        break
    }
  }

  const started = createdAt === 0 ? (lastEventAt === 0 ? ref.mtimeMs : lastEventAt) : createdAt
  return {
    sessionId,
    project: ref.project,
    path: ref.path,
    title: excerptOf(title),
    cwd,
    provider,
    model,
    createdAt,
    lastEventAt: lastEventAt === 0 ? ref.mtimeMs : lastEventAt,
    durationMs: Math.max(0, lastEventAt - started),
    turns,
    steps,
    compactions,
    peerMessages,
    turnEnds,
    repeatedCalls: [...callGroups.values()]
      .filter(group => group.count >= MIN_REPEATED_CALLS)
      .map(group => ({
        name: group.name,
        argsKey: group.argsKey,
        family: group.family,
        count: group.count,
        firstSeq: group.firstSeq,
        firstTime: group.firstTime,
        callId: group.callId,
        excerpt: group.excerpt,
      })),
    toolStats: Object.fromEntries([...toolStats.entries()].map(([name, stat]) => [name, { name, ...stat }])),
    toolErrors: [...errorGroups.values()],
    failedJobs,
    retries: [...retryGroups.values()],
    prompts,
    jjFailures: [...jjFailures.values()],
    goals,
    skillLoads,
    fileEdits: Object.fromEntries(Object.entries(fileEdits).filter(([, count]) => count >= 3)),
    revisions,
    tokens,
    toolCallCount,
    toolErrorCount,
    corrections,
  }
}

export interface SignalEvidence {
  readonly sessionId: string
  readonly project: string
  readonly seq: number
  readonly time: number
  readonly excerpt: string
  callId?: string
}

export interface Signal {
  readonly id: string
  readonly kind: string
  readonly category: SignalCategory
  readonly title: string
  readonly occurrences: number
  readonly sessions: number
  readonly recurring: boolean
  readonly confidence: 'high' | 'medium' | 'low'
  readonly severity: number
  readonly score: number
  readonly lastSeen: number
  readonly sessionIds: readonly string[]
  readonly evidence: readonly SignalEvidence[]
  readonly hint: string
}

interface SignalDraft {
  readonly kind: string
  readonly category: SignalCategory
  readonly title: string
  readonly severity: number
  readonly hint: string
  occurrences: number
  readonly sessionIds: Set<string>
  readonly evidence: SignalEvidence[]
  lastSeen: number
}

const SEVERITY_BY_KIND = new Map<string, number>([
  ['tool-error', 3],
  ['job-failure', 3],
  ['provider-retry', 3],
  ['jj-failure', 3],
  ['turn-end', 2],
  ['repeated-call', 2],
  ['correction', 2],
  ['compaction-pressure', 2],
  ['redundant-skill-load', 2],
  ['rework', 1],
  ['slow-tool', 1],
])

const HINT_BY_KIND = new Map<string, string>([
  ['tool-error', 'Read the failing Tool results in the named Sessions; a fix belongs in the tool, its docs, or the agent instructions that reach for it.'],
  ['job-failure', 'Check whether the job failed because of the command, the environment, or the way the agent used it.'],
  ['provider-retry', 'Separate provider-side instability from a harness cause (timeout budgets, oversized context, request assembly).'],
  ['jj-failure', 'Inspect the failed command in context; a repeated jj failure is usually a workspace/isolation or instruction problem.'],
  ['turn-end', 'Non-stop turn endings are evidence, not proof: check whether the agent or the user ended the turn.'],
  ['repeated-call', 'An identical call repeated in one Session is often a polling loop, a retry the agent owns, or a missing single-call affordance.'],
  ['correction', 'Read the user message and the turn before it; classify the correction before proposing anything.'],
  ['compaction-pressure', 'High compaction counts point at context growth; look at what the Session kept re-reading.'],
  ['redundant-skill-load', 'A skill loaded repeatedly in one Session may be missing progressive disclosure or a durable reminder.'],
  ['rework', 'A file edited many times in one Session suggests the change was not understood before it was made.'],
  ['slow-tool', 'Check whether the latency is the tool, the environment, or a run the agent should have backgrounded.'],
])

const aggregateSignals = (facts: readonly SessionFacts[], now: number): Signal[] => {
  const drafts = new Map<string, SignalDraft>()
  const add = (input: {
    readonly id: string
    readonly kind: string
    readonly category: SignalCategory
    readonly title: string
    readonly evidence: SignalEvidence
    readonly count?: number
  }): void => {
    let draft = drafts.get(input.id)
    if (draft === undefined) {
      draft = {
        kind: input.kind,
        category: input.category,
        title: input.title,
        severity: SEVERITY_BY_KIND.get(input.kind) ?? 1,
        hint: HINT_BY_KIND.get(input.kind) ?? '',
        occurrences: 0,
        sessionIds: new Set(),
        evidence: [],
        lastSeen: 0,
      }
      drafts.set(input.id, draft)
    }
    draft.occurrences += input.count ?? 1
    draft.sessionIds.add(input.evidence.sessionId)
    if (input.evidence.time > draft.lastSeen) draft.lastSeen = input.evidence.time
    if (draft.evidence.length < MAX_SAMPLES_PER_SIGNAL) draft.evidence.push(input.evidence)
  }

  for (const session of facts) {
    const provenance = (seq: number, time: number, excerpt: string, callId?: string): SignalEvidence => {
      const evidence: SignalEvidence = { sessionId: session.sessionId, project: session.project, seq, time: time === 0 ? session.lastEventAt : time, excerpt }
      if (callId !== undefined && callId.length > 0) evidence.callId = callId
      return evidence
    }

    for (const error of session.toolErrors) {
      add({
        id: `tool-error:${error.name}:${error.signature}`,
        kind: 'tool-error',
        category: error.name === 'skill' ? 'skills' : SEARCH_TOOLS.has(error.name) ? 'memory' : 'tools',
        title: `${error.name} fails: ${error.signature}`,
        count: error.count,
        evidence: provenance(error.seq, error.time, error.excerpt, error.callId),
      })
    }

    for (const call of session.repeatedCalls) {
      if (call.name === 'skill') continue
      add({
        id: `repeated-call:${call.name}:${call.argsKey}`,
        kind: 'repeated-call',
        category: SEARCH_TOOLS.has(call.name) ? 'memory' : 'tools',
        title: `${call.name} called ${String(call.count)}× with identical arguments — ${call.excerpt.slice(0, 70)}`,
        count: call.count,
        evidence: provenance(call.firstSeq, call.firstTime, call.excerpt, call.callId),
      })
    }

    for (const stat of Object.values(session.toolStats)) {
      if (stat.slowCount < 2) continue
      add({
        id: `slow-tool:${stat.name}`,
        kind: 'slow-tool',
        category: 'infra',
        title: `${stat.name} took ${(SLOW_TOOL_MS / 1000).toFixed(0)}s+ on ${String(stat.slowCount)} of ${String(stat.count)} calls (worst ${(stat.worstMs / 1000).toFixed(1)}s)`,
        count: stat.slowCount,
        evidence: provenance(
          0,
          session.lastEventAt,
          `${String(stat.slowCount)} slow of ${String(stat.count)} calls, worst ${(stat.worstMs / 1000).toFixed(1)}s, total ${(stat.totalMs / 1000).toFixed(1)}s`,
        ),
      })
    }

    for (const retry of session.retries) {
      add({
        id: `provider-retry:${retry.provider || 'unknown'}:${retry.code}`,
        kind: 'provider-retry',
        category: 'infra',
        title: `${retry.provider || 'unknown'} retried ${String(retry.count)}× (${retry.code}: ${retry.message})`,
        count: retry.count,
        evidence: provenance(0, session.lastEventAt, `${retry.code} ${retry.message}`),
      })
    }

    for (const job of session.failedJobs) {
      add({
        id: `job-failure:${job.kind}:${errorSignature(job.detail)}`,
        kind: 'job-failure',
        category: 'infra',
        title: `background job (${job.kind}) ended ${job.detail || 'unsuccessfully'}`,
        evidence: provenance(0, session.lastEventAt, `${job.label} → ${job.detail}`),
      })
    }

    for (const failure of session.jjFailures) {
      add({
        id: `jj-failure:${failure.subcommand}:${failure.error}`,
        kind: 'jj-failure',
        category: 'tools',
        title: `jj ${failure.subcommand} failed ${String(failure.count)}× — ${failure.excerpt}`,
        count: failure.count,
        evidence: provenance(failure.seq, session.lastEventAt, failure.excerpt),
      })
    }

    for (const [kind, count] of Object.entries(session.turnEnds)) {
      if (kind === 'stop' || kind === 'unknown') continue
      add({
        id: `turn-end:${kind}`,
        kind: 'turn-end',
        category: 'ux',
        title: `turn ended ${kind}`,
        count,
        evidence: provenance(0, session.lastEventAt, `${String(count)} turn(s) ended with ${kind}`),
      })
    }

    for (const prompt of session.prompts) {
      for (const theme of prompt.themes) {
        add({
          id: `correction:${theme}`,
          kind: 'correction',
          category: 'ux',
          title: `user pushback (${theme})`,
          evidence: provenance(prompt.seq, prompt.time, prompt.excerpt),
        })
      }
    }

    if (session.compactions >= 3) {
      add({
        id: 'compaction-pressure',
        kind: 'compaction-pressure',
        category: 'infra',
        title: `Session compacted ${String(session.compactions)}× (context pressure)`,
        count: session.compactions,
        evidence: provenance(
          0,
          session.lastEventAt,
          `${String(session.compactions)} compactions, ${String(session.turns)} turns, ${String(session.toolCallCount)} tool calls`,
        ),
      })
    }

    for (const [name, count] of Object.entries(session.skillLoads)) {
      if (count < 3) continue
      add({
        id: `redundant-skill-load:${name}`,
        kind: 'redundant-skill-load',
        category: 'skills',
        title: `skill \`${name}\` loaded ${String(count)}× in one Session`,
        count,
        evidence: provenance(0, session.lastEventAt, `${String(count)} loads of ${name}`),
      })
    }

    for (const [path, count] of Object.entries(session.fileEdits)) {
      add({
        id: `rework:${path}`,
        kind: 'rework',
        category: 'agent',
        title: `${path} edited ${String(count)}× in one Session`,
        count,
        evidence: provenance(0, session.lastEventAt, `${String(count)} edits to ${path}`),
      })
    }
  }

  return (
    [...drafts.entries()]
      // A file re-edited within one Session is ordinary iteration; the same file reworked across
      // Sessions is a pattern. Counting the first as a signal produced ~2 500 unusable findings.
      .filter(([, draft]) => (draft.kind === 'rework' ? draft.sessionIds.size >= 2 : draft.sessionIds.size >= 2 || draft.occurrences >= 3))
      .map(([id, draft]) => {
        const sessions = draft.sessionIds.size
        const ageDays = Math.max(0, (now - draft.lastSeen) / 86_400_000)
        const recency = Math.exp(-ageDays / 21)
        const recurrence = sessions >= 3 ? 1 : sessions / 3
        const recurring = sessions >= 3 || draft.occurrences >= 10
        const confidence: Signal['confidence'] = sessions >= 5 && draft.occurrences >= 10 ? 'high' : recurring ? 'medium' : 'low'
        return {
          id,
          kind: draft.kind,
          category: draft.category,
          title: draft.title,
          occurrences: draft.occurrences,
          sessions,
          recurring,
          confidence,
          severity: draft.severity,
          score: draft.occurrences * draft.severity * recurrence * recency,
          lastSeen: draft.lastSeen,
          sessionIds: [...draft.sessionIds].slice(0, 12),
          evidence: draft.evidence,
          hint: draft.hint,
        }
      })
      .sort((left, right) => right.score - left.score)
  )
}

export interface MineReport {
  readonly generatedAt: number
  readonly extractorVersion: number
  readonly scope: string
  readonly since: string
  readonly until: number
  readonly coverage: {
    readonly discovered: number
    readonly analyzed: number
    readonly reusedFromCache: number
    readonly skippedBySince: number
    readonly failed: number
    readonly projects: number
    readonly totalToolCalls: number
    readonly totalToolErrors: number
    readonly totalTurns: number
    readonly totalCorrections: number
  }
  readonly signals: readonly Signal[]
  readonly notes: readonly string[]
}

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|')

const renderMarkdown = (report: MineReport): string => {
  const lines: string[] = []
  lines.push('# Self-improve mining report', '')
  lines.push(`- generated: ${new Date(report.generatedAt).toISOString()}`)
  lines.push(`- scope \`${report.scope}\`, since \`${report.since}\``)
  lines.push(
    `- Sessions discovered ${String(report.coverage.discovered)}, analyzed ${String(report.coverage.analyzed)} (${String(report.coverage.reusedFromCache)} reused from cache), skipped by window ${String(report.coverage.skippedBySince)}, unreadable ${String(report.coverage.failed)}`,
  )
  lines.push(
    `- projects ${String(report.coverage.projects)}, tool calls ${String(report.coverage.totalToolCalls)}, tool errors ${String(report.coverage.totalToolErrors)}, turns ${String(report.coverage.totalTurns)}, corrective prompts ${String(report.coverage.totalCorrections)}`,
    '',
  )
  lines.push('Signals are candidates for investigation, not diagnosed problems. Open the named Sessions before proposing a fix.', '')
  lines.push('| # | score | kind | cat | sessions | hits | conf | last seen | signal |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  report.signals.forEach((signal, index) => {
    lines.push(
      `| ${String(index + 1)} | ${signal.score.toFixed(1)} | ${signal.kind} | ${signal.category} | ${String(signal.sessions)} | ${String(signal.occurrences)} | ${signal.confidence} | ${new Date(signal.lastSeen).toISOString().slice(0, 10)} | ${escapeCell(signal.title)} |`,
    )
  })
  lines.push('')
  for (const signal of report.signals) {
    lines.push(`### ${signal.id}`, '')
    lines.push(`- ${signal.recurring ? 'recurring' : 'isolated'} · ${signal.category} · ${signal.confidence} confidence · score ${signal.score.toFixed(1)}`)
    lines.push(`- ${signal.hint}`)
    lines.push(`- sessions: ${signal.sessionIds.map(id => `\`${id}\``).join(', ')}`)
    for (const entry of signal.evidence)
      lines.push(`  - \`${entry.sessionId}#${String(entry.seq)}\` ${new Date(entry.time).toISOString()} — ${escapeCell(entry.excerpt)}`)
    lines.push('')
  }
  if (report.notes.length > 0) {
    lines.push('## Notes', '')
    for (const note of report.notes) lines.push(`- ${note}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Mining DSH Session logs into bounded, cross-Session behavioural signals: the
 * per-Session extractor, the cross-Session aggregation and ranking, and the
 * helpers the report and the tests share.
 */
export class SessionMiner {
  static readonly EXTRACTOR_VERSION = EXTRACTOR_VERSION
  static readonly SEARCH_TOOLS = SEARCH_TOOLS
  static readonly factsSchema = sessionFactsSchema
  static readonly extract = extractSession
  static readonly aggregate = aggregateSignals
  static readonly render = renderMarkdown
  static readonly redact = redact
  static readonly excerptOf = excerptOf
  static readonly errorSignature = errorSignature
  static readonly callKeys = callKeys
  static readonly correctionThemes = correctionThemes
  static readonly digest = digest
}
