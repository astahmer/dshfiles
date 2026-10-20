/**
 * The bundle entry. It owns the search worker, registers our engine as the process's `sessionQuery` service, and starts
 * the background ingest. One process may own each service, so the stock `@deepseek-ai/dsh-session-query-sqlite` row is
 * disabled by this bundle's own patch (and by the seed profile): while it stays enabled it registers first, wins the
 * service, and silently leaves content search on the read path that freezes the Host.
 */
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { sessionSearchApi } from './api.js'
import { SessionSearchEngine } from './engine.js'
import { withoutUndefined } from './optional-fields.js'
import type { IndexHealth } from './protocol.js'
import { SearchWorkerClient, type SearchWorkerError } from './worker-client.js'

const rowConfig = z.object({
  indexPath: z.string().min(1).optional(),
  windowBytes: z.number().int().positive().optional(),
})

/** A row with no `config` key arrives as `undefined`; fall back to the defaults instead of failing activation. */
export const Config = z.union([rowConfig, z.undefined()]).transform(config => rowConfig.parse(config ?? {}))

const persistenceConfigSchema = z.object({ config: z.object({ root: z.string().min(1) }) })

/** The JSONL backend's configured root, else the default `$DSH_HOME/sessions`. */
const sessionsRoot = (ctx: Context): string => {
  const parsed = persistenceConfigSchema.safeParse(ctx.get('sessionPersistence'))
  return parsed.success ? parsed.data.config.root : dshHomePath('sessions')
}

/** A committed Session event wakes the ingest loop, coalesced so a busy turn does not wake it per event. */
const NUDGE_DEBOUNCE_MS = 500

const IDLE_HEALTH: IndexHealth = {
  sessions: 0,
  documents: 0,
  indexBytes: 0,
  behindSessions: 0,
  behindBytes: 0,
  ingesting: false,
  lastIngestMs: 0,
  slowestIngestMs: 0,
  lastSearchMs: 0,
  slowestSearchMs: 0,
  lastError: null,
}

/** The engine that currently backs `sessionQuery`, or nothing — a recomposition can replace or drop this plugin's row. */
const engineOf = (ctx: Context | undefined): SessionSearchEngine | undefined => {
  const service = ctx?.get('sessionQuery')
  return service instanceof SessionSearchEngine ? service : undefined
}

let hostContext: Context | undefined

const api = sessionSearchApi.host({
  health: async () => {
    const engine = engineOf(hostContext)
    // Another plugin owning the service is the failure this index cannot see from inside: say it, and build nothing.
    if (engine === undefined) return { ...IDLE_HEALTH, ownsService: false }
    return { ...(await engine._client.health()), ownsService: true }
  },
})

export default defineHost({
  name: '@dshfiles/session-search',
  Config,
  inject: ['sessions', 'sessionPersistence'],
  apis: [api],
  // oxlint-disable-next-line antislop/no-unknown-parameters -- The Loader hands this row's raw config; `Config.parse` runs the schema on the next line.
  setup: (ctx: Context, rawConfig: unknown) => {
    const config = Config.parse(rawConfig)
    const indexPath = config.indexPath ?? dshHomePath('plugins', 'session-search', 'index.sqlite')
    const active = new SearchWorkerClient(
      withoutUndefined({
        indexPath,
        windowBytes: config.windowBytes,
        onError: (error: SearchWorkerError) => ctx.logger.warn(`session-search: ${error.code}: ${error.message}`),
      }),
    )
    hostContext = ctx
    let nudgePending: NodeJS.Timeout | undefined
    let lastNudgeAt = 0
    const nudge = (): void => {
      if (nudgePending !== undefined) return
      const delay = Math.max(0, NUDGE_DEBOUNCE_MS - (Date.now() - lastNudgeAt))
      nudgePending = setTimeout(() => {
        nudgePending = undefined
        lastNudgeAt = Date.now()
        void active.nudge().catch(() => undefined)
      }, delay)
      nudgePending.unref()
    }
    ctx.effect(() => {
      let disposed = false
      const fiber = ctx.plugin(SessionSearchEngine, { client: active })
      void (async () => {
        try {
          await fiber
        } catch (error) {
          ctx.logger.error(`session-search: the owned search backend did not start: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (disposed) return
        const engine = engineOf(ctx)
        if (engine === undefined) {
          ctx.logger.error(
            'session-search: another plugin owns the sessionQuery service, so content search stays on it and the owned index is not built; disable the stock @deepseek-ai/dsh-session-query-sqlite row in the profile',
          )
          return
        }
        // A recomposition can leave an older instance applied after a newer one took the service; only the owner feeds it.
        if (engine._client !== active) return
        await active.startIngest(sessionsRoot(ctx)).catch((error: unknown) => ctx.logger.warn(`session-search: ingest could not start: ${String(error)}`))
      })()
      ctx.on('session/event', () => nudge())
      return async () => {
        if (disposed) return
        disposed = true
        if (nudgePending !== undefined) clearTimeout(nudgePending)
        if (hostContext === ctx) hostContext = undefined
        await fiber.then(
          engine => engine.dispose(),
          () => undefined,
        )
        await active.close()
      }
    }, 'session-search: sessionQuery backend and ingest')
  },
})
