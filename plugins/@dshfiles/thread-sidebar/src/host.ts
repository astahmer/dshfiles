import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-user-questions'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineHost } from '@dshfiles/dshx/host'
import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { z } from 'zod'
import { attentionFor, closeAttention, threadAttentionApiHost } from './attention-host.js'
import { ThreadAttentionStoreModel } from './attention-store.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { threadSidebarPendingQuestionsApi } from './pending-questions-api.js'
import { threadSidebarPluginUpdatesApi } from './plugin-updates-api.js'
import { threadSidebarRecoveryApi } from './recovery-api.js'
import { createPluginUpdateWatch, staleClientEntries, type ClientEntryRevision } from './plugin-updates.js'
import { threadSidebarRestartApi } from './restart-api.js'
import { threadSidebarSessionArchiveApi } from './session-archive-api.js'
import { InflightTurns } from './inflight-turns.js'
import { activeRestartSessionIds, createRestartRecoveryStore } from './restart-recovery.js'
import { createRestartController, readLaunchUrl } from './restart.js'
import { RestartResumeSetting, settledSessionIdsFromHost, threadSidebarHostSettings } from './settings.js'
import { underSettledSession } from './settled-gate.js'
import { threadSidebarModelRouteProjection } from './subagent-provenance/projection.js'
import { setThreadActionsContext, threadActionsHost } from './thread-actions-host.js'
import { threadQueueHost } from './queue-host.js'

const restartRecoveryStore = createRestartRecoveryStore()
const inflightTurns = InflightTurns.open()

const restartController = (ctx: Context) =>
  createRestartController(ctx, {
    recordRunningSessions: async () => {
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) throw new Error('Session persistence is unavailable.')
      await persistence.flush()
      await restartRecoveryStore.record(activeRestartSessionIds(ctx.agents.list()), 'restart')
    },
    onExitFailure: () => console.error('thread-sidebar: managed restart was canceled because running-thread recovery could not be saved'),
  })

const sessionArchiveApi = threadSidebarSessionArchiveApi.host({
  status: ({ ctx, input }) => {
    const requestedSessionIds = new Set(input.sessionIds)
    return {
      archivedSessionIds: ctx.workspaceRegistry.archivedSessionIds.filter(sessionId => requestedSessionIds.has(sessionId)),
    }
  },
})

/** How often a pending restart looks for running turns, and how long it waits before restarting anyway. */
const DRAIN_POLL_MS = 2_000
const DRAIN_LIMIT_MS = 30 * 60_000

/**
 * One restart waiting for this Host to go idle. It restarts after two polls in a row find no running turn, so a
 * queued follow-up that starts right after a turn ends is not cut off; past the limit it restarts anyway, and the
 * managed restart records whatever still runs so it resumes after boot.
 */
let pendingRestart: { readonly since: number; readonly timer: NodeJS.Timeout } | undefined

const runningTurns = (ctx: Context): number => activeRestartSessionIds(ctx.agents.list()).length

const restartWhenIdle = (ctx: Context): void => {
  if (pendingRestart !== undefined) return
  const since = Date.now()
  let idlePolls = 0
  const timer = setInterval(() => {
    idlePolls = runningTurns(ctx) === 0 ? idlePolls + 1 : 0
    if (idlePolls < 2 && Date.now() - since < DRAIN_LIMIT_MS) return
    clearInterval(timer)
    pendingRestart = undefined
    void restartController(ctx)
      .request()
      .catch((error: unknown) => {
        ctx.logger.warn('thread-sidebar: the restart waiting for idle could not start: %s', error instanceof Error ? error.message : String(error))
      })
  }, DRAIN_POLL_MS)
  timer.unref()
  pendingRestart = { since, timer }
}

const restartApi = threadSidebarRestartApi.host({
  availability: ({ ctx }) => ({
    available: restartController(ctx).available,
    pending: pendingRestart === undefined ? null : { since: pendingRestart.since, running: runningTurns(ctx) },
  }),
  requestRestartWhenIdle: ({ ctx }) => {
    if (!restartController(ctx).available) throw new Error('This DSH process is not running under the managed restart launcher.')
    restartWhenIdle(ctx)
    return { accepted: true as const }
  },
  cancelPendingRestart: () => {
    if (pendingRestart === undefined) return { canceled: false }
    clearInterval(pendingRestart.timer)
    pendingRestart = undefined
    return { canceled: true }
  },
  launchUrl: async () => ({ url: await readLaunchUrl() }),
  requestRestart: async ({ ctx }) => {
    try {
      return await restartController(ctx).request()
    } catch {
      throw new Error('Could not schedule a safe DSH restart.')
    }
  },
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

  const controller = ctx.get('sessionController')
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

const recoveryApi = threadSidebarRecoveryApi.host({
  pending: async ({ ctx }) => {
    await restartRecoveryStore.remove(new Set(activeRestartSessionIds(ctx.agents.list())))
    const entries = await restartRecoveryStore.list()
    return {
      sessionIds: entries.map(entry => entry.sessionId),
      entries: entries.map(entry => ({ sessionId: entry.sessionId, reason: entry.reason, interruptedAt: entry.interruptedAt })),
    }
  },
  resume: async ({ ctx, input }) => ({ accepted: await resumeRecovery(ctx, input.sessionId) }),
  dismiss: async ({ input }) => {
    const exists = (await restartRecoveryStore.list()).some(entry => entry.sessionId === input.sessionId)
    await restartRecoveryStore.dismiss(input.sessionId)
    return { dismissed: exists }
  },
})

const execFileAsync = promisify(execFile)

const graphIdsSchema = z.object({ entries: z.array(z.object({ id: z.string(), rev: z.string().optional() })) })

/** The Finder computer name ("MacBook Pro de Alexandre") on macOS; elsewhere the short hostname. */
const readMachineName = async (): Promise<string> => {
  const shortHostname = hostname().replace(/\..*$/u, '')
  if (process.platform !== 'darwin') return shortHostname
  try {
    const { stdout } = await execFileAsync('scutil', ['--get', 'ComputerName'], { timeout: 1000 })
    return stdout.trim() || shortHostname
  } catch {
    return shortHostname
  }
}

let machineName: Promise<string> | undefined
const machineApi = threadSidebarMachineApi.host({
  name: async () => ({ name: await (machineName ??= readMachineName()) }),
})

let pluginUpdates: ReturnType<typeof createPluginUpdateWatch> | undefined
/** The client bundles the Host currently serves, read from the composition every page boots from. */
let servedClientRevisions: (() => readonly ClientEntryRevision[]) | undefined
const pluginUpdatesApi = threadSidebarPluginUpdatesApi.host({
  pending: async () => ({ plugins: (await pluginUpdates?.pending()) ?? [] }),
  clientUpdates: async ({ input }) => staleClientEntries({ page: input.revisions, served: servedClientRevisions?.() ?? [] }),
})

/**
 * One `sessionController.list` answers every requested Session at once. Observing each Session
 * separately re-read its log, which cost seconds per poll and pinned a browser connection with it.
 */
const pendingQuestionsApi = threadSidebarPendingQuestionsApi.host({
  active: async ({ ctx, input, signal }) => {
    if (input.sessionIds.length === 0) return { sessionIds: [] }
    const candidates = new Set<string>(input.sessionIds)
    const listed = await ctx.sessionController.list({}, signal)
    return {
      sessionIds: listed.items
        .filter(item => candidates.has(item.sessionId) && (item.projections?.values.userQuestions?.active.length ?? 0) > 0)
        .map(item => item.sessionId),
    }
  },
})

// The slice of `@deepseek-ai/dsh-client-modules`' ClientModuleRegistry this plugin reads; older Hosts lack members.
interface ClientModuleRegistrySurface {
  readonly graph?: () => { readonly entries: ReadonlyArray<{ readonly id: string; readonly rev?: string | undefined }> }
  readonly clientPath?: (id: string) => string | undefined
  readonly onGraphChanged?: (listener: () => void) => () => void
}

export default defineHost({
  name: '@dshfiles/thread-sidebar',
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
  ],
  // The web Host's client module registry knows where every loaded plugin package lives; Hosts without it
  // (desktop shells, older builds) simply report no pending updates.
  setup: ctx => {
    setThreadActionsContext(ctx)
    ctx.sessionProjections.register(threadSidebarModelRouteProjection)
    // A settled Session runs no model step until it is unsettled: a late wake (subagent settlement, queued
    // follow-up, reminder) proposes a step this rejects, which the loop ends as `blocked` without a request.
    ctx.effect(
      () =>
        ctx.on('agent/pre-step', ({ agent }, next) =>
          underSettledSession({
            header: agent.session.header,
            settledSessionIds: settledSessionIdsFromHost(),
            // Live agents carry the durable headers of a chain the walk can still read; a settled parent
            // that is not live answers from the child's own recorded parentSession instead.
            parentHeader: sessionId => ctx.agents.list().find(candidate => String(candidate.id) === sessionId)?.session.header,
          })
            ? Promise.resolve({ kind: 'reject' })
            : next(),
        ),
      'thread-sidebar: settled-thread gate',
    )
    // One durable attention record per session, written where the turn actually ends, so every browser,
    // plugin and CLI reads the same unacknowledged-thread state instead of each tab guessing from its own memory.
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
    // A turn that was still open when the previous Host process stopped never wrote its own recovery
    // record: the crash leaves the marker behind instead, and this process turns it into a visible row.
    ctx.effect(() => {
      const bootedAt = Date.now()
      const promoted = InflightTurns.promote({ inflight: inflightTurns, recovery: restartRecoveryStore }).catch(() => [])
      const resumeTimer = setTimeout(() => {
        void promoted.then(() => resumeAfterBoot(ctx, bootedAt)).catch(() => undefined)
      }, AUTO_RESUME_DELAY_MS)
      resumeTimer.unref()
      const stop = ctx.on('session/event', (session, event) => {
        const boundary = InflightTurns.boundaryFromEvent(event)
        if (boundary === null) return
        const sessionId = String(session.id)
        if (boundary === 'start') {
          void inflightTurns.start(sessionId).catch(() => undefined)
          return
        }
        // A turn this Host's own shutdown cut off keeps its marker: the next process promotes it into a resume row,
        // which a write racing the five-second shutdown could not guarantee.
        if (boundary === 'shutdown') return
        // Crash recovery appends an `interrupted` turn end the moment the thread is next loaded, which
        // can land before this process promotes the markers it inherited. Take the marker here so that
        // turn still becomes a resume row instead of being dropped before `promote` can read it.
        void inflightTurns
          .end(sessionId)
          .then(wasOpen => (wasOpen && boundary === 'interrupted' ? restartRecoveryStore.record([sessionId], 'interrupted') : undefined))
          .catch(() => undefined)
      })
      return () => {
        clearTimeout(resumeTimer)
        stop()
      }
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
  },
})
