import type { Context, Effect } from '@deepseek-ai/cordis'
import type { JobEvent, JobView } from '@deepseek-ai/dsh-jobs'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type {} from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { defineHost, publishApiEvent } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { withSpan } from '@dshfiles/dshx/tracing'
import { previewApi } from './api.js'
import { PreviewBrowsers, PreviewError } from './browser-pool.js'
import { DevServerProbes } from './dev-server-probe.js'
import { createScreenshotTool } from './screenshot-tool.js'
import { previewSettings, type PreviewSettings } from './settings.js'

const KILL_GRACE_MS = 3_000
const STOP_REASON = 'stopped from the thread dev-server list'
const DEFAULT_SNAPSHOT_CHARS = 20_000

interface JobRegistry {
  readonly events: { subscribe(filter: { readonly owners: 'all' }, listener: (event: JobEvent) => void): () => void }
  kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished'
}

interface PreviewRuntime {
  readonly context: Context
  readonly browsers: PreviewBrowsers
  readonly jobs: Map<string, JobView>
  readonly probe: ReturnType<typeof DevServerProbes.create>
  registry: JobRegistry | null
}

let runtime: PreviewRuntime | undefined
let settingsScope: SettingsScope<PreviewSettings> | undefined
const defaultSettings: PreviewSettings = previewSettings.schema({})

const currentSettings = (): PreviewSettings => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

const requireRuntime = (): PreviewRuntime => {
  if (runtime === undefined) throw new PluginApiError('The preview Host is not active. Reload the page; if it persists, restart DSH.', { code: 'inactive' })
  return runtime
}

const userFacing = async <Result>(run: () => Promise<Result>): Promise<Result> => {
  try {
    return await run()
  } catch (error) {
    if (error instanceof PreviewError) throw new PluginApiError(error.message, { code: 'preview' })
    if (error instanceof Error && error.name === 'TimeoutError')
      throw new PluginApiError(`${error.message.split('\n')[0] ?? ''} Take a fresh preview_snapshot and retry.`, { code: 'timeout' })
    throw error
  }
}

/** Agents act on their own thread only; a Client names the thread it shows. */
const ownThread = (caller: ApiCaller, requested: string | undefined): string => {
  if (caller.kind === 'agent') {
    if (caller.sessionId === undefined) throw new PluginApiError('This tool needs a calling thread.', { code: 'no-thread' })
    if (requested !== undefined && requested !== caller.sessionId)
      throw new PluginApiError('An agent can only act on its own thread’s preview pages and dev servers.', { code: 'other-thread' })
    return caller.sessionId
  }
  if (requested === undefined) throw new PluginApiError('Pass the sessionId of the thread.', { code: 'no-thread' })
  return requested
}

const announce = (
  context: Context,
  sessionId: string,
  reveal: { readonly pageId: string; readonly url: string; readonly requestedAt: number } | null,
): void => {
  void publishApiEvent(context, previewApi, 'pagesChanged', { sessionId, reveal }).catch(() => undefined)
}

const liveJobs = (active: PreviewRuntime) =>
  [...active.jobs.values()]
    .filter(job => job.status === 'running' || job.status === 'stopping')
    .map(job => ({ id: job.id, label: job.label, owner: job.owner ?? null, startedAt: job.startedAt }))

const signal = (pid: number, name: NodeJS.Signals): boolean => {
  try {
    process.kill(pid, name)
    return true
  } catch {
    return false
  }
}

const stopDevServer = async (active: PreviewRuntime, input: { readonly sessionId: string; readonly pid: number; readonly startedAt: number }) => {
  const { servers } = await active.probe.read(true)
  const server = servers.find(
    candidate => candidate.pid === input.pid && candidate.startedAt === input.startedAt && candidate.sessionIds.includes(input.sessionId),
  )
  if (server === undefined) return { outcome: 'missing' as const }
  active.probe.invalidate()
  if (server.jobId !== null && active.registry !== null) {
    active.registry.kill(JobId(server.jobId), SessionId(input.sessionId), STOP_REASON)
    return { outcome: 'stopped-job' as const }
  }
  await withSpan('preview stop-dev-server', { attributes: { 'dshx.preview.port_count': server.ports.length } }, async () => {
    if (!signal(server.pid, 'SIGTERM')) return
    const timer = setTimeout(() => {
      void DevServerProbes.readProcessTable(active.probe.exec)
        .then(rows => {
          if (rows.some(row => row.pid === server.pid && row.startedAt === server.startedAt)) signal(server.pid, 'SIGKILL')
        })
        .catch(() => undefined)
    }, KILL_GRACE_MS)
    timer.unref()
  })
  return { outcome: 'signalled' as const }
}

const api = previewApi.host({
  open: ({ input, caller }) =>
    userFacing(async () => {
      const active = requireRuntime()
      const sessionId = ownThread(caller, input.sessionId)
      const opened = await active.browsers.open({ sessionId, url: input.url, reveal: input.reveal ?? false })
      announce(
        active.context,
        sessionId,
        opened.revealRequestedAt === null ? null : { pageId: opened.pageId, url: opened.url, requestedAt: opened.revealRequestedAt },
      )
      return opened
    }),
  navigate: ({ input, caller }) =>
    userFacing(async () => {
      const active = requireRuntime()
      const sessionId = ownThread(caller, input.sessionId)
      const result = await active.browsers.navigate({ sessionId, pageId: input.pageId, url: input.url, action: input.action })
      announce(active.context, sessionId, null)
      return result
    }),
  reveal: ({ input, caller }) =>
    userFacing(async () => {
      const active = requireRuntime()
      const sessionId = ownThread(caller, input.sessionId)
      const revealRequestedAt = active.browsers.revealRequest({ sessionId, pageId: input.pageId })
      const page = (await active.browsers.list(sessionId)).find(entry => entry.pageId === input.pageId)
      if (page !== undefined && revealRequestedAt !== null)
        announce(active.context, sessionId, { pageId: page.pageId, url: page.url, requestedAt: revealRequestedAt })
      return { revealRequestedAt }
    }),
  snapshot: ({ input, caller }) =>
    userFacing(() =>
      requireRuntime().browsers.snapshot({
        sessionId: ownThread(caller, input.sessionId),
        pageId: input.pageId,
        maxChars: input.maxChars ?? DEFAULT_SNAPSHOT_CHARS,
      }),
    ),
  click: ({ input, caller }) =>
    userFacing(() =>
      requireRuntime().browsers.click({
        sessionId: ownThread(caller, input.sessionId),
        pageId: input.pageId,
        target: { ref: input.ref, selector: input.selector },
        doubleClick: input.doubleClick ?? false,
      }),
    ),
  type: ({ input, caller }) =>
    userFacing(() =>
      requireRuntime().browsers.type({
        sessionId: ownThread(caller, input.sessionId),
        pageId: input.pageId,
        target: { ref: input.ref, selector: input.selector },
        text: input.text,
        submit: input.submit ?? false,
      }),
    ),
  evaluate: ({ input, caller }) =>
    userFacing(() => requireRuntime().browsers.evaluate({ sessionId: ownThread(caller, input.sessionId), pageId: input.pageId, expression: input.expression })),
  close: ({ input, caller }) =>
    userFacing(async () => {
      const active = requireRuntime()
      const sessionId = ownThread(caller, input.sessionId)
      const result = await active.browsers.close({ sessionId, pageId: input.pageId })
      announce(active.context, sessionId, null)
      return result
    }),
  list: async ({ input, caller }) => ({ pages: await requireRuntime().browsers.list(ownThread(caller, input.sessionId)) }),
  devServers: async ({ input, caller }) => {
    const sessionId = caller.kind === 'agent' && input.sessionId !== undefined ? input.sessionId : ownThread(caller, input.sessionId)
    const probe = await requireRuntime().probe.read(false)
    return { supported: probe.supported, servers: probe.servers.filter(server => server.sessionIds.includes(sessionId)) }
  },
  stopDevServer: ({ input, caller }) =>
    stopDevServer(requireRuntime(), { sessionId: ownThread(caller, input.sessionId), pid: input.pid, startedAt: input.startedAt }),
})

const ownedSettings = previewSettings.host({
  setup: scope => {
    settingsScope = scope
    return () => {
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

const applyJobEvent = (jobs: Map<string, JobView>, event: JobEvent): void => {
  if (event.type === 'removed') jobs.delete(event.job.id)
  else if (event.type !== 'output') jobs.set(event.job.id, event.job)
}

const setupHost = (context: Context): Effect<void> => {
  const browsers = new PreviewBrowsers({ settings: currentSettings })
  const jobs = new Map<string, JobView>()
  const active: PreviewRuntime = {
    context,
    browsers,
    jobs,
    registry: null,
    probe: DevServerProbes.create({
      exec: DevServerProbes.contextExec(context),
      platform: process.platform,
      hostPid: process.pid,
      sessions: () => DevServerProbes.contextSessions(context),
      jobs: () => liveJobs(active),
    }),
  }
  runtime = active
  const stopDisposed = context.on('session/disposed', session => {
    void browsers.closeThread(session.id).then(closed => {
      if (closed > 0) announce(context, session.id, null)
    })
  })
  context.inject(['jobs'], scoped => {
    const registry = scoped.get('jobs')
    if (registry === undefined) return
    scoped.effect(() => {
      active.registry = registry
      const unsubscribe = registry.events.subscribe({ owners: 'all' }, event => applyJobEvent(jobs, event))
      return () => {
        unsubscribe()
        active.registry = null
        jobs.clear()
      }
    }, 'preview: live job tracking')
  })
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        stopDisposed()
        if (runtime === active) runtime = undefined
        await browsers.dispose()
      }
    },
  }
}

export default defineHost({
  name: '@dshfiles/preview',
  inject: ['subprocess', 'tools', 'attachments'],
  apis: [api],
  settings: [ownedSettings],
  tools: [
    ctx =>
      createScreenshotTool({
        attachments: ctx.attachments,
        browsers: () => requireRuntime().browsers,
      }),
  ],
  setup: setupHost,
})
