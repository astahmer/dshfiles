import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Context, Effect, Layer } from 'effect'
import { HtmlPageStore } from './html-page-store.js'
import type { HtmlRenderEffectRunner } from './effect-runner.js'
import { createHtmlPreviewTool } from './html-preview-tool.js'
import { createHtmlRenderTool } from './html-render-tool.js'
import { createHtmlScreenshotTool } from './html-screenshot-tool.js'

class HtmlRenderHost extends Context.Service<HtmlRenderHost, { readonly ctx: CordisContext; readonly pages: HtmlPageStore }>()('@dshfiles/html-render/Host') {}

const htmlRenderLayer = (ctx: CordisContext) => Layer.succeed(HtmlRenderHost, { ctx, pages: new HtmlPageStore() })

const { hostApi: _hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: htmlRenderLayer,
  setup: Effect.fn('html render setup')(function* (ctx: CordisContext) {
    const host = yield* HtmlRenderHost
    const runtimeContext = yield* Effect.context<HtmlRenderHost>()
    const runEffect: HtmlRenderEffectRunner = (effect, options) => Effect.runPromise(Effect.provide(effect, runtimeContext), options)
    yield* Effect.acquireRelease(
      Effect.sync(() => ctx.tools.register(createHtmlRenderTool(host.pages, runEffect))),
      dispose => Effect.sync(dispose),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => ctx.tools.register(createHtmlPreviewTool({ ctx: host.ctx, pages: host.pages, runEffect }))),
      dispose => Effect.sync(dispose),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => ctx.tools.register(createHtmlScreenshotTool({ ctx: host.ctx, pages: host.pages, runEffect }))),
      dispose => Effect.sync(dispose),
    )
    yield* Effect.sync(() => ctx.on('session/disposed', session => host.pages.forgetThread(session.id)))
  }),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/html-render',
  inject: ['tools', 'fs', 'workingDirectory', 'attachments'],
})
