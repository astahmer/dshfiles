import { defineHost } from '@dshfiles/dshx/host'
import { applyPatchTool } from './patch-tool.js'

export default defineHost({
  name: '@dshfiles/apply-patch',
  inject: ['tools', 'fs', 'workingDirectory'],
  tools: [applyPatchTool],
})
