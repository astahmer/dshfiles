import { defineClient } from '@dshfiles/dshx/client'
import { apply, inject } from './native/client/index.js'

export default defineClient({ name: '@dshfiles/sidebar-right', inject, setup(ctx) { apply(ctx) } })
