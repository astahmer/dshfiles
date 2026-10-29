import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session'
import { defineHost } from '@dshfiles/dshx/host'
import { HtmlPageStore } from './html-page-store.js'
import { createHtmlPreviewTool } from './html-preview-tool.js'
import { createHtmlRenderTool } from './html-render-tool.js'
import { createHtmlScreenshotTool } from './html-screenshot-tool.js'

export default defineHost({
  name: '@dshfiles/html-render',
  inject: ['tools', 'fs', 'workingDirectory', 'attachments'],
  setup: ctx => {
    const pages = new HtmlPageStore()
    ctx.effect(() => ctx.tools.register(createHtmlRenderTool(pages)))
    ctx.effect(() => ctx.tools.register(createHtmlPreviewTool({ ctx, pages })))
    ctx.effect(() => ctx.tools.register(createHtmlScreenshotTool({ ctx, pages })))
    ctx.on('session/disposed', session => pages.forgetThread(session.id))
  },
})
