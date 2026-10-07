import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from '@deepseek-ai/dsh-api-session-controller/client/module'

export default defineClient({
  inject,
  setup(ctx) {
    apply(ctx)
  },
})
