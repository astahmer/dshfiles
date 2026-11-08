import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-query'
import { MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { Effect, Schema } from 'effect'
import { definePromptSection, generate, pluginStorage } from '@dshfiles/dshx/host'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionRequestId } from './native/types.ts'
import { recentTranscript, recentTranscriptFromTail } from './session-transcript.ts'
import { TailLog } from './tail-log.ts'
import { sessionsApi } from './sessions-api.ts'
import {
  AgentPresetsUnavailable,
  CommandUnavailable,
  ControllerUnavailable,
  SessionControllerHostRuntime,
  ThreadNotFound,
  ThreadUnavailable,
  sessionControllerHostApi,
  trySessionControllerOperation,
} from './effect-runtime.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A message a plugin (or a browser) added through `sessionsApi.message`, recorded with who sent it. */
    'dshfiles-plugin-message': { readonly kind: 'dshfiles-plugin-message'; readonly from: string }
  }
}

const STORAGE_NAMESPACE = '@dshfiles/session-controller'
const INSTRUCTIONS_PREFIX = 'instructions/'

/** Keyed instructions per thread, read synchronously by the prompt context; the plugin storage keeps them durable. */
const instructions = new Map<string, Map<string, string>>()
let instructionsLoaded: Promise<void> | undefined

const instructionKey = (sessionId: string, key: string): string => `${INSTRUCTIONS_PREFIX}${sessionId}/${key}`

const loadInstructions = (ctx: Context): Promise<void> => {
  instructionsLoaded ??= (async () => {
    const storage = pluginStorage(ctx, STORAGE_NAMESPACE)
    let cursor: string | undefined
    do {
      const page = await storage.list({ prefix: INSTRUCTIONS_PREFIX, limit: 500, ...(cursor === undefined ? undefined : { cursor }) })
      for (const entry of page.entries) {
        const rest = entry.key.slice(INSTRUCTIONS_PREFIX.length)
        const separator = rest.indexOf('/')
        if (separator < 0 || typeof entry.value !== 'string') continue
        const session = instructions.get(rest.slice(0, separator)) ?? new Map<string, string>()
        session.set(rest.slice(separator + 1), entry.value)
        instructions.set(rest.slice(0, separator), session)
      }
      cursor = page.cursor ?? undefined
    } while (cursor !== undefined)
  })().catch((error: unknown) => {
    instructionsLoaded = undefined
    throw error
  })
  return instructionsLoaded
}

const entriesOf = (sessionId: string) =>
  [...(instructions.get(sessionId) ?? new Map<string, string>())].sort(([left], [right]) => left.localeCompare(right)).map(([key, text]) => ({ key, text }))

/**
 * A system-prompt section, not a context: a context is recorded in the thread as a durable snapshot, so a removed
 * instruction would stay in its history. The section is assembled again for every request.
 */
export const sessionInstructionsSection = definePromptSection({
  name: 'dshfiles-session-controller:instructions',
  order: 900,
  interpolate: false,
  text: context => {
    const id = context.agent?.id
    const entries = id === undefined ? [] : entriesOf(id)
    if (entries.length === 0) return ''
    return ['Instructions added to this thread:', ...entries.map(entry => `- ${entry.text}`)].join('\n')
  },
})

/**
 * The native controller rejects with typert `RemoteError`s (`session/not-found`, `session/agent-busy`, …) whose text is
 * written for the user; pass them on as plugin errors instead of the generic internal failure.
 */
const native = async <T>(call: () => T | Promise<T>): Promise<T> => {
  try {
    return await call()
  } catch (error) {
    const remote = remoteErrorOf(error)
    if (remote === undefined) throw error
    throw new PluginApiError(remote.message, { code: remote.code.replaceAll('/', '-').toLowerCase() })
  }
}

const notFound = (): ThreadNotFound => new ThreadNotFound({ message: 'No thread with that id exists.', code: 'thread-not-found' })

const controllerOf = (runtime: typeof SessionControllerHostRuntime.Service) => {
  const controller = runtime.sessionController
  if (controller === undefined) throw new ControllerUnavailable({ message: 'The Session controller is not running.', code: 'controller-unavailable' })
  return controller
}

const allowed = (runtime: typeof SessionControllerHostRuntime.Service, sessionId: string): SessionId => {
  const id = SessionId(sessionId)
  if (!runtime.ctx.remoteAccess.allows({ kind: 'session', id })) throw notFound()
  return id
}

const agentOf = async (runtime: typeof SessionControllerHostRuntime.Service, sessionId: string): Promise<Agent> => {
  const resolved = await native(() => controllerOf(runtime).resolveAgent(allowed(runtime, sessionId)))
  if ('error' in resolved) throw new ThreadUnavailable({ message: resolved.error.message, code: 'thread-unavailable' })
  return resolved.agent
}

const runCommand = async (runtime: typeof SessionControllerHostRuntime.Service, sessionId: string, line: string, signal: AbortSignal) => {
  const agent = await agentOf(runtime, sessionId)
  const commands = runtime.commands
  if (commands === undefined) throw new CommandUnavailable({ message: 'This Host has no command runtime.', code: 'command-unavailable' })
  const execution = await native(() => commands.execute(agent, line, [], signal))
  if (execution === undefined) {
    throw new CommandUnavailable({
      message: `No command ${line.split(/\s/, 1)[0]} is available in this thread. List the thread's commands in its composer.`,
      code: 'command-unavailable',
    })
  }
  return execution.result.text === undefined ? { kind: execution.result.kind } : { kind: execution.result.kind, text: execution.result.text }
}

const senderOf = (caller: ApiCaller): string =>
  caller.kind === 'plugin' ? caller.packageId : caller.kind === 'agent' ? `agent:${caller.sessionId ?? 'unknown'}` : 'client'

const isBusy = (agent: Agent): boolean => agent.status !== 'idle' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0

const sendPrompt = async (
  runtime: typeof SessionControllerHostRuntime.Service,
  sessionId: SessionId,
  text: string,
  mode: 'queue' | 'steer',
  signal: AbortSignal,
): Promise<void> => {
  // SAFETY: SessionRequestId is a type-only brand over a caller-minted unique id.
  const requestId = randomUUID() as SessionRequestId
  await native(() => controllerOf(runtime).prompt({ requestId, sessionId, mode, content: [{ type: 'text', text }] }, signal))
}

const projectsBySession = (runtime: typeof SessionControllerHostRuntime.Service) => {
  const registry = runtime.workspaceRegistry
  const projects = new Map<string, { readonly projectId: string; readonly projectTitle: string }>()
  for (const workspace of registry?.list() ?? []) {
    for (const id of workspace.sessionIds) projects.set(id, { projectId: workspace.id, projectTitle: workspace.title })
  }
  return { projects, archived: new Set<string>(registry?.archivedSessionIds ?? []) }
}

const readTitles = async (
  runtime: typeof SessionControllerHostRuntime.Service,
  sessionIds: readonly SessionId[],
  signal: AbortSignal,
): Promise<Map<string, string>> => {
  const titles = new Map<string, string>()
  const query = runtime.sessionQuery
  if (query === undefined || sessionIds.length === 0) return titles
  for (const result of await query.readTitleSnapshots(sessionIds, signal)) {
    if (result.status === 'fulfilled' && result.value.title !== undefined) titles.set(result.sessionId, result.value.title.title)
  }
  return titles
}

const isSessionQueryNotFound = (error: unknown): boolean =>
  Schema.decodeUnknownResult(Schema.Struct({ code: Schema.Literal('SESSION_QUERY_SESSION_NOT_FOUND') }))(error)._tag === 'Success'

/** A caller's JSON Schema as the standard schema `generate` publishes and validates the reply with. */
const standardSchemaOf = (jsonSchema: Record<string, Schema.Schema.Type<typeof Schema.Json>>) => {
  assertSupportedJsonSchema(jsonSchema)
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'dsh',
      validate: (value: unknown) => {
        const violations = validateJsonSchemaValue(jsonSchema, value)
        return violations.length === 0 ? { value } : { issues: violations.map(message => ({ message })) }
      },
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  }
}

const tailOf = async (runtime: typeof SessionControllerHostRuntime.Service, id: SessionId, signal: AbortSignal): Promise<TailLog | undefined> => {
  try {
    return await TailLog.open({ ctx: runtime.ctx, sessionId: id, signal })
  } catch (error: unknown) {
    if (signal.aborted) throw error
    runtime.ctx.logger.warn(`session-controller: tail read of "${id}" fell back to the full read: ${String(error)}`)
    return undefined
  }
}

/**
 * The newest spoken entries of one Session: a live Session folds its resident events, and a cold log decodes only the
 * frames the count needs. Anything the tail cannot serve exactly reads the whole log, as before.
 */
const transcriptOf = async (runtime: typeof SessionControllerHostRuntime.Service, id: SessionId, limit: number, signal: AbortSignal) => {
  const live = runtime.ctx.agents.get(id)
  if (live !== undefined) return recentTranscript({ events: live.session.snapshotEvents(), limit })
  const tail = await tailOf(runtime, id, signal)
  const fromTail = tail === undefined ? undefined : recentTranscriptFromTail({ tail, limit })
  if (fromTail !== undefined) return fromTail
  const query = runtime.sessionQuery
  if (query === undefined) throw notFound()
  try {
    return recentTranscript({ events: (await query.readSession(id)).events, limit })
  } catch (error) {
    if (isSessionQueryNotFound(error)) throw notFound()
    throw error
  }
}

export const sessionsHost = sessionControllerHostApi(sessionsApi, {
  list: Effect.fn('sessions list')(({ input, signal }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        const { items } = await native(() => controllerOf(runtime).list({ projections: [] }, signal))
        const { projects, archived } = projectsBySession(runtime)
        const candidates = items
          .filter(item => !item.blank && item.origin !== 'subagent' && (input.includeArchived || !archived.has(item.sessionId)))
          .filter(item => input.projectId === undefined || projects.get(item.sessionId)?.projectId === input.projectId)
          .toSorted((left, right) => right.updatedAt - left.updatedAt)
        const query = input.query?.toLowerCase()
        // Only a query needs every title; otherwise the page alone is read.
        const titles = await readTitles(
          runtime,
          (query === undefined || query === '' ? candidates.slice(0, input.limit) : candidates).map(item => item.sessionId),
          signal,
        )
        const rows = candidates.map(item => {
          const project = projects.get(item.sessionId)
          const title = titles.get(item.sessionId)
          return {
            sessionId: item.sessionId,
            ...(title === undefined ? undefined : { title }),
            ...(item.cwd === undefined ? undefined : { cwd: item.cwd }),
            ...project,
            running: item.running,
            updatedAt: item.updatedAt,
          }
        })
        const matching =
          query === undefined || query === ''
            ? rows
            : rows.filter(row => [row.title, row.cwd, row.projectTitle].some(field => field?.toLowerCase().includes(query) === true))
        return { threads: matching.slice(0, input.limit), total: matching.length, truncated: matching.length > input.limit }
      }),
    ),
  ),
  messages: Effect.fn('sessions messages read')(({ input, signal }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        const id = allowed(runtime, input.sessionId)
        const transcript = await transcriptOf(runtime, id, input.limit, signal)
        const agent = runtime.ctx.agents.get(id)
        return { sessionId: id, running: agent !== undefined && isBusy(agent), ...transcript }
      }),
    ),
  ),
  create: Effect.fn('sessions thread create')(({ input, signal }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        const controller = controllerOf(runtime)
        const created = await native(() =>
          controller.create({
            ...(input.projectId === undefined ? undefined : { workspaceId: WorkspaceId(input.projectId) }),
            ...(input.cwd === undefined ? undefined : { cwd: input.cwd }),
            ...(input.agentPreset === undefined ? undefined : { agentPreset: input.agentPreset }),
          }),
        )
        if (input.model !== undefined) {
          const model = input.model
          await native(() =>
            controller.selectModel({
              sessionId: created.sessionId,
              provider: model.provider,
              model: model.model,
              ...(model.reasoningEffort === undefined ? undefined : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }),
            }),
          )
        }
        const title = input.title
        if (title !== undefined) await native(() => controller.rename({ sessionId: created.sessionId, title }))
        if (input.prompt !== undefined) await sendPrompt(runtime, created.sessionId, input.prompt, 'queue', signal)
        return { sessionId: created.sessionId }
      }),
    ),
  ),
  prompt: Effect.fn('sessions prompt')(({ input, signal }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        await sendPrompt(runtime, allowed(runtime, input.sessionId), input.text, input.mode, signal)
        return { accepted: true as const }
      }),
    ),
  ),
  command: Effect.fn('sessions command')(({ input, signal }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('execute session command', () => runCommand(runtime, input.sessionId, input.line, signal)),
    ),
  ),
  message: Effect.fn('sessions message send')(({ input, caller }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        const agent = await agentOf(runtime, input.sessionId)
        const messageId = MessageId(randomUUID())
        agent.send(
          { id: messageId, role: 'user', content: [{ type: 'text', text: input.text }], source: { kind: 'dshfiles-plugin-message', from: senderOf(caller) } },
          input.target,
          input.wake,
        )
        return { messageId }
      }),
    ),
  ),
  compact: Effect.fn('sessions compact')(({ input, signal }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('compact session', () => runCommand(runtime, input.sessionId, '/compact', signal)),
    ),
  ),
  interrupt: Effect.fn('sessions interrupt')(({ input }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        await native(() => controllerOf(runtime).cancel({ sessionId: allowed(runtime, input.sessionId) }))
        return { interrupted: true as const }
      }),
    ),
  ),
  wait: Effect.fn('sessions wait')(function* ({ input }) {
    const runtime = yield* SessionControllerHostRuntime
    const id = allowed(runtime, input.sessionId)
    const deadline = Date.now() + input.timeoutMs
    let agent = runtime.ctx.agents.get(id)
    while (agent !== undefined && isBusy(agent)) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return { status: 'running' as const }
      yield* Effect.race(
        Effect.promise(() => runtime.ctx.agents.get(id)?.whenIdle() ?? Promise.resolve()),
        Effect.sleep(Math.min(remaining, 1_000)),
      )
      agent = runtime.ctx.agents.get(id)
    }
    return { status: 'idle' as const }
  }),
  selectModel: Effect.fn('sessions model select')(({ input }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        const value = await native(() =>
          controllerOf(runtime).selectModel({
            sessionId: allowed(runtime, input.sessionId),
            provider: input.provider,
            model: input.model,
            ...(input.reasoningEffort === undefined ? undefined : { reasoningEffort: ReasoningEffortId(input.reasoningEffort) }),
          }),
        )
        return {
          provider: value.selected.provider,
          model: value.selected.model,
          ...(value.selected.reasoningEffort === undefined ? undefined : { reasoningEffort: value.selected.reasoningEffort }),
        }
      }),
    ),
  ),
  selectAgent: Effect.fn('sessions agent select')(({ input }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        const presets = runtime.agentPresets
        if (presets === undefined) {
          throw new AgentPresetsUnavailable({ message: 'This Host composes no agent presets.', code: 'agent-presets-unavailable' })
        }
        const agent = await agentOf(runtime, input.sessionId)
        return { agentPreset: await native(() => presets.select(agent, input.agentPreset)) }
      }),
    ),
  ),
  instructions: Effect.fn('sessions instructions read')(({ input }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        allowed(runtime, input.sessionId)
        await loadInstructions(runtime.ctx)
        return { entries: entriesOf(input.sessionId) }
      }),
    ),
  ),
  setInstruction: Effect.fn('sessions instruction set')(({ input }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        allowed(runtime, input.sessionId)
        await loadInstructions(runtime.ctx)
        const storage = pluginStorage(runtime.ctx, STORAGE_NAMESPACE)
        const session = instructions.get(input.sessionId) ?? new Map<string, string>()
        if (input.text === null) {
          await storage.delete(instructionKey(input.sessionId, input.key))
          session.delete(input.key)
        } else {
          await storage.set(instructionKey(input.sessionId, input.key), input.text)
          session.set(input.key, input.text)
        }
        if (session.size === 0) instructions.delete(input.sessionId)
        else instructions.set(input.sessionId, session)
        return { entries: entriesOf(input.sessionId) }
      }),
    ),
  ),
  generate: Effect.fn('sessions generate')(({ input, signal }) =>
    SessionControllerHostRuntime.use(runtime =>
      trySessionControllerOperation('sessions API operation', async () => {
        const base = {
          prompt: input.prompt,
          signal,
          ...(input.system === undefined ? undefined : { system: input.system }),
          ...(input.model === undefined ? undefined : { model: input.model }),
          ...(input.sessionId === undefined ? undefined : { sessionId: allowed(runtime, input.sessionId) }),
          ...(input.maxTokens === undefined ? undefined : { maxTokens: input.maxTokens }),
        }
        if (input.jsonSchema === undefined) {
          const result = await generate(runtime.ctx, base)
          return { text: result.text, provider: result.provider, model: result.model }
        }
        const result = await generate(runtime.ctx, { ...base, schema: standardSchemaOf(input.jsonSchema) })
        return { text: result.text, value: Schema.decodeUnknownSync(Schema.Json)(result.value), provider: result.provider, model: result.model }
      }),
    ),
  ),
})

/** Load the stored instructions with the Host, so the first request of a thread already carries them. */
export const loadSessionInstructions = (ctx: Context): void => {
  ctx.effect(
    () => () => {
      instructions.clear()
      instructionsLoaded = undefined
    },
    'session-controller: thread instructions',
  )
  void loadInstructions(ctx).catch((error: unknown) =>
    ctx.logger.warn('session-controller: thread instructions were not loaded: %s', error instanceof Error ? error.message : String(error)),
  )
}
