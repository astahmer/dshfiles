import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Layer } from 'effect'
import { HtmlHost } from './html-host-promise.js'
import { HtmlPages } from './html-page-store.js'
import { htmlPreviewTool } from './html-preview-tool.js'
import { htmlRenderTool } from './html-render-tool.js'
import { htmlScreenshotTool } from './html-screenshot-tool.js'

export default DshxPlugin.make({
  name: '@dshfiles/html-render',
  inject: ['fs', 'workingDirectory', 'attachments'],
  layer: Layer.mergeAll(HtmlHost.layer, HtmlPages.layer),
  tools: [htmlRenderTool, htmlPreviewTool, htmlScreenshotTool],
})
