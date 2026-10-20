import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.ts'

export default defineClient({
  name: '@dshfiles/chat',
  inject: [...inject, 'connection'],
  setup(ctx, decorate) {
    apply(ctx, decorate)
  },
})
