import { defineClient } from '@dshfiles/dshx/client'
import { apply } from './client/index.js'

export default defineClient({
  name: '@dshfiles/input-trigger',
  inject: ['sessions', 'locale', 'slots'],
  setup: ctx => apply(ctx),
})
