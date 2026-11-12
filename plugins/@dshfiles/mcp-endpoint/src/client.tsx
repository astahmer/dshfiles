import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { defineClient } from '@dshfiles/dshx/client'
import { dispatchOpenSettings } from '@dshfiles/settings-shell/open-settings'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { EndpointSection } from './endpoint-section.js'

export default defineClient({
  name: '@dshfiles/mcp-endpoint',
  inject: ['slots'],
  setup(ctx, decorate, metadata) {
    metadata?.plugin?.add(PaletteActions, {
      id: '@dshfiles/mcp-endpoint/connect-client',
      label: 'MCP endpoint: connect a client',
      group: 'command',
      run: () => {
        dispatchOpenSettings({ section: 'dshfiles-mcp-endpoint' })
      },
    })
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
