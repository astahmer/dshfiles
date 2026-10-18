/**
 * The bundle entry. It owns the search worker, registers our engine as the process's `sessionQuery` service, and starts
 * the background ingest. The stock `@deepseek-ai/dsh-session-query-sqlite` row stays disabled in the profile, because
 * one process may own each service and each derived-index path.
 */
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { defineHost } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { sessionSearchApi } from './api.js'
import { SessionSearchEngine } from './engine.js'
import { withoutUndefined } from './optional-fields.js'
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

let client: SearchWorkerClient | undefined

const requireClient = (): SearchWorkerClient => {
  if (client === undefined) throw new Error('The session-search Host is not active.')
  return client
}

const api = sessionSearchApi.host({ health: () => requireClient().health() })

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
    client = active
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
      void active.startIngest(sessionsRoot(ctx)).catch((error: unknown) => ctx.logger.warn(`session-search: ingest could not start: ${String(error)}`))
      ctx.on('session/event', () => nudge())
      return async () => {
        if (disposed) return
        disposed = true
        if (nudgePending !== undefined) clearTimeout(nudgePending)
        if (client === active) client = undefined
        await (await fiber).dispose()
        await active.close()
      }
    }, 'session-search: sessionQuery backend and ingest')
  },
})
