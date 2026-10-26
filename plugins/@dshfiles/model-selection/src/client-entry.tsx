import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/model-selection',
  inject,
  setup(ctx) {
    // Use Cordis' native plugin boundary: dshx's ClientContext names the stock
    // nominal resolver class, while this whole-row fork owns its replacement.
    ctx.plugin({ apply, inject })
  },
})
