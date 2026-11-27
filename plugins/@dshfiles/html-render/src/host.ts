import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@dshfiles/tool-search/tool-visibility'
import { DshxPlugin, HostContext, HostEvents } from '@dshfiles/dshx/effect'
import { Effect, Layer } from 'effect'
import { HtmlHost } from './html-host-promise.js'
import { HtmlPages } from './html-page-store.js'
import { htmlPreviewTool } from './html-preview-tool.js'
import { htmlRenderTool } from './html-render-tool.js'
import { htmlScreenshotTool } from './html-screenshot-tool.js'

/**
 * A rendered card answers "show me" in one glance, so the three html tools are declared to every Session instead of
 * hiding behind `tool_search`. The declaration is retried on `agent/created` because this plugin loads before
 * `@dshfiles/tool-search`, which publishes the registry.
 */
const alwaysVisibleHtmlTools = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const declare = () =>
      host.ctx.get('toolSearchVisibility')?.declare({
        owner: '@dshfiles/html-render',
        tools: ['html_render', 'html_preview', 'html_screenshot'],
        reason: 'a rendered answer is cheaper than prose',
      })
    declare()
    yield* HostEvents.on('agent/created', () => Effect.sync(declare))
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/html-render',
  inject: ['fs', 'workingDirectory', 'attachments'],
  layer: Layer.mergeAll(HtmlHost.layer, HtmlPages.layer, alwaysVisibleHtmlTools),
  tools: [htmlRenderTool, htmlPreviewTool, htmlScreenshotTool],
})
