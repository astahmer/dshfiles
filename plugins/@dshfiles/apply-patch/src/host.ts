import { defineHost } from '@dshfiles/dshx/host'
import { createApplyPatchTool } from './patch-tool.js'

export default defineHost({
  name: '@dshfiles/apply-patch',
  inject: ['tools', 'fs', 'workingDirectory'],
  setup: ctx => {
    // Registered from `setup` so the tool closes over this context: a scoped
    // `execution.agent.ctx` only resolves services it injects, and reading
    // `workingDirectory` there fails with "cannot get property ... without inject".
    ctx.effect(() => ctx.tools.register(createApplyPatchTool(ctx)))
  },
})
