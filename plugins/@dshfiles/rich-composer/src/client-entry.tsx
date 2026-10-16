import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/index.js'

export default defineClient({
  name: '@dshfiles/rich-composer',
  inject,
  setup(ctx) {
    apply(ctx)
  },
})
