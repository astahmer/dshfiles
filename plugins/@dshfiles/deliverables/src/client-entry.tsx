import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/deliverables',
  inject,
  setup(ctx) {
    // Use Cordis' native plugin boundary: this whole-row fork owns the stock changed-files card, review tab and delivery cards.
    ctx.plugin({ apply, inject })
  },
})
