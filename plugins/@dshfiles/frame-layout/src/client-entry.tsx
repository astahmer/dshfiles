import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/client/index.js'

export default defineClient({
  name: '@dshfiles/frame-layout',
  inject,
  setup(ctx) {
    apply(ctx)
  },
})
