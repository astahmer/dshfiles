import { z } from 'zod'
import type { JsonValue, SessionSummary } from './client.js'

const eventRecordSchema = z.object({
  type: z.literal('event'),
  event: z.object({
    type: z.string(),
    seq: z.number(),
    time: z.number().optional(),
    data: z.unknown().optional(),
  }),
})

const textPartsSchema = z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
const toolCallSchema = z.object({ name: z.string(), callId: z.string(), arguments: z.string().optional() })
const toolResultSchema = z.object({
  message: z.object({ toolCallId: z.string(), isError: z.boolean().optional(), content: textPartsSchema }),
})
const assistantMessageSchema = z.object({ message: z.object({ content: textPartsSchema }) })
const userMessageSchema = z.object({ content: textPartsSchema, source: z.object({ kind: z.string() }).passthrough().optional() })
const todoListSchema = z.array(z.object({ content: z.string(), status: z.string() }))
const goalSchema = z.object({ objective: z.string(), phase: z.string().optional() })
const goalChangeSchema = z.object({ operation: z.string().optional(), goal: goalSchema.optional() })
const failureSchema = z.object({ message: z.string(), code: z.string().optional() })
const turnEndSchema = z.object({ turn: z.number().optional(), reason: z.object({ kind: z.string(), error: failureSchema.optional() }) })
const retrySchema = z.object({ retry: z.number().optional(), maxRetries: z.number().optional(), failure: failureSchema })
const subagentCatalogSchema = z.object({ childId: z.string(), label: z.string().optional() })
const modelSelectionSchema = z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() })
const titleSchema = z.object({ title: z.string() })
const tokenUsageSchema = z.object({
  uncachedInputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
})
const projectionValuesSchema = z
  .object({
    values: z
      .object({
        title: z.string().nullish(),
        goal: z.object({ goal: goalSchema }).nullish(),
        todos: todoListSchema.nullish(),
        tokenUsage: tokenUsageSchema.nullish(),
        contextPressure: z.object({ projectedTokens: z.number(), contextWindow: z.number() }).nullish(),
        sessionStats: z.object({ turns: z.number(), steps: z.number() }).nullish(),
        modelSelection: z.object({ lastUsed: modelSelectionSchema.nullish() }).nullish(),
      })
      .partial(),
  })
  .partial()

type SessionEvent = z.infer<typeof eventRecordSchema>['event']

/** Event types `tail` hides unless `--types` asks for them: per-step bookkeeping and request plumbing. */
const noiseEventTypes = new Set([
  'step/start',
  'step/end',
  'request/header',
  'request/context',
  'system/message',
  'compaction/prune',
  'session/title-llm-request',
  'assistant/attempt',
  'llm/retry-started',
  'workspace/changes',
  'agent/inbox/spliced',
  'session-log-deepseek/delivery-accepted',
])

/** Context the Host injects as user messages; not something a person or agent said. */
const injectedMessageKinds = new Set(['runtime-context', 'skill-catalog', 'compact-checkpoint'])

const fileTools = new Set(['edit', 'write', 'multiedit', 'multi_edit', 'apply_patch', 'read', 'notebook_edit'])
const mutatingFileTools = new Set(['edit', 'write', 'multiedit', 'multi_edit', 'apply_patch', 'notebook_edit'])
const shellTools = new Set(['bash', 'shell', 'exec'])

export interface SessionDigestAction {
  readonly seq: number
  readonly time?: number
  readonly tool: string
  readonly summary: string
  readonly status: 'ok' | 'error' | 'pending'
  readonly error?: string
}

export interface SessionDigest {
  readonly sessionId: string
  readonly title?: string
  readonly running: boolean
  readonly cwd?: string
  readonly model?: string
  readonly lastSeq?: number
  readonly lastEventAt?: number
  readonly idleMs?: number
  readonly eventCount: number
  readonly turns?: number
  readonly steps?: number
  readonly compactions: number
  readonly lastTurnEnd?: { readonly seq: number; readonly kind: string; readonly error?: string }
  readonly attention: readonly string[]
  readonly goal?: { readonly objective: string; readonly phase?: string | undefined }
  readonly todos: readonly { readonly content: string; readonly status: string }[]
  readonly intents: readonly string[]
  readonly lastUserPrompt?: { readonly seq: number; readonly time?: number; readonly text: string }
  readonly lastAgentMessage?: { readonly seq: number; readonly time?: number; readonly from: string; readonly text: string }
  readonly lastAssistantText?: { readonly seq: number; readonly time?: number; readonly text: string }
  readonly actions: readonly SessionDigestAction[]
  readonly toolCallCount: number
  readonly workDirectories: readonly { readonly path: string; readonly calls: number }[]
  readonly filesChanged: readonly { readonly path: string; readonly edits: number; readonly lastSeq: number }[]
  readonly revisions: readonly { readonly seq: number; readonly command: string; readonly message?: string; readonly status: 'ok' | 'error' | 'pending' }[]
  /** File edits after the last successful `jj describe`/`commit`/`squash`/`new -m`: work not yet recorded in a described revision. */
  readonly undescribedEdits: { readonly sinceSeq?: number; readonly edits: number; readonly files: number }
  readonly failures: {
    readonly toolErrors: number
    readonly retries: number
    readonly failedTurns: number
    readonly recent: readonly { readonly seq: number; readonly summary: string; readonly error: string }[]
  }
  readonly tokens?: {
    readonly input: number
    readonly cachedInput: number
    readonly output: number
    readonly contextTokens?: number
    readonly contextWindow?: number
  }
  readonly subagents: readonly { readonly id: string; readonly label?: string }[]
}

/**
 * One digest input: an exported record as the platform API returns it, or an event a Host plugin read through DSH's
 * session query service. Both are decoded by the same schema.
 */
export type SessionDigestRecord =
  | JsonValue
  | { readonly type: 'event'; readonly event: { readonly type: string; readonly seq: number; readonly time?: number | undefined; readonly data?: unknown } }

const decodeEvent = (record: SessionDigestRecord): SessionEvent | undefined => {
  const parsed = eventRecordSchema.safeParse(record)
  return parsed.success ? parsed.data.event : undefined
}

const oneLine = (value: string, max: number): string => {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const homeRelative = (text: string): string => text.replace(/(?<![\w./-])\/(?:Users|home)\/[^/\s"']+(?=[/\s"']|$)/g, '~')

const joinPath = (base: string, path: string): string => (path.startsWith('/') ? path : `${base.replace(/\/$/, '')}/${path.replace(/^\.\//, '')}`)

const parseArguments = (value: string | undefined): Readonly<Record<string, unknown>> => {
  if (value === undefined) return {}
  try {
    const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

const stringArgument = (args: Readonly<Record<string, unknown>>, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = args[name]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

const textOf = (parts: z.infer<typeof textPartsSchema>, type = 'text'): string =>
  parts
    .filter(part => part.type === type)
    .map(part => part.text ?? '')
    .join('\n')

const reasoningHeadlines = (text: string): string[] => [
  ...new Set([...text.matchAll(/\*\*([^*\n]+)\*\*/g)].flatMap(match => (match[1] === undefined ? [] : [match[1].trim()]))),
]

/** The directory a shell command runs in: its `workdir` argument, or a leading `cd <dir> &&`. */
const shellDirectory = (args: Readonly<Record<string, unknown>>): string | undefined => {
  const workdir = stringArgument(args, 'workdir', 'cwd')
  if (workdir !== undefined) return workdir
  const command = stringArgument(args, 'command')
  const leadingCd = command?.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/)?.[1]
  return leadingCd?.replace(/^["']|["']$/g, '')
}

const shellFailure = (text: string): string | undefined => {
  const exitCode = text.trimEnd().match(/\[(?:status: \w+, )?exit code: (\d+)\]$/)?.[1]
  return exitCode !== undefined && exitCode !== '0' ? `exit ${exitCode}` : undefined
}

/** The one line of a tool result worth showing: a tool error's message, a failed command's error line, or a success's last line. */
const resultHeadline = (text: string, outcome: 'ok' | 'tool-error' | 'shell-failure'): string => {
  const lines = text
    .split('\n')
    .filter(line => line.trim().length > 0 && !/^\s*(<\/?[\w-]+>|\[(stderr|stdout)\]|\[(status: \w+, )?exit code: \d+\])\s*$/.test(line))
  if (outcome === 'tool-error') return (lines[0] ?? '').replace(/^Error:\s*/, '')
  if (outcome === 'ok') return lines.at(-1) ?? ''
  return lines.find(line => /(\w*Error\b|\berror:|\bfailed\b|\bFAIL\b|^not ok)/.test(line)) ?? lines.at(-1) ?? ''
}

const vcsCommandPattern =
  /\bjj\s+(describe|desc|commit|new|squash|git\s+push|bookmark\s+(?:set|move|create)|abandon|rebase)\b((?:\$'(?:[^'\\]|\\.)*'|'[^']*'|"(?:[^"\\]|\\.)*"|[^;&|\n'"])*)/g

const vcsMessage = (rest: string): string | undefined => {
  const quoted = rest.match(/(?:^|\s)(?:-m|--message)[\s=]*(\$'(?:[^'\\]|\\.)*'|'[^']*'|"(?:[^"\\]|\\.)*")/)?.[1]
  if (quoted === undefined) return undefined
  const body = quoted.startsWith('$') ? quoted.slice(2, -1).replace(/\\n/g, '\n').replace(/\\(.)/g, '$1') : quoted.slice(1, -1).replace(/\\(.)/g, '$1')
  return body.split('\n')[0]?.trim()
}

/** A one-line description of one tool call, keyed on the argument a supervisor needs to see. */
const describeToolCall = (name: string, args: Readonly<Record<string, unknown>>, display: (path: string) => string, workRoot?: string): string => {
  if (shellTools.has(name)) {
    const command = (stringArgument(args, 'command', 'cmd') ?? '').replace(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)\s*/, '')
    const background = args.run_in_background === true ? ' (background)' : ''
    const directory = shellDirectory(args)
    const elsewhere = directory !== undefined && directory.replace(/\/$/, '') !== workRoot?.replace(/\/$/, '') ? ` [in ${homeRelative(directory)}]` : ''
    return `${name}${background}${elsewhere}: ${oneLine(command, 110)}`
  }
  const path = stringArgument(args, 'file_path', 'path', 'filePath')
  if (fileTools.has(name) && path !== undefined) return `${name} ${display(path)}`
  if (name === 'grep') return `grep ${JSON.stringify(oneLine(stringArgument(args, 'pattern') ?? '', 50))}${path === undefined ? '' : ` in ${display(path)}`}`
  if (name === 'glob') return `glob ${stringArgument(args, 'pattern') ?? ''}${path === undefined ? '' : ` in ${display(path)}`}`
  if (name === 'todo_write') return `todo_write (${Array.isArray(args.todos) ? args.todos.length : 0} items)`
  const text = stringArgument(args, 'objective', 'description', 'message', 'text', 'prompt', 'name', 'job_id', 'query', 'sessionId', 'url')
  if (text !== undefined) {
    const target = stringArgument(args, 'agent_id', 'toAgentId')
    return `${name}${target === undefined ? '' : ` → ${target.slice(0, 16)}`}: ${oneLine(text, 100)}`
  }
  const compact = JSON.stringify(args)
  return compact === '{}' ? name : `${name} ${oneLine(compact, 100)}`
}

/** Returns a describer that remembers tool calls so later results can name them. */
const createSessionEventDescriber = (): ((
  record: JsonValue,
) => { readonly seq: number; readonly time?: number; readonly type: string; readonly summary: string } | undefined) => {
  const calls = new Map<string, { readonly name: string; readonly time?: number }>()
  return record => {
    const event = decodeEvent(record)
    if (event === undefined) return undefined
    const base = { seq: event.seq, ...(event.time !== undefined && { time: event.time }), type: event.type }
    const describe = (): string => {
      const data = event.data
      if (event.type === 'tool/call') {
        const call = toolCallSchema.safeParse(data)
        if (!call.success) return ''
        calls.set(call.data.callId, { name: call.data.name, ...(event.time !== undefined && { time: event.time }) })
        return describeToolCall(call.data.name, parseArguments(call.data.arguments), homeRelative)
      }
      if (event.type === 'tool/result') {
        const result = toolResultSchema.safeParse(data)
        if (!result.success) return ''
        const call = calls.get(result.data.message.toolCallId)
        const text = textOf(result.data.message.content)
        const failure = result.data.message.isError === true ? 'ERR' : shellFailure(text) === undefined ? 'ok' : `ERR ${shellFailure(text)}`
        const elapsed = call?.time !== undefined && event.time !== undefined ? ` ${((event.time - call.time) / 1000).toFixed(1)}s` : ''
        const headline = resultHeadline(text, result.data.message.isError === true ? 'tool-error' : failure === 'ok' ? 'ok' : 'shell-failure')
        return `↳ ${call?.name ?? 'tool'} ${failure}${elapsed}${headline === '' ? '' : `: ${oneLine(homeRelative(headline), 110)}`}`
      }
      if (event.type === 'assistant/message') {
        const message = assistantMessageSchema.safeParse(data)
        if (!message.success) return ''
        const text = textOf(message.data.message.content).trim()
        if (text.length > 0) return `says: ${oneLine(text, 140)}`
        const headlines = reasoningHeadlines(textOf(message.data.message.content, 'reasoning'))
        const toolCalls = message.data.message.content.filter(part => part.type === 'tool-call').length
        return `${headlines.length > 0 ? `thinks: ${oneLine(headlines.join(' · '), 110)}` : 'thinks'}${toolCalls > 0 ? ` → ${toolCalls} tool call${toolCalls === 1 ? '' : 's'}` : ''}`
      }
      if (event.type === 'user/message') {
        const message = userMessageSchema.safeParse(data)
        if (!message.success) return ''
        return `${message.data.source?.kind ?? 'user'}: ${oneLine(textOf(message.data.content), 140)}`
      }
      if (event.type === 'todo/write') {
        const todos = z.object({ todos: todoListSchema }).safeParse(data)
        if (!todos.success) return ''
        const active = todos.data.todos.find(todo => todo.status === 'in_progress')
        const done = todos.data.todos.filter(todo => todo.status === 'completed').length
        return `${done}/${todos.data.todos.length} done${active === undefined ? '' : `; now: ${oneLine(active.content, 100)}`}`
      }
      if (event.type === 'goal/change') {
        const change = goalChangeSchema.safeParse(data)
        if (!change.success || change.data.goal === undefined) return ''
        return `${change.data.operation ?? 'change'} [${change.data.goal.phase ?? '?'}]: ${oneLine(change.data.goal.objective, 120)}`
      }
      if (event.type === 'turn/start') return `turn ${z.object({ turn: z.number() }).safeParse(data).data?.turn ?? '?'}`
      if (event.type === 'turn/end') {
        const end = turnEndSchema.safeParse(data)
        if (!end.success) return ''
        return `turn ${end.data.turn ?? '?'} ${end.data.reason.kind}${end.data.reason.error === undefined ? '' : `: ${oneLine(end.data.reason.error.message, 120)}`}`
      }
      if (event.type === 'llm/retry') {
        const retry = retrySchema.safeParse(data)
        return retry.success ? `retry ${retry.data.retry ?? '?'}/${retry.data.maxRetries ?? '?'}: ${oneLine(retry.data.failure.message, 110)}` : ''
      }
      if (event.type === 'session/title') return titleSchema.safeParse(data).data?.title ?? ''
      if (event.type === 'model/selection') {
        const model = modelSelectionSchema.safeParse(data)
        return model.success
          ? `${model.data.provider}/${model.data.model}${model.data.reasoningEffort === undefined ? '' : ` ${model.data.reasoningEffort}`}`
          : ''
      }
      if (event.type === 'compaction/summary') return 'context compacted'
      if (event.type === 'subagent/catalog') {
        const child = subagentCatalogSchema.safeParse(data)
        return child.success ? `${child.data.label ?? 'subagent'} (${child.data.childId})` : ''
      }
      const compact = data === undefined ? '' : JSON.stringify(data)
      return oneLine(compact, 120)
    }
    return { ...base, summary: describe() }
  }
}

/** Keeps records matching the requested types (exact or `prefix/…`); without types, keeps everything except bookkeeping noise. */
const sessionEventFilter =
  (types: readonly string[] | undefined): ((record: JsonValue) => boolean) =>
  record => {
    const event = decodeEvent(record)
    if (event === undefined) return types === undefined
    if (types === undefined) return true
    return types.some(type => event.type === type || event.type.startsWith(`${type}/`))
  }

const isNoiseSessionEvent = (record: JsonValue): boolean => {
  const event = decodeEvent(record)
  if (event === undefined) return false
  if (noiseEventTypes.has(event.type)) return true
  const kind = event.type === 'user/message' ? userMessageSchema.safeParse(event.data).data?.source?.kind : undefined
  return kind !== undefined && injectedMessageKinds.has(kind)
}

const mostFrequent = (counts: ReadonlyMap<string, number>): string | undefined =>
  [...counts.entries()].reduce<[string, number] | undefined>((best, entry) => (best === undefined || entry[1] > best[1] ? entry : best), undefined)?.[0]

/** Folds a Session's event history into what a supervisor needs: state, plan, recent actions, changes, and failures. */
export const digestSession = (input: {
  readonly summary: SessionSummary
  readonly records: readonly SessionDigestRecord[]
  readonly now: number
  readonly actionLimit?: number
}): SessionDigest => {
  const events = input.records.flatMap(record => {
    const event = decodeEvent(record)
    return event === undefined ? [] : [event]
  })
  const projections = projectionValuesSchema.safeParse(input.summary.projections).data?.values ?? {}
  const cwd = input.summary.cwd

  const directoryCounts = new Map<string, number>()
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const call = toolCallSchema.safeParse(event.data)
    if (!call.success || !shellTools.has(call.data.name)) continue
    const directory = shellDirectory(parseArguments(call.data.arguments))
    if (directory !== undefined) {
      const absolute = cwd === undefined ? directory : joinPath(cwd, directory)
      directoryCounts.set(absolute, (directoryCounts.get(absolute) ?? 0) + 1)
    }
  }
  const workRoot = mostFrequent(directoryCounts) ?? cwd
  const display = (path: string): string => {
    const absolute = cwd === undefined ? path : joinPath(cwd, path)
    if (workRoot !== undefined && absolute.startsWith(`${workRoot.replace(/\/$/, '')}/`)) return absolute.slice(workRoot.replace(/\/$/, '').length + 1)
    return homeRelative(absolute)
  }

  const stripRoot = (text: string): string => homeRelative(workRoot === undefined ? text : text.replaceAll(`${workRoot.replace(/\/$/, '')}/`, ''))

  const results = new Map<string, { readonly isError: boolean; readonly text: string }>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const result = toolResultSchema.safeParse(event.data)
    if (result.success)
      results.set(result.data.message.toolCallId, { isError: result.data.message.isError === true, text: textOf(result.data.message.content) })
  }

  const actions: (SessionDigestAction & { readonly callKey: string })[] = []
  const files = new Map<string, { edits: number; lastSeq: number }>()
  const revisions: SessionDigest['revisions'][number][] = []
  let goal: SessionDigest['goal']
  let todos: SessionDigest['todos'] = []
  const intents: string[] = []
  let lastUserPrompt: SessionDigest['lastUserPrompt']
  let lastAgentMessage: SessionDigest['lastAgentMessage']
  let lastAssistantText: SessionDigest['lastAssistantText']
  let lastTurnEnd: SessionDigest['lastTurnEnd']
  let title: string | undefined
  let model: string | undefined
  let compactions = 0
  let retries = 0
  let failedTurns = 0
  const subagents = new Map<string, string | undefined>()
  const at = (event: SessionEvent) => ({
    seq: event.seq,
    ...(event.time !== undefined && { time: event.time }),
  })

  for (const event of events) {
    const data = event.data
    if (event.type === 'tool/call') {
      const call = toolCallSchema.safeParse(data)
      if (!call.success) continue
      const args = parseArguments(call.data.arguments)
      const result = results.get(call.data.callId)
      const exit = result === undefined || result.isError ? undefined : shellFailure(result.text)
      let failure: string | undefined
      if (result?.isError) failure = oneLine(stripRoot(resultHeadline(result.text, 'tool-error')), 160)
      else if (result !== undefined && exit !== undefined) failure = oneLine(`${exit}: ${stripRoot(resultHeadline(result.text, 'shell-failure'))}`, 160)
      const status = result === undefined ? 'pending' : failure === undefined ? 'ok' : 'error'
      actions.push({
        ...at(event),
        callKey: `${call.data.name} ${call.data.arguments ?? ''}`,
        tool: call.data.name,
        summary: describeToolCall(call.data.name, args, display, workRoot),
        status,
        ...(failure !== undefined && { error: failure }),
      })
      const path = stringArgument(args, 'file_path', 'path', 'filePath')
      if (mutatingFileTools.has(call.data.name) && path !== undefined && status !== 'error') {
        const key = display(path)
        files.set(key, { edits: (files.get(key)?.edits ?? 0) + 1, lastSeq: event.seq })
      }
      const command = shellTools.has(call.data.name) ? stringArgument(args, 'command') : undefined
      for (const match of command?.matchAll(vcsCommandPattern) ?? []) {
        const message = vcsMessage(match[2] ?? '')
        revisions.push({ seq: event.seq, command: `jj ${(match[1] ?? '').replace(/\s+/g, ' ')}`, ...(message !== undefined && { message }), status })
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const message = assistantMessageSchema.safeParse(data)
      if (!message.success) continue
      const text = textOf(message.data.message.content).trim()
      if (text.length > 0) lastAssistantText = { ...at(event), text }
      for (const headline of reasoningHeadlines(textOf(message.data.message.content, 'reasoning'))) {
        if (intents.at(-1) !== headline) intents.push(headline)
      }
      continue
    }
    if (event.type === 'user/message') {
      const message = userMessageSchema.safeParse(data)
      if (!message.success) continue
      const kind = message.data.source?.kind ?? 'user'
      const text = textOf(message.data.content).trim()
      if (kind === 'user') lastUserPrompt = { ...at(event), text }
      if (kind === 'agent-message' || kind === 'subagent-settled') lastAgentMessage = { ...at(event), from: kind, text }
      continue
    }
    if (event.type === 'todo/write') {
      const parsed = z.object({ todos: todoListSchema }).safeParse(data)
      if (parsed.success) todos = parsed.data.todos
      continue
    }
    if (event.type === 'goal/change') {
      const parsed = goalChangeSchema.safeParse(data)
      if (parsed.success && parsed.data.goal !== undefined) goal = parsed.data.goal
      continue
    }
    if (event.type === 'turn/end') {
      const parsed = turnEndSchema.safeParse(data)
      if (!parsed.success) continue
      if (parsed.data.reason.kind === 'error') failedTurns += 1
      lastTurnEnd = {
        seq: event.seq,
        kind: parsed.data.reason.kind,
        ...(parsed.data.reason.error !== undefined && { error: parsed.data.reason.error.message }),
      }
      continue
    }
    if (event.type === 'turn/start') {
      lastTurnEnd = undefined
      continue
    }
    if (event.type === 'llm/retry') retries += 1
    if (event.type === 'compaction/start') compactions += 1
    if (event.type === 'session/title') title = titleSchema.safeParse(data).data?.title ?? title
    if (event.type === 'model/selection') {
      const parsed = modelSelectionSchema.safeParse(data)
      if (parsed.success)
        model = `${parsed.data.provider}/${parsed.data.model}${parsed.data.reasoningEffort === undefined ? '' : ` (${parsed.data.reasoningEffort})`}`
    }
    if (event.type === 'subagent/catalog') {
      const parsed = subagentCatalogSchema.safeParse(data)
      if (parsed.success) subagents.set(parsed.data.childId, parsed.data.label)
    }
  }

  const lastModel = projections.modelSelection?.lastUsed
  const lastEvent = events.at(-1)
  const lastEventAt = events.reduce<number | undefined>(
    (latest, event) => (event.time !== undefined && (latest === undefined || event.time > latest) ? event.time : latest),
    undefined,
  )
  const idleMs = lastEventAt === undefined ? undefined : Math.max(0, input.now - lastEventAt)
  const failedActions = actions.filter(action => action.status === 'error')
  const lastDescribe = revisions.findLast(
    revision =>
      revision.status === 'ok' && (/describe|desc|commit|squash/.test(revision.command) || (revision.command === 'jj new' && revision.message !== undefined)),
  )
  const editsAfterDescribe = actions.filter(
    action => mutatingFileTools.has(action.tool) && action.status !== 'error' && (lastDescribe === undefined || action.seq > lastDescribe.seq),
  )
  const pending = actions.filter(action => action.status === 'pending')

  const attention: string[] = []
  const minutes = (ms: number): string => (ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)}h` : `${Math.round(ms / 60_000)}m`)
  for (const action of pending) {
    if (input.summary.running && action.time !== undefined && input.now - action.time > 120_000)
      attention.push(`waiting ${minutes(input.now - action.time)} on #${action.seq} ${action.summary}`)
  }
  if (input.summary.running && idleMs !== undefined && idleMs > 600_000 && pending.length === 0) attention.push(`running but no events for ${minutes(idleMs)}`)
  if (lastTurnEnd?.kind === 'error') attention.push(`last turn failed: ${oneLine(lastTurnEnd.error ?? 'unknown error', 160)}`)
  const trailingFailures = actions.length - 1 - actions.findLastIndex(action => action.status !== 'error')
  if (trailingFailures >= 3) attention.push(`last ${trailingFailures} tool calls failed`)
  const recentActions = actions.slice(-12)
  const repeated = recentActions.find(
    action => !/^(bash \(background\): sleep|job_output)/.test(action.summary) && recentActions.filter(item => item.callKey === action.callKey).length >= 3,
  )
  if (repeated !== undefined)
    attention.push(
      `repeating identical call: ${repeated.summary} (×${recentActions.filter(item => item.callKey === repeated.callKey).length} in last 12 calls)`,
    )
  const lastCallSeq = actions.at(-1)?.seq ?? -1
  const turnsWithoutTools = events.filter(event => event.type === 'turn/start' && event.seq > lastCallSeq).length
  if (turnsWithoutTools >= 3)
    attention.push(
      `${turnsWithoutTools} turns since the last tool call (#${lastCallSeq})${lastAssistantText === undefined ? '' : `; latest reply: ${oneLine(lastAssistantText.text, 80)}`}`,
    )
  const projectedTodos = projections.todos ?? todos
  if (!input.summary.running && lastTurnEnd?.kind !== 'error' && projectedTodos.some(todo => todo.status !== 'completed'))
    attention.push(`idle with ${projectedTodos.filter(todo => todo.status !== 'completed').length} open todos`)

  const tokenUsage = projections.tokenUsage
  const pressure = projections.contextPressure
  const projectedTitle = projections.title ?? title
  const projectedGoal = projections.goal?.goal ?? goal

  return {
    sessionId: input.summary.sessionId,
    ...(!(projectedTitle === undefined || projectedTitle === null) && { title: projectedTitle }),
    running: input.summary.running,
    ...(cwd !== undefined && { cwd }),
    ...(lastModel === undefined || lastModel === null
      ? model === undefined
        ? {}
        : { model }
      : { model: `${lastModel.provider}/${lastModel.model}${lastModel.reasoningEffort === undefined ? '' : ` (${lastModel.reasoningEffort})`}` }),
    ...(lastEvent !== undefined && { lastSeq: lastEvent.seq }),
    ...(lastEventAt !== undefined && { lastEventAt }),
    ...(idleMs !== undefined && { idleMs }),
    eventCount: events.length,
    ...(!(projections.sessionStats === undefined || projections.sessionStats === null) && {
      turns: projections.sessionStats.turns,
      steps: projections.sessionStats.steps,
    }),
    compactions,
    ...(lastTurnEnd !== undefined && { lastTurnEnd }),
    attention,
    ...(projectedGoal !== undefined && { goal: projectedGoal }),
    todos: projectedTodos,
    intents: intents.slice(-4),
    ...(lastUserPrompt !== undefined && { lastUserPrompt }),
    ...(lastAgentMessage !== undefined && { lastAgentMessage }),
    ...(lastAssistantText !== undefined && { lastAssistantText }),
    actions: actions.slice(-(input.actionLimit ?? 15)).map(({ callKey: _callKey, ...action }) => action),
    toolCallCount: actions.length,
    workDirectories: [...directoryCounts.entries()].sort((left, right) => right[1] - left[1]).map(([path, calls]) => ({ path, calls })),
    filesChanged: [...files.entries()].sort((left, right) => right[1].lastSeq - left[1].lastSeq).map(([path, value]) => ({ path, ...value })),
    revisions,
    undescribedEdits: {
      ...(lastDescribe !== undefined && { sinceSeq: lastDescribe.seq }),
      edits: editsAfterDescribe.length,
      files: new Set(editsAfterDescribe.map(action => action.summary)).size,
    },
    failures: {
      toolErrors: failedActions.length,
      retries,
      failedTurns,
      recent: failedActions.slice(-5).map(action => ({ seq: action.seq, summary: action.summary, error: action.error ?? 'failed' })),
    },
    ...(!(tokenUsage === undefined || tokenUsage === null) && {
      tokens: {
        input: tokenUsage.uncachedInputTokens,
        cachedInput: tokenUsage.cacheReadTokens ?? 0,
        output: tokenUsage.outputTokens,
        ...(!(pressure === undefined || pressure === null) && { contextTokens: pressure.projectedTokens, contextWindow: pressure.contextWindow }),
      },
    }),
    subagents: [...subagents.entries()].map(([id, label]) => ({ id, ...(label !== undefined && { label }) })),
  }
}

const formatCount = (value: number): string =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : String(value)

const formatAge = (ms: number): string => {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

const formatEventClock = (time: number | undefined): string => {
  if (time === undefined) return '--:--:--'
  const date = new Date(time)
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, '0')).join(':')
}

const TODO_MARKS: ReadonlyMap<string, string> = new Map([
  ['completed', 'x'],
  ['in_progress', '>'],
  ['pending', ' '],
  ['cancelled', '-'],
])

/** Renders a digest for a terminal; aims to answer "what is it doing, is it stuck, what changed" in about 60 lines. */
const renderSessionDigest = (digest: SessionDigest, now: number): string => {
  const lines: string[] = []
  const ago = (time: number | undefined): string => (time === undefined ? '' : `, ${formatAge(now - time)} ago`)
  lines.push(`${digest.sessionId}${digest.title === undefined ? '' : ` · ${digest.title}`}`)
  lines.push(
    `State: ${digest.running ? 'RUNNING' : 'idle'}${digest.idleMs === undefined ? '' : ` · last event ${formatAge(digest.idleMs)} ago`} (seq ${digest.lastSeq ?? '-'}, ${digest.eventCount} events)${digest.model === undefined ? '' : ` · ${digest.model}`}`,
  )
  const activity = [
    digest.turns === undefined ? undefined : `${digest.turns} turn${digest.turns === 1 ? '' : 's'}`,
    digest.steps === undefined ? undefined : `${digest.steps} steps`,
    `${digest.toolCallCount} tool calls`,
    `${digest.compactions} compactions`,
    digest.tokens === undefined
      ? undefined
      : `tokens in ${formatCount(digest.tokens.input)} (+${formatCount(digest.tokens.cachedInput)} cached) out ${formatCount(digest.tokens.output)}`,
    digest.tokens?.contextTokens === undefined || digest.tokens.contextTokens === 0 || digest.tokens.contextWindow === undefined
      ? undefined
      : `context ${formatCount(digest.tokens.contextTokens)}/${formatCount(digest.tokens.contextWindow)}`,
  ].filter(item => item !== undefined)
  lines.push(`Activity: ${activity.join(' · ')}`)
  if (digest.lastTurnEnd !== undefined)
    lines.push(
      `Last turn: ${digest.lastTurnEnd.kind}${digest.lastTurnEnd.error === undefined ? '' : ` — ${oneLine(digest.lastTurnEnd.error, 140)}`} (#${digest.lastTurnEnd.seq})`,
    )
  lines.push(digest.attention.length === 0 ? 'Attention: none' : 'Attention:')
  for (const item of digest.attention) lines.push(`  ! ${item}`)
  const elsewhere = digest.workDirectories.filter(item => item.path.replace(/\/$/, '') !== digest.cwd?.replace(/\/$/, ''))
  const workDirectories = elsewhere.slice(0, 3).map(item => `${homeRelative(item.path)} (${item.calls} calls)`)
  lines.push(
    `Cwd: ${digest.cwd === undefined ? '-' : homeRelative(digest.cwd)}${workDirectories.length === 0 ? '' : ` · but shell runs in: ${workDirectories.join(', ')}`}`,
  )
  if (digest.goal !== undefined) lines.push(`Goal [${digest.goal.phase ?? '?'}]: ${oneLine(digest.goal.objective, 240)}`)
  if (digest.todos.length > 0) {
    lines.push(`Todos (${digest.todos.filter(todo => todo.status === 'completed').length}/${digest.todos.length} done):`)
    for (const todo of digest.todos.slice(0, 10)) lines.push(`  [${TODO_MARKS.get(todo.status) ?? '?'}] ${oneLine(todo.content, 110)}`)
  }
  if (digest.intents.length > 0) lines.push(`Thinking: ${oneLine(digest.intents.join(' · '), 160)}`)
  if (digest.lastUserPrompt !== undefined)
    lines.push(`Last user prompt (#${digest.lastUserPrompt.seq}${ago(digest.lastUserPrompt.time)}): ${oneLine(digest.lastUserPrompt.text, 160)}`)
  if (digest.lastAgentMessage !== undefined)
    lines.push(
      `Last ${digest.lastAgentMessage.from} (#${digest.lastAgentMessage.seq}${ago(digest.lastAgentMessage.time)}): ${oneLine(digest.lastAgentMessage.text, 160)}`,
    )
  lines.push(
    digest.lastAssistantText === undefined
      ? 'Last assistant text: (none)'
      : `Last assistant text (#${digest.lastAssistantText.seq}${ago(digest.lastAssistantText.time)}): ${oneLine(digest.lastAssistantText.text, 240)}`,
  )
  lines.push(`Recent actions (${digest.actions.length} of ${digest.toolCallCount}):`)
  for (const action of digest.actions) {
    const mark = action.status === 'ok' ? 'ok ' : action.status === 'error' ? 'ERR' : '...'
    lines.push(
      `  ${formatEventClock(action.time)} #${action.seq} ${mark} ${action.summary}${action.error === undefined ? '' : ` → ${oneLine(action.error, 80)}`}`,
    )
  }
  if (digest.filesChanged.length > 0) {
    const shown = digest.filesChanged.slice(0, 20)
    const directories = new Map<string, string[]>()
    for (const file of shown) {
      const slash = file.path.lastIndexOf('/')
      const directory = slash === -1 ? '.' : file.path.slice(0, slash)
      directories.set(directory, [...(directories.get(directory) ?? []), `${file.path.slice(slash + 1)}${file.edits > 1 ? ` ×${file.edits}` : ''}`])
    }
    const total = digest.filesChanged.reduce((sum, file) => sum + file.edits, 0)
    lines.push(
      `Files changed (${digest.filesChanged.length} files, ${total} edits; newest first${digest.filesChanged.length > shown.length ? `, ${shown.length} shown` : ''}):`,
    )
    for (const [directory, names] of directories) lines.push(`  ${directory}/: ${names.join(', ')}`)
  } else lines.push('Files changed: none')
  if (digest.undescribedEdits.edits > 0)
    lines.push(
      `Undescribed work: ${digest.undescribedEdits.edits} edits to ${digest.undescribedEdits.files} files ${digest.undescribedEdits.sinceSeq === undefined ? 'and no jj describe seen' : `since the last describe (#${digest.undescribedEdits.sinceSeq})`}`,
    )
  if (digest.revisions.length > 0) {
    lines.push(`VCS (${digest.revisions.length}):`)
    for (const revision of digest.revisions.slice(-6))
      lines.push(
        `  #${revision.seq} ${revision.status === 'ok' ? '' : `${revision.status.toUpperCase()} `}${revision.command}${revision.message === undefined ? '' : ` "${oneLine(revision.message, 100)}"`}`,
      )
  }
  lines.push(`Failures: ${digest.failures.toolErrors} tool errors · ${digest.failures.retries} LLM retries · ${digest.failures.failedTurns} failed turns`)
  for (const failure of digest.failures.recent) lines.push(`  #${failure.seq} ${oneLine(failure.summary, 70)} → ${oneLine(failure.error, 90)}`)
  if (digest.subagents.length > 0) lines.push(`Subagents: ${digest.subagents.map(item => `${item.label ?? '?'} (${item.id.slice(0, 8)})`).join(', ')}`)
  return lines.join('\n')
}

export class SessionDigestModel {
  static readonly createEventDescriber = createSessionEventDescriber
  static readonly eventFilter = sessionEventFilter
  static readonly isNoiseEvent = isNoiseSessionEvent
  static readonly digest = digestSession
  static readonly formatEventClock = formatEventClock
  static readonly render = renderSessionDigest
}
