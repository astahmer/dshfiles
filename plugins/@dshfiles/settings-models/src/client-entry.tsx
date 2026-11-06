import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/settings-models',
  inject,
  setup(ctx) {
    // Use Cordis' native plugin boundary: this whole-row fork owns the stock Models settings registration.
    ctx.plugin({ apply, inject })
  },
})
