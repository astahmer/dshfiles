import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { DevServersChip } from './dev-servers-chip.js'

export default defineClient({
  name: '@dshfiles/preview',
  inject: ['slots'],
  setup(ctx, decorate) {
    ctx.slots.inject('conversation.session.header.actions', () =>
      ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'dshfiles-preview-dev-servers', order: 20 },
        decorate(props => (
          <PluginQueryProvider>
            <DevServersChip sessionId={props.sessionId} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
