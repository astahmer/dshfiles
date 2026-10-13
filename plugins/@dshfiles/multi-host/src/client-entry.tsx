import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { RemoteThreadView } from './remote-thread-view.js'
import './client.css'

export default defineClient({
  name: '@dshfiles/multi-host',
  inject: ['slots'],
  setup(ctx, decorate) {
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: 'dshfiles-multi-host-thread' },
        decorate(() => (
          <PluginQueryProvider>
            <RemoteThreadView />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
