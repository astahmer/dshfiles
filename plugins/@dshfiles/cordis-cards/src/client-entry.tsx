import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/cordis-cards',
  inject,
  setup(ctx) {
    // Use Cordis' native plugin boundary: this whole-row fork owns the Cordis cards, panel and inventory.
    ctx.plugin({ apply, inject })
  },
})
