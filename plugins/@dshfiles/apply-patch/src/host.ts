import type { Context } from '@deepseek-ai/cordis'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost } from '@dshfiles/dshx/host'
import { Effect } from 'effect'
import { ApplyPatchHost, applyPatchRootLayer, createApplyPatchTool } from './patch-tool.js'

const { hostApi: _hostApi, ...effectPlugin } = DshxEffect.plugin({
  layer: applyPatchRootLayer,
  setup: Effect.fn('apply patch setup')(function* (ctx: Context) {
    const services = yield* ApplyPatchHost
    yield* Effect.acquireRelease(
      Effect.sync(() => ctx.tools.register(createApplyPatchTool(services))),
      unregister => Effect.sync(unregister),
    )
  }),
})

export default defineHost({
  ...effectPlugin,
  name: '@dshfiles/apply-patch',
  inject: ['tools', 'fs', 'workingDirectory', 'sessions'],
})
