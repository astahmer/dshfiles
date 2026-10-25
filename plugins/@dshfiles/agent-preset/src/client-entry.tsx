import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/agent-preset',
  inject,
  setup(ctx) {
    apply(ctx)
  },
})
