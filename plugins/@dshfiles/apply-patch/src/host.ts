import { DshxPlugin } from '@dshfiles/dshx/effect'
import { PatchHost } from './patch-host-promise.js'
import { applyPatchTool } from './patch-tool.js'

export default DshxPlugin.make({
  name: '@dshfiles/apply-patch',
  inject: ['fs', 'workingDirectory', 'sessions'],
  layer: PatchHost.layer,
  tools: [applyPatchTool],
})
