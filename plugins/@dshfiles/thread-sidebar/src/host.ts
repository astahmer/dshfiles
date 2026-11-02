import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-questions'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { homedir } from 'node:os'
import { threadSidebarAttentionApi } from './attention-api.js'
import { ThreadAttention } from './attention-store.js'
import { threadSidebarAutoSettleApi } from './auto-settle-api.js'
import { AutoSettle, AutoSettleSources } from './auto-settle-host.js'
import { ClientModules } from './client-modules-promise.js'
import { InflightTurns } from './inflight-turns.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { MachineName } from './machine-name.js'
import { OutsideReload } from './outside-reload-promise.js'
import { threadSidebarPendingQuestionsApi } from './pending-questions-api.js'
import { threadSidebarPluginUpdatesApi } from './plugin-updates-api.js'
import { PluginUpdateWatch } from './plugin-updates.js'
import { threadQueueApi } from './queue-api.js'
import { threadQueueHandlers } from './queue-host.js'
import { Recoveries, bootRecovery } from './recoveries.js'
import { threadSidebarRecoveryApi } from './recovery-api.js'
import { threadSidebarRestartApi } from './restart-api.js'
import { RecoveryStore } from './restart-recovery.js'
import { RestartControl, RestartDrain } from './restart.js'
import { StateFiles } from './runtime-files.js'
import { SessionEvents, attentionRecorder, inflightTracker } from './session-events.js'
import { threadSidebarSessionArchiveApi } from './session-archive-api.js'
import { threadSidebarSettings } from './settings.js'
import { underSettledSession } from './settled-gate.js'
import { SidebarHost } from './sidebar-host-promise.js'
import { SidebarSettings } from './sidebar-settings.js'
import { threadSidebarModelRouteProjection } from './subagent-provenance/projection.js'
import { threadActionsApi } from './thread-actions-api.js'
import { ThreadActions, threadCommandsLayer } from './thread-host-promise.js'
import { threadViewsApi } from './thread-views-api.js'
import { ThreadViews } from './thread-views-host.js'

/**
 * A settled Session runs no model step until it is unsettled: a late wake (subagent settlement, queued follow-up,
 * reminder) proposes a step this rejects, which the loop ends as `blocked` without a request. The gate answers
 * synchronously from the settled ids of the last committed settings revision, before the rest of the chain runs.
 */
const settledGate = Layer.effectDiscard(
  Effect.gen(function* () {
    const { ctx } = yield* HostContext
    const settings = yield* SidebarSettings
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        ctx.on('agent/pre-step', async (payload, next) => {
          const settled = underSettledSession({
            header: payload.agent.session.header,
            settledSessionIds: settings.settledSessionIdsNow(),
            // Live agents carry the durable headers of a chain the walk can still read; a settled parent
            // that is not live answers from the child's own recorded parentSession instead.
            parentHeader: sessionId => ctx.agents.list().find(candidate => String(candidate.id) === sessionId)?.session.header,
          })
          return settled ? { kind: 'reject' as const } : next()
        }),
      ),
      dispose => Effect.sync(dispose),
    )
  }),
)

/** The provenance projection that labels a subagent with the model route it ran on. */
const modelRouteProjection = Layer.effectDiscard(
  Effect.gen(function* () {
    const { ctx } = yield* HostContext
    yield* Effect.acquireRelease(
      Effect.sync(() => ctx.sessionProjections.register(threadSidebarModelRouteProjection)),
      unregister => Effect.sync(() => unregister()),
    )
  }),
)

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const hostEdge = Layer.mergeAll(
  SidebarHost.layer,
  StorageDomain.layer,
  OutsideReload.layer,
  SessionEvents.layer,
  DshChildProcessSpawner.layer,
  SidebarSettings.layer.pipe(Layer.provideMerge(Settings.layer(threadSidebarSettings))),
).pipe(Layer.provideMerge(platform))

const runtimeState = Layer.mergeAll(InflightTurns.layer, Recoveries.layer).pipe(Layer.provideMerge(RecoveryStore.layer), Layer.provideMerge(StateFiles.layer))

const restart = RestartDrain.layer.pipe(Layer.provideMerge(RestartControl.layerWith({ env: process.env, homeDirectory: homedir() })))

const autoSettle = AutoSettle.schedule().pipe(Layer.provideMerge(AutoSettle.layer), Layer.provideMerge(AutoSettleSources.layer))

const threads = threadCommandsLayer.pipe(Layer.provideMerge(Layer.mergeAll(ThreadActions.layer, ThreadViews.layer)))

const services = Layer.mergeAll(
  ThreadAttention.layer,
  restart,
  autoSettle,
  threads,
  ClientModules.layer.pipe(Layer.provideMerge(PluginUpdateWatch.layer)),
  MachineName.layer,
).pipe(Layer.provideMerge(runtimeState))

const workers = Layer.mergeAll(attentionRecorder, inflightTracker, bootRecovery, settledGate, modelRouteProjection)

const threadSidebarLayer = workers.pipe(Layer.provideMerge(services), Layer.provideMerge(hostEdge))

export default DshxPlugin.make({
  name: '@dshfiles/thread-sidebar',
  settings: [threadSidebarSettings],
  inject: [
    'agents',
    'commands',
    'connection',
    'sessionController',
    'sessionPersistence',
    'sessionProjections',
    'sessionQuery',
    'storageDomain',
    'subprocess',
    'workspaceController',
    'workspaceRegistry',
  ],
  layer: threadSidebarLayer,
  apis: [
    Api.bind(threadSidebarRestartApi, {
      availability: () =>
        Effect.gen(function* () {
          const control = yield* RestartControl
          return { available: control.available, pending: yield* RestartDrain.use(drain => drain.pending) }
        }),
      requestRestart: () => RestartControl.use(control => control.request),
      requestRestartWhenIdle: () => RestartDrain.use(drain => drain.request),
      cancelPendingRestart: () => RestartDrain.use(drain => drain.cancel),
      launchUrl: () => RestartControl.use(control => Effect.map(control.launchUrl, url => ({ url }))),
    }),
    Api.bind(threadSidebarRecoveryApi, {
      pending: () =>
        Recoveries.use(recoveries =>
          Effect.map(recoveries.pending, entries => ({
            sessionIds: entries.map(entry => entry.sessionId),
            entries: entries.map(entry => ({ sessionId: entry.sessionId, reason: entry.reason, interruptedAt: entry.interruptedAt })),
          })),
        ),
      resume: input => Recoveries.use(recoveries => Effect.map(recoveries.resume(input.sessionId), accepted => ({ accepted }))),
      dismiss: input => Recoveries.use(recoveries => Effect.map(recoveries.dismiss(input.sessionId), dismissed => ({ dismissed }))),
    }),
    Api.bind(threadSidebarMachineApi, {
      name: () => MachineName.use(machine => Effect.map(machine.name, name => ({ name }))),
    }),
    Api.bind(threadSidebarPluginUpdatesApi, {
      pending: () => ClientModules.use(modules => Effect.map(modules.pendingPlugins, plugins => ({ plugins: [...plugins] }))),
      clientUpdates: input => ClientModules.use(modules => modules.clientUpdates(input.revisions)),
    }),
    // One Session list answers every requested Session at once; observing each Session re-read its log per poll.
    Api.bind(threadSidebarPendingQuestionsApi, {
      active: input =>
        Effect.gen(function* () {
          if (input.sessionIds.length === 0) return { sessionIds: [] }
          const candidates = new Set<string>(input.sessionIds)
          const sessions = yield* SidebarHost.use(host => host.sessions)
          return { sessionIds: sessions.filter(item => candidates.has(item.sessionId) && item.pendingQuestions > 0).map(item => item.sessionId) }
        }),
    }),
    Api.bind(threadSidebarAttentionApi, {
      state: () => ThreadAttention.use(attention => attention.snapshot),
      acknowledge: input => ThreadAttention.use(attention => attention.acknowledge(input)),
      clearUnread: input => ThreadAttention.use(attention => attention.clearUnread(input)),
      clearUnreadMany: input => ThreadAttention.use(attention => attention.clearUnreadMany(input.entries)),
      markUnread: input => ThreadAttention.use(attention => attention.markUnread(input)),
      markUnreadMany: input => ThreadAttention.use(attention => attention.markUnreadMany(input.sessionIds)),
      migrate: input => ThreadAttention.use(attention => attention.migrate(input.entries)),
    }),
    Api.bind(threadSidebarSessionArchiveApi, {
      status: input =>
        SidebarHost.use(host =>
          Effect.map(host.archivedSessionIds, archived => {
            const requested = new Set(input.sessionIds)
            return { archivedSessionIds: archived.filter(sessionId => requested.has(sessionId)) }
          }),
        ),
    }),
    Api.bind(threadActionsApi, {
      list: (input, call) => ThreadActions.use(actions => actions.list({ input, caller: call.caller })),
      references: (input, call) => ThreadActions.use(actions => actions.references({ input, caller: call.caller })),
      archive: (input, call) => ThreadActions.use(actions => actions.archive({ input, caller: call.caller })),
      unarchive: (input, call) => ThreadActions.use(actions => actions.unarchive({ input, caller: call.caller })),
      settle: (input, call) => ThreadActions.use(actions => actions.settle({ input, caller: call.caller })),
      unsettle: (input, call) => ThreadActions.use(actions => actions.unsettle({ input, caller: call.caller })),
      pin: (input, call) => ThreadActions.use(actions => actions.pin({ input, caller: call.caller })),
      unpin: (input, call) => ThreadActions.use(actions => actions.unpin({ input, caller: call.caller })),
      rename: (input, call) => ThreadActions.use(actions => actions.rename({ input, caller: call.caller })),
      fork: (input, call) => ThreadActions.use(actions => actions.fork({ input, caller: call.caller })),
      continueIn: (input, call) => ThreadActions.use(actions => actions.continueIn({ input, caller: call.caller })),
      create: (input, call) => ThreadActions.use(actions => actions.create({ input, caller: call.caller })),
      prompt: (input, call) => ThreadActions.use(actions => actions.prompt({ input, caller: call.caller })),
      stop: (input, call) => ThreadActions.use(actions => actions.stop({ input, caller: call.caller })),
      selectModel: (input, call) => ThreadActions.use(actions => actions.selectModel({ input, caller: call.caller })),
      projectList: () => ThreadActions.use(actions => actions.projectList()),
      projectRegister: (input, call) => ThreadActions.use(actions => actions.projectRegister({ input, caller: call.caller })),
      projectRename: (input, call) => ThreadActions.use(actions => actions.projectRename({ input, caller: call.caller })),
      projectDelete: (input, call) => ThreadActions.use(actions => actions.projectDelete({ input, caller: call.caller })),
      projectReorder: (input, call) => ThreadActions.use(actions => actions.projectReorder({ input, caller: call.caller })),
      move: (input, call) => ThreadActions.use(actions => actions.move({ input, caller: call.caller })),
    }),
    Api.bind(threadQueueApi, threadQueueHandlers),
    Api.bind(threadViewsApi, {
      list: () => ThreadViews.use(views => views.list),
      get: input => ThreadViews.use(views => views.get(input)),
      create: input => ThreadViews.use(views => views.create(input)),
      update: input => ThreadViews.use(views => views.update(input)),
      delete: input => ThreadViews.use(views => views.delete(input)),
      move: input => ThreadViews.use(views => views.move(input)),
      select: input => ThreadViews.use(views => views.select(input)),
    }),
    Api.bind(threadSidebarAutoSettleApi, {
      status: () => AutoSettle.use(autoSettle => autoSettle.status),
      requestSettle: input => AutoSettle.use(autoSettle => autoSettle.requestSettle(input)),
    }),
  ],
})
