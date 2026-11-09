import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/schedule',
  inject,
  setup(ctx) {
    // Use Cordis' native plugin boundary: this whole-row fork owns the stock Tasks page and reminder catalogs.
    ctx.plugin({ apply, inject })
  },
})
