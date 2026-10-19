import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/client/index.ts'

export default defineClient({
  name: '@dshfiles/session-controller',
  inject,
  setup(ctx) {
    apply(ctx)
  },
})
