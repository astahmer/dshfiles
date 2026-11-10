import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/cordis-client-runner',
  inject,
  setup(ctx) {
    // Use Cordis' native plugin boundary: this whole-row fork owns the dynamic-package runner and inspect registry.
    ctx.plugin({ apply, inject })
  },
})
