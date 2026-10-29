import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { EndpointSection } from './endpoint-section.js'

export default defineClient({
  name: '@dshfiles/mcp-endpoint',
  inject: ['slots'],
  setup(ctx, decorate) {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          registrant: '@dshfiles/mcp-endpoint',
          id: 'dshfiles-mcp-endpoint',
          order: 36,
          label: () => 'MCP endpoint',
        },
        decorate(() => (
          <PluginQueryProvider>
            <EndpointSection />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
