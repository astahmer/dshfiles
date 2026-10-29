import { statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineHost } from '@dshfiles/dshx/host'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-hmr'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hmrGateApi, type DeferredPackage, type HmrGateStatus } from './api.js'
import { HmrGateModel, digestOf, hostArtifactOf } from './host/gate.js'

/**
 * The Web client's HMR transport, with one added rule: a rebuilt client bundle is
 * only announced while its Host half is the code the running Host loaded.
 *
 * The stock transport announces every rebuilt bundle. In this profile the Host
 * never reloads plugin code (the `hmr` row is disabled on purpose), so a rebuild
 * of `dist/index.js` leaves new client code talking to old Host code. Deferring
 * the announcement keeps the last-good client code live, because the browser only
 * tears it down when it receives the `rebuilt` frame.
 *
 * The frame protocol mirrors `@deepseek-ai/dsh-client-hmr` for `graph` and
 * `rebuilt`; `deferred` is this package's addition and the stock client ignores an
 * unknown frame type. See UPSTREAM.md for provenance and the update policy.
 */

const EVENTS_ENDPOINT = '/plugins/events'
const POLL_INTERVAL_MS = 500
const DEFERRED_REASON = 'host-artifact-changed' as const

/** The bundle metadata the poll compares, plus the path it came from. */
interface BundleStat {
  readonly mtimeMs: number
  readonly ctimeMs: number
  readonly size: number
}

interface BundledRow extends BundleStat {
  readonly path: string
}

interface WatchRow {
  readonly path: string
  mtimeMs: number
  ctimeMs: number
  size: number
  dirty: boolean
}

/** One SSE payload this transport can publish; the wire shape the browser half parses. */
type ServerFrame =
  | { readonly type: 'graph'; readonly graph: unknown }
  | { readonly type: 'rebuilt'; readonly id: string; readonly rev: string }
  | { readonly type: 'deferred'; readonly packages: readonly DeferredPackage[] }

interface GateRuntime {
  status: () => HmrGateStatus
  deferred: () => readonly DeferredPackage[]
}

let runtime: GateRuntime | undefined

const frame = (value: ServerFrame): string => `data: ${JSON.stringify(value)}\n\n`

const errorCodeSchema = z.object({ code: z.string() })

const isEnoent = (error: unknown): boolean => errorCodeSchema.safeParse(error).data?.code === 'ENOENT'

const registerGate = (ctx: Context): GateRuntime => {
  const gate = new HmrGateModel()
  const watched = new Map<string, WatchRow>()
  const connections = new Set<ServerResponse>()

  const deferredPackages = (): readonly DeferredPackage[] => gate.deferred().map(id => ({ id, reason: DEFERRED_REASON }))

  const broadcast = (value: ServerFrame): void => {
    const line = frame(value)
    for (const response of connections) response.write(line)
  }

  const publishDeferred = (): void => {
    broadcast({ type: 'deferred', packages: deferredPackages() })
  }

  const applyRebuild = (id: string): void => {
    try {
      ctx.clientModules.rebuilt(id)
    } catch (error) {
      const row = watched.get(id)
      if (row !== undefined) row.dirty = true
      ctx.logger.warn(error)
    }
  }

  const trackRow = (id: string, path: string, baseline: BundleStat): void => {
    const hostPath = hostArtifactOf(path)
    gate.track(id, hostPath, hostPath === undefined ? undefined : digestOf(hostPath))
    watched.set(id, { path, mtimeMs: baseline.mtimeMs, ctimeMs: baseline.ctimeMs, size: baseline.size, dirty: false })
  }

  const syncWatches = (): void => {
    const rows = new Map<string, BundledRow>()
    for (const row of ctx.clientModules.graph().entries) {
      const baseline = ctx.clientModules.artifactBaseline(row.id)
      if (baseline !== undefined) rows.set(row.id, baseline)
    }
    for (const id of [...watched.keys()]) if (!rows.has(id)) watched.delete(id)
    for (const [id, baseline] of rows) {
      const existing = watched.get(id)
      if (existing !== undefined && existing.path === baseline.path) continue
      trackRow(id, baseline.path, baseline)
    }
  }

  const poll = (): void => {
    for (const [id, row] of watched) {
      let current: BundleStat
      try {
        const stat = statSync(row.path)
        current = { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size }
      } catch (error) {
        row.dirty = true
        if (!isEnoent(error)) ctx.logger.warn(error)
        continue
      }
      if (!row.dirty && current.mtimeMs === row.mtimeMs && current.ctimeMs === row.ctimeMs && current.size === row.size) continue
      row.mtimeMs = current.mtimeMs
      row.ctimeMs = current.ctimeMs
      row.size = current.size
      row.dirty = false
      const facts = gate.facts(id)
      const verdict = gate.observe(id, facts?.hostPath === undefined ? undefined : digestOf(facts.hostPath))
      if (verdict.action === 'apply') {
        applyRebuild(id)
        publishDeferred()
        continue
      }
      ctx.logger.info('HMR deferred (%s): the running Host has not loaded %s', id, facts?.hostPath ?? 'its Host half')
      publishDeferred()
    }
  }

  ctx.effect(() => {
    syncWatches()
    const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches)
    const timer = setInterval(poll, POLL_INTERVAL_MS)
    timer.unref()
    return () => {
      unsubscribe()
      clearInterval(timer)
      watched.clear()
    }
  }, 'hmr-gate: bundle watches')

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'exact',
      path: EVENTS_ENDPOINT,
      handler: (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405)
          response.end()
          return
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        response.write(': connected\n\n')
        connections.add(response)
        response.write(frame({ type: 'graph', graph: ctx.clientModules.graph() }))
        response.write(frame({ type: 'deferred', packages: deferredPackages() }))
        response.on('close', () => {
          connections.delete(response)
        })
      },
    })
    const unsubscribeGraph = ctx.clientModules.onGraphChanged(() => {
      broadcast({ type: 'graph', graph: ctx.clientModules.graph() })
    })
    const unsubscribeRebuilt = ctx.clientModules.onRebuilt((id, rev) => {
      broadcast({ type: 'rebuilt', id, rev })
    })
    return () => {
      unsubscribeGraph()
      unsubscribeRebuilt()
      disposeRoute()
      for (const response of connections) response.destroy()
      connections.clear()
    }
  }, 'hmr-gate: /plugins/events channel')

  ctx.on('hmr/reload', reloads => {
    const filenames: string[] = []
    for (const reload of reloads.values()) filenames.push(reload.filename)
    for (const id of gate.release(filenames)) applyRebuild(id)
    publishDeferred()
  })

  return {
    status: () => ({ deferred: [...deferredPackages()], watched: watched.size }),
    deferred: deferredPackages,
  }
}

const hmrGateHostApi = hmrGateApi.host({
  status: async () => runtime?.status() ?? { deferred: [], watched: 0 },
})

export default defineHost({
  name: 'dshfiles-hmr-gate',
  apis: [hmrGateHostApi],
  inject: ['clientModules', 'webServer'],
  setup: (ctx: Context) => {
    runtime = registerGate(ctx)
  },
})
