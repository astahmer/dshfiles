import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { definePlugin } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { injectAfterHead, SHARED_EVENT_SOURCE_WORKER, SHARED_EVENT_SOURCE_WORKER_PATH, sharedEventSourceScript } from './shim.js'

const rowConfig = z.object({
  /**
   * Install the cross-tab EventSource proxy. Off restores one stream per tab,
   * which is what a browser without SharedWorker already does.
   */
  enabled: z.boolean().default(true),
})

/** A row with no `config` key arrives as `undefined`; fall back to the defaults instead of failing activation. */
export const Config = z.union([rowConfig, z.undefined()]).transform(config => rowConfig.parse(config ?? {}))

export default definePlugin({
  id: 'shared-streams',
  name: '@dshfiles/shared-streams',
  Config,
  inject: ['webServer'],
  setup: api => {
    const ctx: Context = api.raw.ctx
    const { enabled } = Config.parse(api.config)
    if (!enabled) return
    const markup = `<script>${sharedEventSourceScript()}</script>`
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: `/${SHARED_EVENT_SOURCE_WORKER_PATH}`,
          handler: (_request, response) => {
            response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
            response.end(SHARED_EVENT_SOURCE_WORKER)
          },
        }),
      'shared-streams: worker route',
    )
    ctx.effect(() => ctx.webServer.tapIndex(html => injectAfterHead(html, markup)), 'shared-streams: index tap')
  },
})
