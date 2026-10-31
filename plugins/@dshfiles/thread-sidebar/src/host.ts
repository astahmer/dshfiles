import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-user-questions'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { createHostApiClient, defineHost, scheduleOutsideReload } from '@dshfiles/dshx/host'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { Effect } from 'effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { z } from 'zod'
import { withSpan } from '@dshfiles/dshx/tracing'
import { attentionFor, closeAttention, threadAttentionApiHost } from './attention-host.js'
import { threadSidebarAutoSettleApi } from './auto-settle-api.js'
import { createAutoSettleScanner, type AutoSettleScanner, type AutoSettleSources } from './auto-settle-host.js'
import { SidebarOrganization } from './organization.js'
import { ThreadAttentionStoreModel } from './attention-store.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { threadSidebarPendingQuestionsApi } from './pending-questions-api.js'
import { threadSidebarPluginUpdatesApi } from './plugin-updates-api.js'
import { threadSidebarRecoveryApi } from './recovery-api.js'
import { createPluginUpdateWatch, staleClientEntries, type ClientEntryRevision } from './plugin-updates.js'
import { threadSidebarRestartApi } from './restart-api.js'
import { threadSidebarSessionArchiveApi } from './session-archive-api.js'
import { RestartEffects, RestartRuntime } from './restart-effect.js'
import { InflightTurns } from './inflight-turns.js'
import { activeRestartSessionIds, createRestartRecoveryStore } from './restart-recovery.js'
import { createRestartController, readLaunchUrl } from './restart.js'
import { AutoSettleSettings, RestartResumeSetting, settledSessionIdsFromHost, threadSidebarHostSettings } from './settings.js'
import { underSettledSession } from './settled-gate.js'
import { threadSidebarModelRouteProjection } from './subagent-provenance/projection.js'
import { setThreadActionsContext, threadActionsHost, threadActionCommands } from './thread-actions-host.js'
import { threadQueueHost } from './queue-host.js'
import { threadViewsHost } from './thread-views-host.js'

const restartRecoveryStore = createRestartRecoveryStore()
const inflightTurns = InflightTurns.open()

const restartController = (ctx: Context) =>
  createRestartController(ctx, {
    recordRunningSessions: async () => {
      const persistence = ctx.sessionPersistence
      if (persistence === undefined) throw new Error('Session persistence is unavailable.')
      await persistence.flush()
      await restartRecoveryStore.record(activeRestartSessionIds(ctx.agents.list()), 'restart')
    },
    onExitFailure: () => console.error('thread-sidebar: managed restart was canceled because running-thread recovery could not be saved'),
  })

const { hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: RestartEffects.layer,
  setup: (ctx: Context) =>
    Effect.gen(function* () {
      const runtime = yield* RestartRuntime
      yield* Effect.sync(() => setupHost(ctx))
      const bootedAt = Date.now()
      const promoted = yield* Effect.sync(() => InflightTurns.promote({ inflight: inflightTurns, recovery: restartRecoveryStore }).catch(() => []))
      yield* RestartEffects.restartWhenIdleLoop(runtime, {
        drainLimitMs: DRAIN_LIMIT_MS,
        now: Date.now,
        pollIntervalMs: DRAIN_POLL_MS,
        reportFailure: error =>
          ctx.logger.warn('thread-sidebar: the restart waiting for idle could not start: %s', error instanceof Error ? error.message : String(error)),
        restart: async () => {
          await restartController(ctx).request()
        },
        runningTurns: () => runningTurns(ctx),
      }).pipe(Effect.forkScoped)
      yield* RestartEffects.resumeAfterBoot({
        delayMs: AUTO_RESUME_DELAY_MS,
        promote: Effect.tryPromise({ try: () => promoted, catch: () => undefined }).pipe(
          Effect.catch(() => Effect.succeed([])),
          Effect.asVoid,
        ),
        resume: Effect.tryPromise({ try: () => resumeAfterBoot(ctx, bootedAt), catch: () => undefined }).pipe(Effect.catch(() => Effect.void)),
      }).pipe(Effect.forkScoped)
    }),
})

const sessionArchiveApi = hostApi(threadSidebarSessionArchiveApi, {
  status: Effect.fn('thread-sidebar archived sessions read')(({ ctx, input }) =>
    Effect.sync(() => {
      const requestedSessionIds = new Set(input.sessionIds)
      return {
        archivedSessionIds: ctx.workspaceRegistry.archivedSessionIds.filter(sessionId => requestedSessionIds.has(sessionId)),
      }
    }),
  ),
})

/** How often a pending restart looks for running turns, and how long it waits before restarting anyway. */
const DRAIN_POLL_MS = 2_000
const DRAIN_LIMIT_MS = 30 * 60_000

/**
 * One restart waiting for this Host to go idle. It restarts after two polls in a row find no running turn, so a
 * queued follow-up that starts right after a turn ends is not cut off; past the limit it restarts anyway, and the
 * managed restart records whatever still runs so it resumes after boot.
 */
const runningTurns = (ctx: Context): number => activeRestartSessionIds(ctx.agents.list()).length

const restartApi = hostApi(threadSidebarRestartApi, {
  availability: Effect.fn('thread-sidebar restart availability')(({ ctx }) =>
    Effect.gen(function* () {
      const runtime = yield* RestartRuntime
      const pending = yield* RestartEffects.readPendingRestart(runtime)
      return {
        available: restartController(ctx).available,
        pending: pending === undefined ? null : { since: pending.since, running: runningTurns(ctx) },
      }
    }),
  ),
  requestRestartWhenIdle: Effect.fn('thread-sidebar restart when idle')(({ ctx }) =>
    Effect.gen(function* () {
      const runtime = yield* RestartRuntime
      if (!restartController(ctx).available) throw new Error('This DSH process is not running under the managed restart launcher.')
      yield* RestartEffects.queueRestartWhenIdle(runtime, Date.now())
      return { accepted: true as const }
    }),
  ),
  cancelPendingRestart: Effect.fn('thread-sidebar pending restart cancel')(() =>
    Effect.gen(function* () {
      const runtime = yield* RestartRuntime
      return { canceled: yield* RestartEffects.cancelRestartWhenIdle(runtime) }
    }),
  ),
  launchUrl: Effect.fn('thread-sidebar launch URL read')(() => Effect.tryPromise({ try: async () => ({ url: await readLaunchUrl() }), catch: error => error })),
  requestRestart: Effect.fn('thread-sidebar restart request')(({ ctx }) =>
    Effect.tryPromise({
      try: () => restartController(ctx).request(),
      catch: () => new Error('Could not schedule a safe DSH restart.'),
    }),
  ),
})

const resumePrompt = [
  'Your previous turn was interrupted while DSH was restarting.',
  'Continue from the persisted transcript and current workspace state.',
  'First inspect the last assistant and tool events and verify the current state of the workspace.',
  'Do not repeat or assume success for any tool action whose result is missing; verify its effects before taking further action.',
  'If safe continuation is unclear, explain what needs human input instead of guessing.',
].join(' ')

/** Queue the fixed continuation prompt for one recovery row, once: its stable request id makes a repeat a no-op. */
const resumeRecovery = async (ctx: Context, sessionId: string): Promise<boolean> => {
  const entry = (await restartRecoveryStore.list()).find(candidate => candidate.sessionId === sessionId)
  if (entry === undefined) return false

  const active = ctx.agents.list().find(agent => agent.id === SessionId(sessionId))
  if (active?.status === 'running') {
    await restartRecoveryStore.complete(sessionId)
    return true
  }

  const controller = ctx.sessionController
  if (controller === undefined) throw new Error('Session resume is unavailable.')
  await controller.prompt(
    {
      // SAFETY: the persisted schema validated this request id as a UUID before it was branded here.
      requestId: entry.requestId as SessionRequestId,
      sessionId: SessionId(sessionId),
      mode: 'queue',
      content: [{ type: 'text', text: resumePrompt }],
    },
    AbortSignal.timeout(15_000),
  )
  await restartRecoveryStore.complete(sessionId)
  return true
}

/** Rows recorded this long before boot belong to the stop that just happened; older ones wait for a person. */
const AUTO_RESUME_WINDOW_MS = 30 * 60_000
/** Lets the session controller and providers finish activating before the first resumed turn starts. */
const AUTO_RESUME_DELAY_MS = 10_000

const resumeAfterBoot = async (ctx: Context, bootedAt: number): Promise<void> => {
  if (!RestartResumeSetting.enabled()) return
  const entries = (await restartRecoveryStore.list()).filter(entry => entry.interruptedAt >= bootedAt - AUTO_RESUME_WINDOW_MS)
  for (const entry of entries) {
    await resumeRecovery(ctx, entry.sessionId).catch((error: unknown) => {
      ctx.logger.warn('thread-sidebar: could not resume %s after the restart: %s', entry.sessionId, error instanceof Error ? error.message : String(error))
    })
  }
}

const recoveryApi = hostApi(threadSidebarRecoveryApi, {
  pending: Effect.fn('thread-sidebar recoveries read')(({ ctx }) =>
    Effect.tryPromise({
      try: async () => {
        await restartRecoveryStore.remove(new Set(activeRestartSessionIds(ctx.agents.list())))
        const entries = await restartRecoveryStore.list()
        return {
          sessionIds: entries.map(entry => entry.sessionId),
          entries: entries.map(entry => ({ sessionId: entry.sessionId, reason: entry.reason, interruptedAt: entry.interruptedAt })),
        }
      },
      catch: error => error,
    }),
  ),
  resume: Effect.fn('thread-sidebar recovery resume')(({ ctx, input }) =>
    Effect.tryPromise({ try: async () => ({ accepted: await resumeRecovery(ctx, input.sessionId) }), catch: error => error }),
  ),
  dismiss: Effect.fn('thread-sidebar recovery dismiss')(({ input }) =>
    Effect.tryPromise({
      try: async () => {
        const exists = (await restartRecoveryStore.list()).some(entry => entry.sessionId === input.sessionId)
        await restartRecoveryStore.dismiss(input.sessionId)
        return { dismissed: exists }
      },
      catch: error => error,
    }),
  ),
})

const execFileAsync = promisify(execFile)

const graphIdsSchema = z.object({ entries: z.array(z.object({ id: z.string(), rev: z.string().optional() })) })

/** The Finder computer name ("MacBook Pro de Alexandre") on macOS; elsewhere the short hostname. */
const readMachineName = async (): Promise<string> => {
  const shortHostname = hostname().replace(/\..*$/u, '')
  if (process.platform !== 'darwin') return shortHostname
  try {
    const { stdout } = await withSpan('machine name read', { kind: 'client', attributes: { 'process.executable.name': 'scutil' } }, () =>
      execFileAsync('scutil', ['--get', 'ComputerName'], { timeout: 1000 }),
    )
    return stdout.trim() || shortHostname
  } catch {
    return shortHostname
  }
}

let machineName: Promise<string> | undefined
const machineApi = hostApi(threadSidebarMachineApi, {
  name: Effect.fn('thread-sidebar machine name read')(() =>
    Effect.tryPromise({ try: async () => ({ name: await (machineName ??= readMachineName()) }), catch: error => error }),
  ),
})

let pluginUpdates: ReturnType<typeof createPluginUpdateWatch> | undefined
/** The client bundles the Host currently serves, read from the composition every page boots from. */
let servedClientRevisions: (() => readonly ClientEntryRevision[]) | undefined
const pluginUpdatesApi = hostApi(threadSidebarPluginUpdatesApi, {
  pending: Effect.fn('thread-sidebar plugin updates read')(() =>
    Effect.tryPromise({ try: async () => ({ plugins: (await pluginUpdates?.pending()) ?? [] }), catch: error => error }),
  ),
  clientUpdates: Effect.fn('thread-sidebar client updates read')(({ input }) =>
    Effect.sync(() => staleClientEntries({ page: input.revisions, served: servedClientRevisions?.() ?? [] })),
  ),
})

/**
 * One `sessionController.list` answers every requested Session at once. Observing each Session
 * separately re-read its log, which cost seconds per poll and pinned a browser connection with it.
 */
const pendingQuestionsApi = hostApi(threadSidebarPendingQuestionsApi, {
  active: Effect.fn('thread-sidebar active questions read')(({ ctx, input, signal }) =>
    Effect.tryPromise({
      try: async () => {
        if (input.sessionIds.length === 0) return { sessionIds: [] }
        const candidates = new Set<string>(input.sessionIds)
        const listed = await ctx.sessionController.list({}, signal)
        return {
          sessionIds: listed.items
            .filter(item => candidates.has(item.sessionId) && (item.projections?.values.userQuestions?.active.length ?? 0) > 0)
            .map(item => item.sessionId),
        }
      },
      catch: error => error,
    }),
  ),
})

const autoSettleSources = (ctx: Context): AutoSettleSources => ({
  readPolicy: AutoSettleSettings.policy,
  readSnapshot: async () => {
    const { items } = await ctx.sessionController.list({}, AbortSignal.timeout(30_000))
    const sessions = items.map(item => ({
      id: String(item.sessionId),
      running: item.running,
      blank: item.blank,
      updatedAt: item.updatedAt,
      parentId: item.parentSessionId === undefined ? undefined : String(item.parentSessionId),
      pendingInteraction: (item.projections?.values.userQuestions?.active.length ?? 0) > 0,
      cwd: item.cwd,
    }))
    const workspaces = ctx.workspaceRegistry.list().map(workspace => ({ workspaceId: workspace.id, path: workspace.path, sessionIds: workspace.sessionIds }))
    return {
      sessions,
      workspaceBySession: SidebarOrganization.workspaceForSessions({ workspaces, sessions }),
      archivedSessionIds: new Set(ctx.workspaceRegistry.archivedSessionIds),
      pinnedSessionIds: new Set(ctx.workspaceRegistry.pinnedSessionIds),
      settledSessionIds: new Set(settledSessionIdsFromHost()),
    }
  },
  readRebasedThreads: async () => {
    try {
      const view = await createHostApiClient(ctx, jjIntegrationApi, '@dshfiles/thread-sidebar').repositories({})
      return view.repositories.flatMap(repository => repository.threads)
    } catch (error) {
      if (error instanceof Error && isApiOwnerMissing(error)) return undefined
      throw error
    }
  },
  settle: AutoSettleSettings.settle,
})

let autoSettleScanner: AutoSettleScanner | undefined

const requireAutoSettleScanner = (): AutoSettleScanner => {
  if (autoSettleScanner === undefined) throw new Error('The thread-sidebar auto-settle scan is not running on this Host yet; retry in a few seconds.')
  return autoSettleScanner
}

const autoSettleApi = hostApi(threadSidebarAutoSettleApi, {
  status: Effect.fn('thread-sidebar auto-settle status read')(() => Effect.sync(() => requireAutoSettleScanner().status())),
  requestSettle: Effect.fn('thread-sidebar auto-settle request')(({ input }) =>
    Effect.tryPromise({ try: () => requireAutoSettleScanner().requestSettle(input), catch: error => error }),
  ),
})

// The slice of `@deepseek-ai/dsh-client-modules`' ClientModuleRegistry this plugin reads; older Hosts lack members.
interface ClientModuleRegistrySurface {
  readonly graph?: () => { readonly entries: ReadonlyArray<{ readonly id: string; readonly rev?: string | undefined }> }
  readonly clientPath?: (id: string) => string | undefined
  readonly onGraphChanged?: (listener: () => void) => () => void
}

const setupHost = (ctx: Context): void => {
  setThreadActionsContext(ctx)
  ctx.sessionProjections.register(threadSidebarModelRouteProjection)
  ctx.effect(() => {
    const opening = attentionFor(ctx)
    void opening.catch(() => undefined)
    const stop = ctx.on('session/event', (session, event) => {
      const reason = ThreadAttentionStoreModel.finishReasonFromEvent(event)
      if (reason === null) return
      void opening.then(store => store.recordFinish({ sessionId: String(session.id), seq: event.seq, time: event.time, reason })).catch(() => undefined)
    })
    return async () => {
      stop()
      await closeAttention()
    }
  }, 'thread-sidebar: thread attention store')
  ctx.effect(() => {
    const scanner = createAutoSettleScanner({
      clock: { now: Date.now, schedule: (run, delayMs) => scheduleOutsideReload(ctx, run, delayMs) },
      sources: autoSettleSources(ctx),
    })
    autoSettleScanner = scanner
    const stopListening = AutoSettleSettings.onChanged(scanner.settingsChanged)
    scanner.start()
    return () => {
      stopListening()
      scanner.stop()
      if (autoSettleScanner === scanner) autoSettleScanner = undefined
    }
  }, 'thread-sidebar: auto-settle scan')
  ctx.effect(() => {
    const stop = ctx.on('session/event', (session, event) => {
      const boundary = InflightTurns.boundaryFromEvent(event)
      if (boundary === null) return
      const sessionId = String(session.id)
      if (boundary === 'start') {
        void inflightTurns.start(sessionId).catch(() => undefined)
        return
      }
      if (boundary === 'shutdown') return
      void inflightTurns
        .end(sessionId)
        .then(wasOpen => (wasOpen && boundary === 'interrupted' ? restartRecoveryStore.record([sessionId], 'interrupted') : undefined))
        .catch(() => undefined)
    })
    return stop
  }, 'thread-sidebar: interrupted-turn tracking')
  ctx.inject(['clientModules'], scoped => {
    const registry: ClientModuleRegistrySurface | undefined = scoped.get('clientModules')
    if (registry?.graph === undefined || registry.clientPath === undefined) return
    const entries = (): readonly { readonly id: string; readonly rev?: string | undefined }[] =>
      graphIdsSchema.catch({ entries: [] }).parse(registry.graph?.()).entries
    const served = (): readonly ClientEntryRevision[] => entries().flatMap(entry => (entry.rev === undefined ? [] : [{ id: entry.id, rev: entry.rev }]))
    const watch = createPluginUpdateWatch({
      ids: () => entries().map(entry => entry.id),
      clientPath: id => registry.clientPath?.(id),
    })
    watch.remember()
    scoped.effect(() => {
      pluginUpdates = watch
      servedClientRevisions = served
      const stopWatching = registry.onGraphChanged?.(() => watch.remember())
      return () => {
        stopWatching?.()
        if (pluginUpdates === watch) pluginUpdates = undefined
        if (servedClientRevisions === served) servedClientRevisions = undefined
      }
    }, 'thread-sidebar: plugin update watch')
  })
}

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/thread-sidebar',
  commands: threadActionCommands,
  settings: [threadSidebarHostSettings],
  inject: [
    'connection',
    'sessionProjections',
    'sessionQuery',
    'agents',
    'sessionController',
    'sessionPersistence',
    'storageDomain',
    'workspaceController',
    'workspaceRegistry',
  ],
  apis: [
    restartApi,
    recoveryApi,
    machineApi,
    pluginUpdatesApi,
    pendingQuestionsApi,
    threadAttentionApiHost,
    sessionArchiveApi,
    threadActionsHost,
    threadQueueHost,
    threadViewsHost,
    autoSettleApi,
  ],
  // A settled Session runs no model step until it is unsettled: a late wake (subagent settlement, queued
  // follow-up, reminder) proposes a step this rejects, which the loop ends as `blocked` without a request.
  hooks: ctx => ({
    promptAdmission: ({ agent }) =>
      underSettledSession({
        header: agent.session.header,
        settledSessionIds: settledSessionIdsFromHost(),
        // Live agents carry the durable headers of a chain the walk can still read; a settled parent
        // that is not live answers from the child's own recorded parentSession instead.
        parentHeader: sessionId => ctx.agents.list().find(candidate => String(candidate.id) === sessionId)?.session.header,
      })
        ? 'reject'
        : undefined,
  }),
  // The web Host's client module registry knows where every loaded plugin package lives; Hosts without it
  // (desktop shells, older builds) simply report no pending updates.
})
