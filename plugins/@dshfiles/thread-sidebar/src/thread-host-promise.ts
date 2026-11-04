import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { HostContext } from '@dshfiles/dshx/effect'
import { HostCommands } from '@dshfiles/dshx/effect/host-commands'
import { createHostApiClient, type CommandResult } from '@dshfiles/dshx/host'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { continuationApi } from '@dshfiles/session-controller/continuation-api'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { Context, Effect, Layer } from 'effect'
import { ThreadHostCallFailed } from './sidebar-errors.js'
import { SidebarSettings } from './sidebar-settings.js'
import { createThreadActions, type HostEffect, type ThreadActionDeps, type ThreadActionSet } from './thread-actions.js'

const PROMPT_TIMEOUT_MS = 15_000

const host = <A>(run: (signal: AbortSignal) => Promise<A>): HostEffect<A> =>
  Effect.tryPromise({ try: run, catch: cause => new ThreadHostCallFailed({ cause }) })

/** The thread and project lifecycle verbs, run against the live Session controller and workspace registry. */
export class ThreadActions extends Context.Service<ThreadActions, ThreadActionSet>()('@dshfiles/thread-sidebar/ThreadActions') {
  static readonly layer = Layer.effect(
    ThreadActions,
    Effect.gen(function* () {
      const { ctx, packageId } = yield* HostContext
      const settings = yield* SidebarSettings
      const sessions = createHostApiClient(ctx, sessionsApi, packageId)
      const continuation = createHostApiClient(ctx, continuationApi, packageId)
      const jj = createHostApiClient(ctx, jjIntegrationApi, packageId)

      const unpin = (sessionId: string) => host(() => ctx.workspaceController.unpinSession({ sessionId: SessionId(sessionId) }))

      const deps: ThreadActionDeps = {
        listSessions: () =>
          host(signal => ctx.sessionController.list({}, signal)).pipe(
            Effect.map(listed =>
              listed.items.map(summary => ({
                sessionId: summary.sessionId,
                updatedAt: summary.updatedAt,
                running: summary.running,
                agentAvailable: summary.agentAvailable,
                ...(summary.cwd === undefined ? undefined : { cwd: summary.cwd }),
              })),
            ),
          ),
        readTitles: sessionIds =>
          host(signal =>
            ctx.sessionQuery.readTitleSnapshots(
              sessionIds.map(id => SessionId(id)),
              signal,
            ),
          ).pipe(
            Effect.map(results => {
              const titles = new Map<string, string>()
              for (const result of results) {
                if (result.status !== 'fulfilled') continue
                const snapshot = result.value.title
                if (snapshot !== undefined) titles.set(result.sessionId, snapshot.title)
              }
              return titles
            }),
          ),
        listThreadRelations: () =>
          host(() => ctx.sessionQuery.listSessions()).pipe(
            Effect.map(records =>
              records.map(record => ({
                sessionId: record.header.id,
                parentSessionId: record.header.parentSession ?? null,
                ...(record.header.origin === undefined ? undefined : { origin: record.header.origin }),
              })),
            ),
          ),
        searchThreadContent: (query, limit) =>
          host(signal => ctx.sessionQuery.searchSessions({ query, eventFilters: [{ kind: 'type', values: ['user/message'] }], limit }, { signal })).pipe(
            Effect.map(page => page.items.map(hit => ({ sessionId: hit.header.id }))),
          ),
        projects: () =>
          ctx.workspaceRegistry.list().map(workspace => ({
            projectId: workspace.id,
            title: workspace.title,
            path: workspace.path,
            sessionIds: [...workspace.sessionIds],
          })),
        archivedSessionIds: () => [...ctx.workspaceRegistry.archivedSessionIds],
        pinnedSessionIds: () => [...ctx.workspaceRegistry.pinnedSessionIds],
        settledSessionIds: settings.settledSessionIdsNow,
        setSettled: (sessionId, settled) =>
          Effect.gen(function* () {
            // A settled thread belongs in Settled, never pinned above it.
            if (settled && ctx.workspaceRegistry.pinnedSessionIds.includes(SessionId(sessionId))) yield* unpin(sessionId)
            return yield* settings.setSettled({ sessionId, settled }).pipe(Effect.mapError(cause => new ThreadHostCallFailed({ cause })))
          }),
        archive: (sessionId, stopActivity) =>
          host(() => ctx.workspaceController.archiveSession({ sessionId: SessionId(sessionId), stopActivity })).pipe(
            Effect.map(value => value.archivedSessionIds),
          ),
        unarchive: sessionId =>
          host(() => ctx.workspaceController.unarchiveSession({ sessionId: SessionId(sessionId) })).pipe(Effect.map(value => value.archivedSessionIds)),
        pin: sessionId => host(() => ctx.workspaceController.pinSession({ sessionId: SessionId(sessionId) })).pipe(Effect.map(value => value.pinnedSessionIds)),
        unpin: sessionId => unpin(sessionId).pipe(Effect.map(value => value.pinnedSessionIds)),
        rename: (sessionId, title) => host(() => ctx.sessionController.rename({ sessionId: SessionId(sessionId), title })),
        fork: (sessionId, atSeq) =>
          host(() => ctx.sessionController.fork({ sessionId: SessionId(sessionId), ...(atSeq === undefined ? undefined : { atSeq }) })),
        continueIn: input => host(signal => continuation.continueIn(input, { signal })),
        create: input =>
          host(signal =>
            sessions.create(
              {
                ...(input.projectId === undefined ? undefined : { projectId: input.projectId }),
                ...(input.cwd === undefined ? undefined : { cwd: input.cwd }),
                ...(input.agentPreset === undefined ? undefined : { agentPreset: input.agentPreset }),
              },
              { signal },
            ),
          ),
        prompt: input =>
          host(signal =>
            sessions.prompt(
              { sessionId: input.sessionId, mode: input.mode, text: input.text },
              { signal: AbortSignal.any([signal, AbortSignal.timeout(PROMPT_TIMEOUT_MS)]) },
            ),
          ).pipe(Effect.asVoid),
        ownWorkspaceFor: projectId =>
          host(signal => jj.ownWorkspaceFor({ workspaceId: projectId }, { signal })).pipe(
            Effect.map(value => value.workspaceId),
            // Without jj-integration nothing isolates threads; any other failure must not fall back to a shared checkout.
            Effect.catchTag('ThreadHostCallFailed', error =>
              error.cause instanceof Error && isApiOwnerMissing(error.cause) ? Effect.succeed(projectId) : Effect.fail(error),
            ),
          ),
        stop: sessionId => host(signal => sessions.interrupt({ sessionId }, { signal })).pipe(Effect.asVoid),
        selectModel: input =>
          host(signal =>
            sessions.selectModel(
              {
                sessionId: input.sessionId,
                provider: input.provider,
                model: input.model,
                ...(input.reasoningEffort === undefined ? undefined : { reasoningEffort: input.reasoningEffort }),
              },
              { signal },
            ),
          ).pipe(
            Effect.map(selected => ({
              provider: selected.provider,
              model: selected.model,
              ...(selected.reasoningEffort === undefined ? undefined : { reasoningEffort: selected.reasoningEffort }),
            })),
          ),
        registerProject: (path, title) =>
          host(async () => {
            const created = await ctx.workspaceController.create({ path })
            const workspace = created.workspace
            if (!created.created || title === undefined || title === workspace.title) {
              return { projectId: workspace.workspaceId, title: workspace.title, path: workspace.path, created: created.created }
            }
            const renamed = await ctx.workspaceController.rename({ workspaceId: workspace.workspaceId, title })
            return { projectId: renamed.workspace.workspaceId, title: renamed.workspace.title, path: renamed.workspace.path, created: true }
          }),
        renameProject: (projectId, title) =>
          host(() => ctx.workspaceController.rename({ workspaceId: WorkspaceId(projectId), title })).pipe(
            Effect.map(value => ({ projectId: value.workspace.workspaceId, title: value.workspace.title })),
          ),
        deleteProject: projectId => host(() => ctx.workspaceController.delete({ workspaceId: WorkspaceId(projectId) })).pipe(Effect.asVoid),
        reorderProject: (projectId, beforeProjectId) =>
          host(() =>
            ctx.workspaceController.insertBefore({
              workspaceId: WorkspaceId(projectId),
              ...(beforeProjectId === undefined ? undefined : { beforeWorkspaceId: WorkspaceId(beforeProjectId) }),
            }),
          ).pipe(Effect.map(value => value.workspaceIds)),
        moveSession: (projectId, sessionId, beforeSessionId) =>
          host(() =>
            ctx.workspaceController.insertSessionBefore({
              workspaceId: WorkspaceId(projectId),
              sessionId: SessionId(sessionId),
              ...(beforeSessionId === undefined ? undefined : { beforeSessionId: SessionId(beforeSessionId) }),
            }),
          ).pipe(Effect.map(value => value.workspace.sessionIds)),
      }
      return ThreadActions.of(createThreadActions(deps))
    }),
  )
}

const commandText = (error: { readonly message: string }): CommandResult => ({ kind: 'error', text: error.message })

/** `/settle` and `/archive`: the calling thread's own lifecycle verbs, registered for the plugin's lifetime. */
export const threadCommandsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const actions = yield* ThreadActions
    yield* HostCommands.register({
      name: 'settle',
      description: 'Settle this thread so it will not run another model step until unsettled.',
      handler: invocation =>
        invocation.rawInput.trim().length > 0
          ? Effect.succeed<CommandResult>({ kind: 'error', text: 'Usage: /settle' })
          : actions.settle({ input: {}, caller: { kind: 'agent', sessionId: invocation.agent.id } }).pipe(
              Effect.map((result): CommandResult => ({ kind: 'success', text: `Settled thread ${result.sessionId}.` })),
              Effect.catch(error => Effect.succeed(commandText(error))),
            ),
    })
    yield* HostCommands.register({
      name: 'archive',
      description: 'Archive this thread without stopping any running work.',
      handler: invocation =>
        invocation.rawInput.trim().length > 0
          ? Effect.succeed<CommandResult>({ kind: 'error', text: 'Usage: /archive' })
          : actions.archive({ input: {}, caller: { kind: 'agent', sessionId: invocation.agent.id } }).pipe(
              Effect.map((result): CommandResult =>
                result.status === 'refused-active'
                  ? {
                      kind: 'error',
                      text: `Cannot archive thread ${result.sessionId} while it has running work (${result.activity.join(', ') || 'activity unknown'}). Stop it first, then run /archive again.`,
                    }
                  : { kind: 'success', text: `Archived thread ${result.sessionId}.` },
              ),
              Effect.catch(error => Effect.succeed(commandText(error))),
            ),
    })
  }),
)
