import { defineHost } from '@dshfiles/dshx/host'
import { createHtmlPreviewTool } from './html-preview-tool.js'
import { htmlRenderTool } from './html-render-tool.js'

export default defineHost({
  name: '@dshfiles/html-render',
  inject: ['tools', 'fs', 'workingDirectory'],
  tools: [() => htmlRenderTool],
  setup: ctx => {
    ctx.effect(() => ctx.tools.register(createHtmlPreviewTool(ctx)))
  },
})
