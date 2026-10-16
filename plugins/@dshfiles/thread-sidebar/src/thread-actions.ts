import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { z } from 'zod'

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
  readonly listSessions: (signal: AbortSignal) => Promise<readonly ThreadSummary[]>
  readonly readTitles: (sessionIds: readonly string[], signal: AbortSignal) => Promise<ReadonlyMap<string, string>>
  readonly projects: () => readonly ProjectRow[]
  readonly archivedSessionIds: () => readonly string[]
  readonly pinnedSessionIds: () => readonly string[]
  readonly archive: (sessionId: string, stopActivity: boolean) => Promise<readonly string[]>
  readonly unarchive: (sessionId: string) => Promise<readonly string[]>
  readonly pin: (sessionId: string) => Promise<readonly string[]>
  readonly unpin: (sessionId: string) => Promise<readonly string[]>
  readonly rename: (sessionId: string, title: string) => Promise<{ readonly title: string }>
  readonly fork: (sessionId: string, atSeq: number | undefined) => Promise<{ readonly sessionId: string }>
  readonly create: (input: {
    readonly projectId?: string
    readonly cwd?: string
    readonly agentPreset?: string
  }) => Promise<{ readonly sessionId: string; readonly agentPreset?: string }>
  readonly stop: (sessionId: string) => Promise<void>
  readonly selectModel: (input: {
    readonly sessionId: string
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }) => Promise<{ readonly provider: string; readonly model: string; readonly reasoningEffort?: string }>
  readonly registerProject: (
    path: string,
    title: string | undefined,
  ) => Promise<{ readonly projectId: string; readonly title: string; readonly path: string; readonly created: boolean }>
  readonly renameProject: (projectId: string, title: string) => Promise<{ readonly projectId: string; readonly title: string }>
  readonly deleteProject: (projectId: string) => Promise<void>
  readonly reorderProject: (projectId: string, beforeProjectId: string | undefined) => Promise<readonly string[]>
  readonly moveSession: (projectId: string, sessionId: string, beforeSessionId: string | undefined) => Promise<readonly string[]>
}

/** What a dshx API handler receives; `caller` identifies the acting Agent for self-targeted actions. */
export interface ThreadActionContext<Input> {
  readonly input: Input
  readonly caller: ApiCaller
  readonly signal: AbortSignal
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
export interface ThreadRenameInput {
  readonly sessionId?: string | undefined
  readonly title: string
}
export interface ThreadForkInput {
  readonly sessionId?: string | undefined
  readonly atSeq?: number | undefined
}
export interface ThreadCreateInput {
  readonly projectId?: string | undefined
  readonly cwd?: string | undefined
  readonly title?: string | undefined
  readonly agentPreset?: string | undefined
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
  readonly updatedAt?: number
}

const DEFAULT_LIMIT = 50
/** Title folding is a per-session log read; cap the batch so one listing stays bounded. */
const TITLE_BUDGET = 300
const MAX_ERROR_MESSAGE = 300

/** The Host failures these actions read: a stable code, and the activity an archive refusal named. */
const remoteFailureSchema = z.looseObject({
  code: z.string().optional(),
  details: z.looseObject({ activity: z.array(z.looseObject({ kind: z.string() })).optional() }).optional(),
})

const errorCode = (error: unknown): string | undefined => {
  const parsed = remoteFailureSchema.safeParse(error)
  return parsed.success ? parsed.data.code : undefined
}

const pluginCode = (code: string | undefined): string => (code !== undefined && /^[a-z][a-z0-9-]{0,63}$/u.test(code) ? code : 'action-failed')

const failure = (error: unknown, message: string): PluginApiError => {
  const code = errorCode(error)
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

const activityKinds = (error: unknown): string[] => {
  const parsed = remoteFailureSchema.safeParse(error)
  if (!parsed.success) return []
  return (parsed.data.details?.activity ?? []).map(entry => entry.kind)
}

const callerSessionId = (caller: ApiCaller): string | undefined => (caller.kind === 'agent' ? caller.sessionId : undefined)

const targetSessionId = (requested: string | undefined, caller: ApiCaller): string => {
  const sessionId = requested ?? callerSessionId(caller)
  if (sessionId === undefined) {
    throw new PluginApiError('Pass sessionId: this tool cannot tell which thread to act on.', {
      code: 'thread-target-unknown',
    })
  }
  return sessionId
}

const matches = (query: string, summary: ThreadSummary, title: string | undefined, project: ProjectRow | undefined): boolean =>
  (title ?? '').toLowerCase().includes(query) ||
  summary.sessionId.toLowerCase().includes(query) ||
  (summary.cwd ?? '').toLowerCase().includes(query) ||
  (project?.title ?? '').toLowerCase().includes(query)

/** Builds the thread and project actions over the injected Host services. */
export const createThreadActions = (deps: ThreadActionDeps) => ({
  list: async ({ input, signal }: ThreadActionContext<ThreadListInput>) => {
    const sessions = await deps.listSessions(signal)
    const projects = deps.projects()
    const archived = new Set(deps.archivedSessionIds())
    const pinned = new Set(deps.pinnedSessionIds())
    const projectOf = new Map<string, ProjectRow>()
    for (const project of projects) {
      for (const sessionId of project.sessionIds) projectOf.set(sessionId, project)
    }

    const includeArchived = input.includeArchived === true
    const recent = [...sessions].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, TITLE_BUDGET)
    const titles = await deps.readTitles(
      recent.filter(summary => includeArchived || !archived.has(summary.sessionId)).map(summary => summary.sessionId),
      signal,
    )

    const query = input.query?.trim().toLowerCase()
    const rows: ThreadListRow[] = []
    for (const summary of recent) {
      const isArchived = archived.has(summary.sessionId)
      if (isArchived && !includeArchived) continue
      const title = titles.get(summary.sessionId)
      const project = projectOf.get(summary.sessionId)
      if (query !== undefined && query.length > 0 && !matches(query, summary, title, project)) continue
      rows.push({
        sessionId: summary.sessionId,
        ...(title === undefined ? undefined : { title }),
        ...(project === undefined ? undefined : { projectId: project.projectId, projectTitle: project.title }),
        ...(summary.cwd === undefined ? undefined : { cwd: summary.cwd }),
        running: summary.running,
        liveAgent: summary.agentAvailable,
        archived: isArchived,
        pinned: pinned.has(summary.sessionId),
        updatedAt: summary.updatedAt,
      })
    }

    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, rows.length)
    return { threads: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit }
  },

  archive: async ({ input, caller }: ThreadActionContext<ThreadArchiveInput>) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    const stopActivity = input.stopActivity === true
    try {
      const archivedSessionIds = await deps.archive(sessionId, stopActivity)
      return { status: 'archived' as const, sessionId, archivedSessionIds: [...archivedSessionIds], activity: [] }
    } catch (error) {
      if (errorCode(error) === 'workspace/session-active') {
        return {
          status: 'refused-active' as const,
          sessionId,
          archivedSessionIds: [...deps.archivedSessionIds()],
          activity: activityKinds(error),
        }
      }
      throw failure(error, `Could not archive thread ${sessionId}.`)
    }
  },

  unarchive: async ({ input }: ThreadActionContext<ThreadTargetInput>) => {
    try {
      const archivedSessionIds = await deps.unarchive(input.sessionId)
      return { sessionId: input.sessionId, archivedSessionIds: [...archivedSessionIds] }
    } catch (error) {
      throw failure(error, `Could not restore thread ${input.sessionId}.`)
    }
  },

  pin: async ({ input }: ThreadActionContext<ThreadTargetInput>) => {
    try {
      const pinnedSessionIds = await deps.pin(input.sessionId)
      return { sessionId: input.sessionId, pinnedSessionIds: [...pinnedSessionIds] }
    } catch (error) {
      throw failure(error, `Could not pin thread ${input.sessionId}.`)
    }
  },

  unpin: async ({ input }: ThreadActionContext<ThreadTargetInput>) => {
    try {
      const pinnedSessionIds = await deps.unpin(input.sessionId)
      return { sessionId: input.sessionId, pinnedSessionIds: [...pinnedSessionIds] }
    } catch (error) {
      throw failure(error, `Could not unpin thread ${input.sessionId}.`)
    }
  },

  rename: async ({ input, caller }: ThreadActionContext<ThreadRenameInput>) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    try {
      const renamed = await deps.rename(sessionId, input.title)
      return { sessionId, title: renamed.title }
    } catch (error) {
      throw failure(error, `Could not rename thread ${sessionId}.`)
    }
  },

  fork: async ({ input, caller, signal }: ThreadActionContext<ThreadForkInput>) => {
    signal.throwIfAborted()
    const sessionId = targetSessionId(input.sessionId, caller)
    try {
      const forked = await deps.fork(sessionId, input.atSeq)
      return { sessionId, forkedSessionId: forked.sessionId }
    } catch (error) {
      throw failure(error, `Could not fork thread ${sessionId}.`)
    }
  },

  create: async ({ input }: ThreadActionContext<ThreadCreateInput>) => {
    let created: { readonly sessionId: string; readonly agentPreset?: string }
    try {
      created = await deps.create({
        ...(input.projectId === undefined ? undefined : { projectId: input.projectId }),
        ...(input.cwd === undefined ? undefined : { cwd: input.cwd }),
        ...(input.agentPreset === undefined ? undefined : { agentPreset: input.agentPreset }),
      })
    } catch (error) {
      throw failure(error, 'Could not start a new thread.')
    }
    if (input.title === undefined) {
      return {
        sessionId: created.sessionId,
        ...(created.agentPreset === undefined ? undefined : { agentPreset: created.agentPreset }),
      }
    }
    // The thread already exists; a refused title must not hide the new id from the caller.
    try {
      const renamed = await deps.rename(created.sessionId, input.title)
      return {
        sessionId: created.sessionId,
        title: renamed.title,
        ...(created.agentPreset === undefined ? undefined : { agentPreset: created.agentPreset }),
      }
    } catch {
      return {
        sessionId: created.sessionId,
        ...(created.agentPreset === undefined ? undefined : { agentPreset: created.agentPreset }),
      }
    }
  },

  stop: async ({ input }: ThreadActionContext<ThreadTargetInput>) => {
    try {
      await deps.stop(input.sessionId)
      return { sessionId: input.sessionId, accepted: true as const }
    } catch (error) {
      throw failure(error, `Could not stop thread ${input.sessionId}.`)
    }
  },

  selectModel: async ({ input, caller }: ThreadActionContext<ThreadSelectModelInput>) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    try {
      const selected = await deps.selectModel({
        sessionId,
        provider: input.provider,
        model: input.model,
        ...(input.reasoningEffort === undefined ? undefined : { reasoningEffort: input.reasoningEffort }),
      })
      return {
        sessionId,
        provider: selected.provider,
        model: selected.model,
        ...(selected.reasoningEffort === undefined ? undefined : { reasoningEffort: selected.reasoningEffort }),
      }
    } catch (error) {
      throw failure(error, `Could not select a model for thread ${sessionId}.`)
    }
  },

  projectList: async () => ({
    projects: deps.projects().map(project => ({
      projectId: project.projectId,
      title: project.title,
      path: project.path,
      threadCount: project.sessionIds.length,
    })),
  }),

  projectRegister: async ({ input }: ThreadActionContext<ProjectRegisterInput>) => {
    try {
      return await deps.registerProject(input.path, input.title)
    } catch (error) {
      throw failure(error, `Could not register ${input.path} as a project.`)
    }
  },

  projectRename: async ({ input }: ThreadActionContext<ProjectRenameInput>) => {
    try {
      return await deps.renameProject(input.projectId, input.title)
    } catch (error) {
      throw failure(error, `Could not rename project ${input.projectId}.`)
    }
  },

  projectDelete: async ({ input }: ThreadActionContext<ProjectDeleteInput>) => {
    try {
      await deps.deleteProject(input.projectId)
      return { projectId: input.projectId, deleted: true as const }
    } catch (error) {
      throw failure(error, `Could not remove project ${input.projectId}.`)
    }
  },

  projectReorder: async ({ input }: ThreadActionContext<ProjectReorderInput>) => {
    try {
      const projectIds = await deps.reorderProject(input.projectId, input.beforeProjectId)
      return { projectIds: [...projectIds] }
    } catch (error) {
      throw failure(error, `Could not reorder project ${input.projectId}.`)
    }
  },

  move: async ({ input }: ThreadActionContext<ThreadMoveInput>) => {
    try {
      const sessionIds = await deps.moveSession(input.projectId, input.sessionId, input.beforeSessionId)
      return { sessionId: input.sessionId, projectId: input.projectId, sessionIds: [...sessionIds] }
    } catch (error) {
      throw failure(error, `Could not move thread ${input.sessionId}.`)
    }
  },
})
