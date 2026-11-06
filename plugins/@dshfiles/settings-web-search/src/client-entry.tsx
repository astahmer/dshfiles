import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/settings-web-search',
  inject,
  setup(ctx) {
    // Use Cordis' native plugin boundary: this whole-row fork owns the stock Web search settings page.
    ctx.plugin({ apply, inject })
  },
})
