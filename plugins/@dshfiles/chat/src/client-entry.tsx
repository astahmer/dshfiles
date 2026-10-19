import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/chat',
  inject,
  setup(ctx) {
    apply(ctx)
  },
})
