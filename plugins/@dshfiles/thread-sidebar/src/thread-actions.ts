import { encodeSessionReferenceUri } from '@deepseek-ai/dsh-session-reference'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import type { FolderInspection } from '@dshfiles/workspace-folder-picker/project-lifecycle-api'
import { Effect, Option, Schedule, Schema } from 'effect'
import { ThreadHostCallFailed } from './sidebar-errors.js'
import { ThreadReferencesModel, type ThreadReferenceMention, type ThreadReferenceThread } from './thread-references.js'
import { WorkspacePaths } from './workspace-paths.js'

/** One Host verb as the actions read it; its failure carries the Host's own error as `cause`. */
export type HostEffect<A> = Effect.Effect<A, ThreadHostCallFailed>

/** The subset of a Host Session summary these actions read. */
export interface ThreadSummary {
  readonly sessionId: string
  readonly updatedAt: number
  readonly running: boolean
  readonly agentAvailable: boolean
  readonly cwd?: string
}

/** The subset of a registered project (DSH Workspace) these actions read. */
export interface ProjectRow {
  readonly projectId: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** Host services the thread and project actions call, decoded to plain ids at this boundary. */
export interface ThreadActionDeps {
  readonly listSessions: () => HostEffect<readonly ThreadSummary[]>
  readonly readTitles: (sessionIds: readonly string[]) => HostEffect<ReadonlyMap<string, string>>
  /** Fork lineage as the Host records it: one entry per session, without reading any log. */
  readonly listThreadRelations: () => HostEffect<readonly ThreadReferenceThread[]>
  /** Full-text search over session messages; the reference lookup asks it for one session id. */
  readonly searchThreadContent: (query: string, limit: number) => HostEffect<readonly ThreadReferenceMention[]>
  readonly projects: () => readonly ProjectRow[]
  readonly archivedSessionIds: () => readonly string[]
  readonly pinnedSessionIds: () => readonly string[]
  readonly settledSessionIds: () => readonly string[]
  /** Move one thread into or out of the plugin's own settled status; returns the set the Host now holds. */
  readonly setSettled: (sessionId: string, settled: boolean) => HostEffect<readonly string[]>
  readonly archive: (sessionId: string, stopActivity: boolean) => HostEffect<readonly string[]>
  readonly unarchive: (sessionId: string) => HostEffect<readonly string[]>
  readonly pin: (sessionId: string) => HostEffect<readonly string[]>
  readonly unpin: (sessionId: string) => HostEffect<readonly string[]>
  readonly rename: (sessionId: string, title: string) => HostEffect<{ readonly title: string }>
  readonly fork: (sessionId: string, atSeq: number | undefined) => HostEffect<{ readonly sessionId: string }>
  /** Fork one thread into a workspace whose directory becomes the new thread's own cwd. */
  readonly continueIn: (input: {
    readonly sessionId: string
    readonly workspaceId: string
    readonly includeOpenTurn: boolean
  }) => HostEffect<{ readonly sessionId: string }>
  readonly create: (input: {
    readonly projectId?: string
    readonly cwd?: string
    readonly agentPreset?: string
  }) => HostEffect<{ readonly sessionId: string; readonly agentPreset?: string }>
  /** Hand one message to a thread: queue starts its next turn, steer folds it into the running one. */
  readonly prompt: (input: { readonly sessionId: string; readonly text: string; readonly mode: 'queue' | 'steer' }) => HostEffect<void>
  /** The workspace a new thread may start in: never a jj thread workspace another thread already uses. */
  readonly ownWorkspaceFor: (projectId: string) => HostEffect<string>
  readonly stop: (sessionId: string) => HostEffect<void>
  readonly selectModel: (input: {
    readonly sessionId: string
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }) => HostEffect<{ readonly provider: string; readonly model: string; readonly reasoningEffort?: string }>
  /** What the folder is before it is registered, so no surface adds a project blind; null without the picker's read. */
  readonly inspectProject: (path: string) => HostEffect<FolderInspection | null>
  readonly registerProject: (
    path: string,
    title: string | undefined,
  ) => HostEffect<{ readonly projectId: string; readonly title: string; readonly path: string; readonly created: boolean }>
  readonly renameProject: (projectId: string, title: string) => HostEffect<{ readonly projectId: string; readonly title: string }>
  readonly deleteProject: (projectId: string) => HostEffect<void>
  readonly reorderProject: (projectId: string, beforeProjectId: string | undefined) => HostEffect<readonly string[]>
  readonly moveSession: (projectId: string, sessionId: string, beforeSessionId: string | undefined) => HostEffect<readonly string[]>
}

/** What a dshx API handler receives; `caller` identifies the acting Agent for self-targeted actions. */
export interface ThreadActionContext<Input> {
  readonly input: Input
  readonly caller: ApiCaller
}

export interface ThreadListInput {
  readonly query?: string | undefined
  readonly includeArchived?: boolean | undefined
  readonly limit?: number | undefined
}
export interface ThreadArchiveInput {
  readonly sessionId?: string | undefined
  readonly stopActivity?: boolean | undefined
}
export interface ThreadTargetInput {
  readonly sessionId: string
}
export interface ThreadReferencesInput {
  readonly sessionId?: string | undefined
  readonly limit?: number | undefined
}
export interface ThreadRenameInput {
  readonly sessionId?: string | undefined
  readonly title: string
}
export interface ThreadForkInput {
  readonly sessionId?: string | undefined
  readonly atSeq?: number | undefined
}
export interface ThreadContinueInInput {
  readonly sessionId?: string | undefined
  readonly projectId: string
  readonly text?: string | undefined
}
export interface ThreadCreateInput {
  readonly projectId?: string | undefined
  readonly cwd?: string | undefined
  readonly title?: string | undefined
  readonly agentPreset?: string | undefined
  readonly text?: string | undefined
}
export interface ThreadPromptInput {
  readonly sessionId?: string | undefined
  readonly text: string
  readonly mode?: 'queue' | 'steer' | undefined
}
export interface ThreadFanOutModel {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}
export interface ThreadFanOutInput {
  readonly projectId?: string | undefined
  readonly cwd?: string | undefined
  readonly text: string
  readonly models: readonly ThreadFanOutModel[]
  readonly titlePrefix?: string | undefined
}

export interface ThreadSelectModelInput {
  readonly sessionId?: string | undefined
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}
export interface ProjectRegisterInput {
  readonly path: string
  readonly title?: string | undefined
}
export interface ProjectRenameInput {
  readonly projectId: string
  readonly title: string
}
export interface ProjectDeleteInput {
  readonly projectId: string
}
export interface ProjectReorderInput {
  readonly projectId: string
  readonly beforeProjectId?: string | undefined
}
export interface ThreadMoveInput {
  readonly sessionId: string
  readonly projectId: string
  readonly beforeSessionId?: string | undefined
}

export interface ThreadListRow {
  readonly sessionId: string
  readonly title?: string
  readonly projectId?: string
  readonly projectTitle?: string
  readonly cwd?: string
  readonly running: boolean
  readonly liveAgent: boolean
  readonly archived: boolean
  readonly pinned: boolean
  readonly settled: boolean
  readonly updatedAt?: number
}

const DEFAULT_LIMIT = 50
/** Title folding is a per-session log read; cap the batch so one listing stays bounded. */
const TITLE_BUDGET = 300
const MAX_ERROR_MESSAGE = 300
/** A reference search still reconciling the corpus must not hold a menu open; lineage still answers. */
const REFERENCE_SEARCH_DEADLINE = '1500 millis'
/** The full-text index builds on its first search, so early attempts can time out before they can answer. */
const REFERENCE_SEARCH_ATTEMPTS = 3
const REFERENCE_SEARCH_RETRY_DELAY = '150 millis'
const SEARCH_UNANSWERED = 'unanswered' as const

/** The Host failures these actions read: a stable code, and the activity an archive refusal named. */
const passthroughRecordSchema = Schema.Record(Schema.String, Schema.Unknown)
const remoteFailureSchema = Schema.StructWithRest(
  Schema.Struct({
    code: Schema.optional(Schema.String),
    details: Schema.optional(
      Schema.StructWithRest(
        Schema.Struct({ activity: Schema.optional(Schema.Array(Schema.StructWithRest(Schema.Struct({ kind: Schema.String }), [passthroughRecordSchema]))) }),
        [passthroughRecordSchema],
      ),
    ),
  }),
  [passthroughRecordSchema],
)

const decodeRemoteFailure = Schema.decodeUnknownOption(remoteFailureSchema)

const hostCause = (error: unknown): unknown => (error instanceof ThreadHostCallFailed ? error.cause : error)

const errorCode = (error: unknown): string | undefined => Option.getOrUndefined(decodeRemoteFailure(hostCause(error)))?.code

const pluginCode = (code: string | undefined): string => (code !== undefined && /^[a-z][a-z0-9-]{0,63}$/u.test(code) ? code : 'action-failed')

const failure = (failed: unknown, message: string): PluginApiError => {
  const code = errorCode(failed)
  const error = hostCause(failed)
  if (code === 'session/not-found') {
    return new PluginApiError('No thread with that id exists.', { code: 'thread-not-found' })
  }
  if (code === 'workspace/not-found') {
    return new PluginApiError('No project with that id exists.', { code: 'project-not-found' })
  }
  if (code === 'workspace/name-conflict') {
    return new PluginApiError('Another project already uses that title.', { code: 'project-title-taken' })
  }
  if (error instanceof Error && error.message.length > 0) {
    return new PluginApiError(error.message.slice(0, MAX_ERROR_MESSAGE), { code: pluginCode(code) })
  }
  return new PluginApiError(message, { code: pluginCode(code) })
}

const activityKinds = (error: unknown): string[] =>
  (Option.getOrUndefined(decodeRemoteFailure(hostCause(error)))?.details?.activity ?? []).map(entry => entry.kind)

const callerSessionId = (caller: ApiCaller): string | undefined => (caller.kind === 'agent' ? caller.sessionId : undefined)

const targetSessionId = (requested: string | undefined, caller: ApiCaller): Effect.Effect<string, PluginApiError> => {
  const sessionId = requested ?? callerSessionId(caller)
  if (sessionId !== undefined) return Effect.succeed(sessionId)
  return Effect.fail(new PluginApiError('Pass sessionId: this tool cannot tell which thread to act on.', { code: 'thread-target-unknown' }))
}

const matches = (query: string, summary: ThreadSummary, title: string | undefined, project: ProjectRow | undefined): boolean =>
  (title ?? '').toLowerCase().includes(query) ||
  summary.sessionId.toLowerCase().includes(query) ||
  (summary.cwd ?? '').toLowerCase().includes(query) ||
  (project?.title ?? '').toLowerCase().includes(query)

/** One reference search, bounded so a search still reconciling the corpus cannot hold the menu open; none when it could not answer. */
const searchWithinDeadline = (deps: ThreadActionDeps, query: string) =>
  deps.searchThreadContent(query, ThreadReferencesModel.maxLimit).pipe(
    Effect.timeoutOption(REFERENCE_SEARCH_DEADLINE),
    Effect.catch(() => Effect.succeedNone),
  )

/** One query with the first-search retries: none when the search could not answer at all. */
const searchWithRetries = (deps: ThreadActionDeps, query: string) =>
  searchWithinDeadline(deps, query).pipe(
    Effect.flatMap(mentions => (Option.isSome(mentions) ? Effect.succeed(mentions) : Effect.fail(SEARCH_UNANSWERED))),
    Effect.retry({ times: REFERENCE_SEARCH_ATTEMPTS - 1, schedule: Schedule.spaced(REFERENCE_SEARCH_RETRY_DELAY) }),
    Effect.catch(() => Effect.succeedNone),
  )

/**
 * How a message that pulled `sessionId` in as referenced context records it. A composer mention serializes the
 * canonical `@[label](dsh-session:<payload>)` URI, whose payload carries the id whatever label the mention used,
 * so a titled thread is found too; the bare id is the older form, kept as the fallback.
 */
const mentionQueries = (sessionId: string): readonly string[] => [
  encodeSessionReferenceUri(SessionId(sessionId)),
  ThreadReferencesModel.mentionQuery(sessionId),
]

/**
 * Threads whose indexed message pulled `sessionId` in as referenced context; none when no query could answer.
 * A query that answers with rows wins; one that answers empty falls through to the next query.
 */
const mentionThreads = Effect.fnUntraced(function* (deps: ThreadActionDeps, sessionId: string) {
  let unanswered = false
  for (const query of mentionQueries(sessionId)) {
    const mentions = yield* searchWithRetries(deps, query)
    if (Option.isNone(mentions)) {
      unanswered = true
      continue
    }
    if (mentions.value.length > 0) return Option.some(mentions.value)
  }
  return unanswered ? Option.none<readonly ThreadReferenceMention[]>() : Option.some<readonly ThreadReferenceMention[]>([])
})

/** The registered project that owns a directory, if any; the lookup is best-effort and never blocks creating a thread. */
const projectIdForPath = (deps: ThreadActionDeps, cwd: string | undefined): string | undefined => {
  if (cwd === undefined) return undefined
  try {
    return deps.projects().find(project => project.path === cwd)?.projectId
  } catch {
    return undefined
  }
}

/** Run one Host verb, reporting its failure the way the actions API always has. */
const attempt = <A>(effect: HostEffect<A>, message: string) => Effect.mapError(effect, error => failure(error, message))

/** Builds the thread and project actions over the injected Host services. */
export const createThreadActions = (deps: ThreadActionDeps) => ({
  list: Effect.fn('thread actions list')(function* ({ input }: ThreadActionContext<ThreadListInput>) {
    const sessions = yield* attempt(deps.listSessions(), 'Could not list threads.')
    const projects = deps.projects()
    const archived = new Set(deps.archivedSessionIds())
    const pinned = new Set(deps.pinnedSessionIds())
    const settled = new Set(deps.settledSessionIds())
    const projectOf = new Map<string, ProjectRow>()
    for (const project of projects) {
      for (const sessionId of project.sessionIds) projectOf.set(sessionId, project)
    }

    const includeArchived = input.includeArchived === true
    const recent = [...sessions].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, TITLE_BUDGET)
    const listed = recent.filter(summary => includeArchived || !archived.has(summary.sessionId))
    const query = input.query?.trim().toLowerCase() ?? ''
    const searched = query.length > 0
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, listed.length)
    // A title is a fold over that session's whole log, so a page nothing searches reads only the rows it returns.
    const titled = searched ? listed : listed.slice(0, limit)
    const titles = yield* attempt(deps.readTitles(titled.map(summary => summary.sessionId)), 'Could not read thread titles.')

    const rows: ThreadListRow[] = []
    for (const summary of titled) {
      const isArchived = archived.has(summary.sessionId)
      const title = titles.get(summary.sessionId)
      const project = projectOf.get(summary.sessionId)
      if (searched && !matches(query, summary, title, project)) continue
      rows.push({
        sessionId: summary.sessionId,
        ...(title === undefined ? undefined : { title }),
        ...(project === undefined ? undefined : { projectId: project.projectId, projectTitle: project.title }),
        ...(summary.cwd === undefined ? undefined : { cwd: summary.cwd }),
        running: summary.running,
        liveAgent: summary.agentAvailable,
        archived: isArchived,
        pinned: pinned.has(summary.sessionId),
        settled: settled.has(summary.sessionId),
        updatedAt: summary.updatedAt,
      })
    }

    const threads = rows.slice(0, limit)
    const total = searched ? rows.length : listed.length
    return { threads, total, truncated: total > threads.length }
  }),

  references: Effect.fn('thread actions references')(function* ({ input, caller }: ThreadActionContext<ThreadReferencesInput>) {
    const sessionId = yield* targetSessionId(input.sessionId, caller)
    const limit = Math.max(1, Math.min(input.limit ?? ThreadReferencesModel.defaultLimit, ThreadReferencesModel.maxLimit))
    const [sessions, relations] = yield* attempt(Effect.all([deps.listSessions(), deps.listThreadRelations()], { concurrency: 2 }), 'Could not list threads.')
    const relationById = new Map(relations.map(relation => [relation.sessionId, relation]))
    const summaryById = new Map(sessions.map(summary => [summary.sessionId, summary]))
    const mentions = yield* mentionThreads(deps, sessionId)
    const merged = ThreadReferencesModel.merge({
      sessionId,
      limit,
      degraded: Option.isNone(mentions),
      // The logical-session corpus is the authority on lineage; the summary only adds recency.
      threads: [...new Set([...relationById.keys(), ...summaryById.keys()])].map(threadId => {
        const relation = relationById.get(threadId)
        const updatedAt = summaryById.get(threadId)?.updatedAt
        return {
          sessionId: threadId,
          parentSessionId: relation?.parentSessionId ?? null,
          ...(updatedAt === undefined ? undefined : { updatedAt }),
          ...(relation?.origin === undefined ? undefined : { origin: relation.origin }),
        }
      }),
      mentions: Option.getOrElse(mentions, () => []),
    })
    if (merged.references.length === 0) return { ...merged, references: [] }
    const titles = yield* attempt(deps.readTitles(merged.references.map(row => row.sessionId)), 'Could not read thread titles.')
    return { ...merged, references: [...ThreadReferencesModel.withTitles(merged.references, titles)] }
  }),

  archive: Effect.fn('thread actions archive')(function* ({ input, caller }: ThreadActionContext<ThreadArchiveInput>) {
    const sessionId = yield* targetSessionId(input.sessionId, caller)
    const stopActivity = input.stopActivity === true
    return yield* deps.archive(sessionId, stopActivity).pipe(
      Effect.map(archivedSessionIds => ({ status: 'archived' as const, sessionId, archivedSessionIds: [...archivedSessionIds], activity: [] as string[] })),
      Effect.catch(error =>
        errorCode(error) === 'workspace/session-active'
          ? Effect.succeed({
              status: 'refused-active' as const,
              sessionId,
              archivedSessionIds: [...deps.archivedSessionIds()],
              activity: activityKinds(error),
            })
          : Effect.fail(failure(error, `Could not archive thread ${sessionId}.`)),
      ),
    )
  }),

  unarchive: Effect.fn('thread actions unarchive')(function* ({ input }: ThreadActionContext<ThreadTargetInput>) {
    const archivedSessionIds = yield* attempt(deps.unarchive(input.sessionId), `Could not restore thread ${input.sessionId}.`)
    return { sessionId: input.sessionId, archivedSessionIds: [...archivedSessionIds] }
  }),

  settle: Effect.fn('thread actions settle')(function* ({ input, caller }: ThreadActionContext<ThreadArchiveInput>) {
    const sessionId = yield* targetSessionId(input.sessionId, caller)
    return { sessionId, settledSessionIds: [...(yield* attempt(deps.setSettled(sessionId, true), `Could not settle thread ${sessionId}.`))] }
  }),

  unsettle: Effect.fn('thread actions unsettle')(function* ({ input }: ThreadActionContext<ThreadTargetInput>) {
    const settledSessionIds = yield* attempt(deps.setSettled(input.sessionId, false), `Could not unsettle thread ${input.sessionId}.`)
    return { sessionId: input.sessionId, settledSessionIds: [...settledSessionIds] }
  }),

  pin: Effect.fn('thread actions pin')(function* ({ input }: ThreadActionContext<ThreadTargetInput>) {
    const pinnedSessionIds = yield* attempt(deps.pin(input.sessionId), `Could not pin thread ${input.sessionId}.`)
    return { sessionId: input.sessionId, pinnedSessionIds: [...pinnedSessionIds] }
  }),

  unpin: Effect.fn('thread actions unpin')(function* ({ input }: ThreadActionContext<ThreadTargetInput>) {
    const pinnedSessionIds = yield* attempt(deps.unpin(input.sessionId), `Could not unpin thread ${input.sessionId}.`)
    return { sessionId: input.sessionId, pinnedSessionIds: [...pinnedSessionIds] }
  }),

  rename: Effect.fn('thread actions rename')(function* ({ input, caller }: ThreadActionContext<ThreadRenameInput>) {
    const sessionId = yield* targetSessionId(input.sessionId, caller)
    const renamed = yield* attempt(deps.rename(sessionId, input.title), `Could not rename thread ${sessionId}.`)
    return { sessionId, title: renamed.title }
  }),

  fork: Effect.fn('thread actions fork')(function* ({ input, caller }: ThreadActionContext<ThreadForkInput>) {
    const sessionId = yield* targetSessionId(input.sessionId, caller)
    const forked = yield* attempt(deps.fork(sessionId, input.atSeq), `Could not fork thread ${sessionId}.`)
    return { sessionId, forkedSessionId: forked.sessionId }
  }),

  continueIn: Effect.fn('thread actions continue in')(function* ({ input, caller }: ThreadActionContext<ThreadContinueInInput>) {
    const sessionId = yield* targetSessionId(input.sessionId, caller)
    const failed = `Could not continue thread ${sessionId} in project ${input.projectId}.`
    // The calling thread continues mid-turn, so its own request is kept; any other running thread would lose its turn.
    const continuingItself = callerSessionId(caller) === sessionId
    if (!continuingItself && (yield* attempt(deps.listSessions(), failed)).some(summary => summary.sessionId === sessionId && summary.running)) {
      return yield* Effect.fail(
        new PluginApiError(`Thread ${sessionId} is still running. Stop it or wait for its turn to end, then continue it elsewhere.`, {
          code: 'thread-running',
        }),
      )
    }
    const workspaceId = yield* attempt(deps.ownWorkspaceFor(input.projectId), failed)
    const continuedSessionId = (yield* attempt(deps.continueIn({ sessionId, workspaceId, includeOpenTurn: continuingItself }), failed)).sessionId
    const continued = { sessionId, continuedSessionId, projectId: input.projectId, workspaceId }
    // The new thread already exists: a failed settle or first message is reported, never a reason to hide its id.
    const settled = yield* deps.setSettled(sessionId, true).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    )
    if (input.text === undefined) return { ...continued, settled }
    return yield* deps.prompt({ sessionId: continuedSessionId, text: input.text, mode: 'queue' }).pipe(
      Effect.as({ ...continued, settled, prompt: 'accepted' as const }),
      Effect.catch(error =>
        Effect.succeed({ ...continued, settled, prompt: 'refused' as const, promptError: failure(error, 'Could not send its first message.').message }),
      ),
    )
  }),

  create: Effect.fn('thread actions create')(function* ({ input }: ThreadActionContext<ThreadCreateInput>) {
    // The Host accounts a Session to a workspace or to a bare cwd, never both, and a bare cwd leaves it ungrouped:
    // when the directory is a registered project, create the thread in that project instead.
    const requestedProjectId = input.projectId ?? projectIdForPath(deps, input.cwd)
    const projectId = requestedProjectId === undefined ? undefined : yield* attempt(deps.ownWorkspaceFor(requestedProjectId), 'Could not start a new thread.')
    const created = yield* attempt(
      deps.create({
        ...(projectId === undefined ? undefined : { projectId }),
        ...(projectId === undefined && input.cwd !== undefined ? { cwd: input.cwd } : undefined),
        ...(input.agentPreset === undefined ? undefined : { agentPreset: input.agentPreset }),
      }),
      'Could not start a new thread.',
    )
    const started = {
      sessionId: created.sessionId,
      ...(created.agentPreset === undefined ? undefined : { agentPreset: created.agentPreset }),
    }
    // The thread already exists, so a refused title or first message must not hide its id from the caller.
    const title =
      input.title === undefined
        ? undefined
        : yield* deps.rename(created.sessionId, input.title).pipe(
            Effect.map(renamed => renamed.title),
            Effect.catch(() => Effect.succeed(undefined)),
          )
    const withTitle = { ...started, ...(title === undefined ? undefined : { title }) }
    if (input.text === undefined) return withTitle
    return yield* deps.prompt({ sessionId: created.sessionId, text: input.text, mode: 'queue' }).pipe(
      Effect.as({ ...withTitle, prompt: 'accepted' as const }),
      Effect.catch(error =>
        Effect.succeed({ ...withTitle, prompt: 'refused' as const, promptError: failure(error, 'Could not send its first message.').message }),
      ),
    )
  }),

  prompt: Effect.fn('thread actions prompt')(function* ({ input, caller }: ThreadActionContext<ThreadPromptInput>) {
    const sessionId = yield* targetSessionId(input.sessionId, caller)
    const mode = input.mode ?? 'queue'
    yield* attempt(deps.prompt({ sessionId, text: input.text, mode }), `Could not send a message to thread ${sessionId}.`)
    return { sessionId, mode, accepted: true as const }
  }),

  stop: Effect.fn('thread actions stop')(function* ({ input }: ThreadActionContext<ThreadTargetInput>) {
    yield* attempt(deps.stop(input.sessionId), `Could not stop thread ${input.sessionId}.`)
    return { sessionId: input.sessionId, accepted: true as const }
  }),

  fanOut: Effect.fn('thread actions fan out')(function* ({ input }: ThreadActionContext<ThreadFanOutInput>) {
    const prefix = input.titlePrefix?.trim() || input.text.trim().split(/\s+/u).slice(0, 6).join(' ')
    const runModel = (model: ThreadFanOutModel) => {
      let sessionId: string | undefined
      return Effect.gen(function* () {
        const requestedProjectId = input.projectId ?? projectIdForPath(deps, input.cwd)
        const projectId =
          requestedProjectId === undefined ? undefined : yield* attempt(deps.ownWorkspaceFor(requestedProjectId), 'Could not start a new thread.')
        const created = yield* attempt(
          deps.create({
            ...(projectId === undefined ? undefined : { projectId }),
            ...(projectId === undefined && input.cwd !== undefined ? { cwd: input.cwd } : undefined),
          }),
          'Could not start a new thread.',
        )
        sessionId = created.sessionId
        yield* attempt(
          deps.selectModel({
            sessionId,
            provider: model.provider,
            model: model.model,
            ...(model.reasoningEffort === undefined ? undefined : { reasoningEffort: model.reasoningEffort }),
          }),
          'Could not select the model.',
        )
        yield* attempt(deps.rename(sessionId, `${prefix} · ${model.model}`), 'Could not title the thread.')
        yield* attempt(deps.prompt({ sessionId, text: input.text, mode: 'queue' }), 'Could not send the prompt.')
        return { ...model, sessionId, ok: true as const }
      }).pipe(
        Effect.catch(error =>
          Effect.succeed({
            ...model,
            ...(sessionId === undefined ? undefined : { sessionId }),
            ok: false as const,
            error: error instanceof Error ? error.message.slice(0, MAX_ERROR_MESSAGE) : 'Could not create this model thread.',
          }),
        ),
      )
    }
    const results = yield* Effect.all(input.models.map(runModel), { concurrency: 2 })
    return { results }
  }),

  selectModel: Effect.fn('thread actions select model')(function* ({ input, caller }: ThreadActionContext<ThreadSelectModelInput>) {
    const sessionId = yield* targetSessionId(input.sessionId, caller)
    const selected = yield* attempt(
      deps.selectModel({
        sessionId,
        provider: input.provider,
        model: input.model,
        ...(input.reasoningEffort === undefined ? undefined : { reasoningEffort: input.reasoningEffort }),
      }),
      `Could not select a model for thread ${sessionId}.`,
    )
    return {
      sessionId,
      provider: selected.provider,
      model: selected.model,
      ...(selected.reasoningEffort === undefined ? undefined : { reasoningEffort: selected.reasoningEffort }),
    }
  }),

  projectList: () =>
    Effect.sync(() => ({
      // A project list names projects: the jj workspaces threads run in are workspaces of one, so they stay out.
      projects: WorkspacePaths.projects(deps.projects()).map(project => ({
        projectId: project.projectId,
        title: project.title,
        path: project.path,
        threadCount: project.sessionIds.length,
      })),
    })).pipe(Effect.withSpan('thread actions project list')),

  projectRegister: Effect.fn('thread actions project register')(function* ({ input }: ThreadActionContext<ProjectRegisterInput>) {
    const inspection = yield* Effect.option(attempt(deps.inspectProject(input.path), `Could not inspect ${input.path}.`))
    const registered = yield* attempt(deps.registerProject(input.path, input.title), `Could not register ${input.path} as a project.`)
    return { ...registered, inspection: Option.getOrNull(inspection) }
  }),

  projectRename: Effect.fn('thread actions project rename')(function* ({ input }: ThreadActionContext<ProjectRenameInput>) {
    return yield* attempt(deps.renameProject(input.projectId, input.title), `Could not rename project ${input.projectId}.`)
  }),

  projectDelete: Effect.fn('thread actions project delete')(function* ({ input }: ThreadActionContext<ProjectDeleteInput>) {
    yield* attempt(deps.deleteProject(input.projectId), `Could not remove project ${input.projectId}.`)
    return { projectId: input.projectId, deleted: true as const }
  }),

  projectReorder: Effect.fn('thread actions project reorder')(function* ({ input }: ThreadActionContext<ProjectReorderInput>) {
    const projectIds = yield* attempt(deps.reorderProject(input.projectId, input.beforeProjectId), `Could not reorder project ${input.projectId}.`)
    return { projectIds: [...projectIds] }
  }),

  move: Effect.fn('thread actions move')(function* ({ input }: ThreadActionContext<ThreadMoveInput>) {
    const sessionIds = yield* attempt(deps.moveSession(input.projectId, input.sessionId, input.beforeSessionId), `Could not move thread ${input.sessionId}.`)
    return { sessionId: input.sessionId, projectId: input.projectId, sessionIds: [...sessionIds] }
  }),
})

export type ThreadActionSet = ReturnType<typeof createThreadActions>
