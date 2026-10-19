import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/client/index.js'
// Type-only: puts the `shell.dock` seat declaration in this program.
import type {} from './regions.js'

export default defineClient({
  name: '@dshfiles/frame-layout',
  inject,
  setup(ctx) {
    apply(ctx)
  },
})
