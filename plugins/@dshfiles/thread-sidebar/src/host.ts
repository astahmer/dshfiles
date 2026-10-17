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
import { createPluginUpdateWatch } from './plugin-updates.js'
import { threadSidebarRestartApi } from './restart-api.js'
import { threadSidebarSessionArchiveApi } from './session-archive-api.js'
import { activeRestartSessionIds, createRestartRecoveryStore } from './restart-recovery.js'
import { createRestartController, readLaunchUrl } from './restart.js'
import { threadSidebarSettings } from './settings.js'
import { threadSidebarModelRouteProjection } from './subagent-provenance/projection.js'
import { setThreadActionsContext, threadActionsHost } from './thread-actions-host.js'
import { threadQueueHost } from './queue-host.js'

const restartRecoveryStore = createRestartRecoveryStore()

const restartController = (ctx: Context) =>
  createRestartController(ctx, {
    recordRunningSessions: async () => {
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) throw new Error('Session persistence is unavailable.')
      await persistence.flush()
      await restartRecoveryStore.record(activeRestartSessionIds(ctx.agents.list()))
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

const restartApi = threadSidebarRestartApi.host({
  availability: ({ ctx }) => ({ available: restartController(ctx).available }),
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

const recoveryApi = threadSidebarRecoveryApi.host({
  pending: async ({ ctx }) => {
    await restartRecoveryStore.remove(new Set(activeRestartSessionIds(ctx.agents.list())))
    return { sessionIds: (await restartRecoveryStore.list()).map(entry => entry.sessionId) }
  },
  resume: async ({ ctx, input }) => {
    const entry = (await restartRecoveryStore.list()).find(candidate => candidate.sessionId === input.sessionId)
    if (entry === undefined) return { accepted: false }

    const active = ctx.agents.list().find(agent => agent.id === SessionId(input.sessionId))
    if (active?.status === 'running') {
      await restartRecoveryStore.complete(input.sessionId)
      return { accepted: true }
    }

    const controller = ctx.get('sessionController')
    if (controller === undefined) throw new Error('Session resume is unavailable.')
    await controller.prompt(
      {
        // SAFETY: the persisted schema validated this request id as a UUID before it was branded here.
        requestId: entry.requestId as SessionRequestId,
        sessionId: SessionId(input.sessionId),
        mode: 'queue',
        content: [{ type: 'text', text: resumePrompt }],
      },
      AbortSignal.timeout(15_000),
    )
    await restartRecoveryStore.complete(input.sessionId)
    return { accepted: true }
  },
  dismiss: async ({ input }) => {
    const exists = (await restartRecoveryStore.list()).some(entry => entry.sessionId === input.sessionId)
    await restartRecoveryStore.dismiss(input.sessionId)
    return { dismissed: exists }
  },
})

const execFileAsync = promisify(execFile)

const graphIdsSchema = z.object({ entries: z.array(z.object({ id: z.string() })) })

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
const pluginUpdatesApi = threadSidebarPluginUpdatesApi.host({
  pending: async () => ({ plugins: (await pluginUpdates?.pending()) ?? [] }),
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
  readonly graph?: () => { readonly entries: ReadonlyArray<{ readonly id: string }> }
  readonly clientPath?: (id: string) => string | undefined
  readonly onGraphChanged?: (listener: () => void) => () => void
}

export default defineHost({
  name: '@dshfiles/thread-sidebar',
  settings: [threadSidebarSettings],
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
    ctx.inject(['clientModules'], scoped => {
      const registry: ClientModuleRegistrySurface | undefined = scoped.get('clientModules')
      if (registry?.graph === undefined || registry.clientPath === undefined) return
      const watch = createPluginUpdateWatch({
        ids: () =>
          graphIdsSchema
            .catch({ entries: [] })
            .parse(registry.graph?.())
            .entries.map(entry => entry.id),
        clientPath: id => registry.clientPath?.(id),
      })
      watch.remember()
      scoped.effect(() => {
        pluginUpdates = watch
        const stopWatching = registry.onGraphChanged?.(() => watch.remember())
        return () => {
          stopWatching?.()
          if (pluginUpdates === watch) pluginUpdates = undefined
        }
      }, 'thread-sidebar: plugin update watch')
    })
  },
})
