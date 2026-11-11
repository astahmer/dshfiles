import { defineClient } from '@dshfiles/dshx/client'
import { attachTerminalExcerpt } from './excerpt-attach.ts'
import { apply, inject } from './native/client/index.ts'

export default defineClient({
  name: '@dshfiles/sidebar-terminal',
  inject,
  setup(ctx, _decorate, metadata) {
    const composer = metadata?.plugin
    apply(ctx, (sessionId, excerpt) => attachTerminalExcerpt({ composer, sessionId, excerpt }))
  },
})
