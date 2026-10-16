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
import { threadSidebarMachineApi } from './machine-api.js'
import { threadSidebarPendingQuestionsApi } from './pending-questions-api.js'
import { threadSidebarPluginUpdatesApi } from './plugin-updates-api.js'
import { threadSidebarRecoveryApi } from './recovery-api.js'
import { createPluginUpdateWatch } from './plugin-updates.js'
import { threadSidebarRestartApi } from './restart-api.js'
import { activeRestartSessionIds, createRestartRecoveryStore } from './restart-recovery.js'
import { createRestartController, readLaunchUrl } from './restart.js'
import { threadSidebarSettings } from './settings.js'
import { threadSidebarModelRouteProjection } from './subagent-provenance/projection.js'

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

const pendingQuestionsApi = threadSidebarPendingQuestionsApi.host({
  active: async ({ ctx, input, signal }) => {
    const activeSessionIds: string[] = []
    for (let offset = 0; offset < input.sessionIds.length; offset += 8) {
      const batch = input.sessionIds.slice(offset, offset + 8)
      const results = await Promise.all(
        batch.map(async sessionId => {
          const observation = await ctx.sessionQuery.observeSession(SessionId(sessionId), { signal, projectionMode: 'all' })
          try {
            return observation.projections?.values.userQuestions?.active.length ? sessionId : undefined
          } finally {
            observation[Symbol.dispose]()
          }
        }),
      )
      activeSessionIds.push(...results.filter((sessionId): sessionId is string => sessionId !== undefined))
    }
    return { sessionIds: activeSessionIds }
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
  inject: ['connection', 'sessionProjections', 'sessionQuery', 'agents', 'sessionController', 'sessionPersistence'],
  apis: [restartApi, recoveryApi, machineApi, pluginUpdatesApi, pendingQuestionsApi],
  // The web Host's client module registry knows where every loaded plugin package lives; Hosts without it
  // (desktop shells, older builds) simply report no pending updates.
  setup: ctx => {
    ctx.sessionProjections.register(threadSidebarModelRouteProjection)
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
