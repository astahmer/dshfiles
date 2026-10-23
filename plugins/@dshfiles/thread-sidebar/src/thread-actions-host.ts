import { randomUUID } from 'node:crypto'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { createHostApiClient, defineCommand, type CommandInvocation, type CommandResult } from '@dshfiles/dshx/host'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { continuationApi } from '@dshfiles/session-controller/continuation-api'
import { createThreadActions, type ThreadActionDeps } from './thread-actions.js'
import { threadActionsApi } from './thread-actions-api.js'
import { setSessionSettled, settledSessionIdsFromHost } from './settings.js'

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
  listThreadRelations: async () =>
    (await requireContext().sessionQuery.listSessions()).map(record => ({
      sessionId: record.header.id,
      parentSessionId: record.header.parentSession ?? null,
      ...(record.header.origin === undefined ? undefined : { origin: record.header.origin }),
    })),
  searchThreadContent: async (query, limit, signal) => {
    const page = await requireContext().sessionQuery.searchSessions({ query, eventFilters: [{ kind: 'type', values: ['user/message'] }], limit }, { signal })
    return page.items.map(hit => ({ sessionId: hit.header.id }))
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
  settledSessionIds: () => settledSessionIdsFromHost(),
  setSettled: (sessionId, settled) => setSessionSettled(sessionId, settled),
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
  continueIn: async input => createHostApiClient(requireContext(), continuationApi, '@dshfiles/thread-sidebar').continueIn(input),
  create: async input =>
    requireContext().sessionController.create({
      ...(input.projectId === undefined ? undefined : { workspaceId: WorkspaceId(input.projectId) }),
      ...(input.cwd === undefined ? undefined : { cwd: input.cwd }),
      ...(input.agentPreset === undefined ? undefined : { agentPreset: input.agentPreset }),
    }),
  prompt: async input => {
    // SAFETY: SessionRequestId is a type-only brand over a client-minted unique id.
    const requestId = randomUUID() as SessionRequestId
    await requireContext().sessionController.prompt(
      { requestId, sessionId: SessionId(input.sessionId), mode: input.mode, content: [{ type: 'text', text: input.text }] },
      AbortSignal.timeout(15_000),
    )
  },
  ownWorkspaceFor: async projectId => {
    const jj = createHostApiClient(requireContext(), jjIntegrationApi, '@dshfiles/thread-sidebar')
    try {
      return (await jj.ownWorkspaceFor({ workspaceId: projectId })).workspaceId
    } catch (error) {
      // Without jj-integration nothing isolates threads; any other failure must not fall back to a shared checkout.
      if (error instanceof Error && isApiOwnerMissing(error)) return projectId
      throw error
    }
  },
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
const actions = createThreadActions(dependencies)

export const threadActionsHost = threadActionsApi.host(actions)

const settleCommand = defineCommand({
  name: 'settle',
  description: 'Settle this thread so it will not run another model step until unsettled.',
  handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
    if (invocation.rawInput.trim().length > 0) return { kind: 'error', text: 'Usage: /settle' }
    try {
      const result = await actions.settle({
        input: {},
        caller: { kind: 'agent', sessionId: invocation.agent.id },
        signal: invocation.signal,
      })
      return { kind: 'success', text: `Settled thread ${result.sessionId}.` }
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
  },
})

const archiveCommand = defineCommand({
  name: 'archive',
  description: 'Archive this thread without stopping any running work.',
  handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
    if (invocation.rawInput.trim().length > 0) return { kind: 'error', text: 'Usage: /archive' }
    try {
      const result = await actions.archive({
        input: {},
        caller: { kind: 'agent', sessionId: invocation.agent.id },
        signal: invocation.signal,
      })
      if (result.status === 'refused-active') {
        return {
          kind: 'error',
          text: `Cannot archive thread ${result.sessionId} while it has running work (${result.activity.join(', ') || 'activity unknown'}). Stop it first, then run /archive again.`,
        }
      }
      return { kind: 'success', text: `Archived thread ${result.sessionId}.` }
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
  },
})

export const threadActionCommands = [settleCommand, archiveCommand]
