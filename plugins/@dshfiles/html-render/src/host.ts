import { defineHost } from '@dshfiles/dshx/host'
import { htmlRenderTool } from './html-render-tool.js'

export default defineHost({ name: '@dshfiles/html-render', inject: ['tools'], tools: [() => htmlRenderTool] })
