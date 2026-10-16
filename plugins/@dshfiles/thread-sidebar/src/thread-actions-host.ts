import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { createThreadActions, type ThreadActionDeps } from './thread-actions.js'
import { threadActionsApi } from './thread-actions-api.js'

let hostContext: Context | undefined

/** The Host is assigned in `setup`; every dependency resolves it on call, never at module load. */
export const setThreadActionsContext = (ctx: Context): void => {
  hostContext = ctx
}

const requireContext = (): Context => {
  if (hostContext === undefined) throw new Error('Thread actions Host is not active.')
  return hostContext
}

const dependencies: ThreadActionDeps = {
  listSessions: async signal => {
    const { items } = await requireContext().sessionController.list({}, signal)
    return items.map(summary => ({
      sessionId: summary.sessionId,
      updatedAt: summary.updatedAt,
      running: summary.running,
      agentAvailable: summary.agentAvailable,
      ...(summary.cwd === undefined ? undefined : { cwd: summary.cwd }),
    }))
  },
  readTitles: async (sessionIds, signal) => {
    const results = await requireContext().sessionQuery.readTitleSnapshots(
      sessionIds.map(id => SessionId(id)),
      signal,
    )
    const titles = new Map<string, string>()
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      const snapshot = result.value.title
      if (snapshot !== undefined) titles.set(result.sessionId, snapshot.title)
    }
    return titles
  },
  projects: () =>
    requireContext()
      .workspaceRegistry.list()
      .map(workspace => ({
        projectId: workspace.id,
        title: workspace.title,
        path: workspace.path,
        sessionIds: [...workspace.sessionIds],
      })),
  archivedSessionIds: () => [...requireContext().workspaceRegistry.archivedSessionIds],
  pinnedSessionIds: () => [...requireContext().workspaceRegistry.pinnedSessionIds],
  archive: async (sessionId, stopActivity) => {
    const value = await requireContext().workspaceController.archiveSession({ sessionId: SessionId(sessionId), stopActivity })
    return value.archivedSessionIds
  },
  unarchive: async sessionId => (await requireContext().workspaceController.unarchiveSession({ sessionId: SessionId(sessionId) })).archivedSessionIds,
  pin: async sessionId => (await requireContext().workspaceController.pinSession({ sessionId: SessionId(sessionId) })).pinnedSessionIds,
  unpin: async sessionId => (await requireContext().workspaceController.unpinSession({ sessionId: SessionId(sessionId) })).pinnedSessionIds,
  rename: async (sessionId, title) => requireContext().sessionController.rename({ sessionId: SessionId(sessionId), title }),
  fork: async (sessionId, atSeq) =>
    requireContext().sessionController.fork({ sessionId: SessionId(sessionId), ...(atSeq === undefined ? undefined : { atSeq }) }),
  create: async input =>
    requireContext().sessionController.create({
      ...(input.projectId === undefined ? undefined : { workspaceId: WorkspaceId(input.projectId) }),
      ...(input.cwd === undefined ? undefined : { cwd: input.cwd }),
      ...(input.agentPreset === undefined ? undefined : { agentPreset: input.agentPreset }),
    }),
  stop: async sessionId => {
    requireContext().sessionController.cancel({ sessionId: SessionId(sessionId) })
  },
  selectModel: async input => {
    const value = await requireContext().sessionController.selectModel({
      sessionId: SessionId(input.sessionId),
      provider: input.provider,
      model: input.model,
      ...(input.reasoningEffort === undefined ? undefined : { reasoningEffort: input.reasoningEffort }),
    })
    return value.selected
  },
  registerProject: async (path, title) => {
    const controller = requireContext().workspaceController
    const created = await controller.create({ path })
    const workspace = created.workspace
    if (!created.created || title === undefined || title === workspace.title) {
      return { projectId: workspace.workspaceId, title: workspace.title, path: workspace.path, created: created.created }
    }
    const renamed = await controller.rename({ workspaceId: workspace.workspaceId, title })
    return { projectId: renamed.workspace.workspaceId, title: renamed.workspace.title, path: renamed.workspace.path, created: true }
  },
  renameProject: async (projectId, title) => {
    const value = await requireContext().workspaceController.rename({ workspaceId: WorkspaceId(projectId), title })
    return { projectId: value.workspace.workspaceId, title: value.workspace.title }
  },
  deleteProject: async projectId => {
    await requireContext().workspaceController.delete({ workspaceId: WorkspaceId(projectId) })
  },
  reorderProject: async (projectId, beforeProjectId) =>
    (
      await requireContext().workspaceController.insertBefore({
        workspaceId: WorkspaceId(projectId),
        ...(beforeProjectId === undefined ? undefined : { beforeWorkspaceId: WorkspaceId(beforeProjectId) }),
      })
    ).workspaceIds,
  moveSession: async (projectId, sessionId, beforeSessionId) =>
    (
      await requireContext().workspaceController.insertSessionBefore({
        workspaceId: WorkspaceId(projectId),
        sessionId: SessionId(sessionId),
        ...(beforeSessionId === undefined ? undefined : { beforeSessionId: SessionId(beforeSessionId) }),
      })
    ).workspace.sessionIds,
}

/** The thread and project lifecycle tools, wired to the live Host services on each call. */
export const threadActionsHost = threadActionsApi.host(createThreadActions(dependencies))
