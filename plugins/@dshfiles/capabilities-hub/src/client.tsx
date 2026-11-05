import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-host-plugin-inventory/remote'
import { defineClient } from '@dshfiles/dshx/client'
import { LayoutGridIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { DestinationSections } from '@dshfiles/thread-sidebar/destinations'
import { CapabilitiesHubPanel } from './hub-panel.js'

const PANEL_ID = 'dshfiles-capabilities-hub'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => <LayoutGridIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />

export default defineClient({
  name: '@dshfiles/capabilities-hub',
  inject: ['slots', 'layout', 'remote', 'remote.pluginInventory'],
  setup(ctx, decorate, metadata) {
    // Settings lists the hub beside the managers it opens; without the rail it stays a plain sidebar page.
    metadata?.plugin?.add(DestinationSections, {
      panelId: PANEL_ID,
      destination: 'settings',
      label: 'Capabilities hub',
      description: 'Skills, MCP servers and plugins in one place.',
      order: 0,
    })

    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (panelId: string): panelId is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === panelId)
    const openPanel = (panelId: string): void => {
      if (isMainPanelId(panelId)) ctx.layout.selectPanel(panelId)
    }
    const countPlugins = async () => {
      const result = await ctx.remote.pluginInventory.list()
      if (!result.ok) throw new Error(result.error.message)
      return { total: result.value.entries.length, enabled: result.value.entries.filter(entry => entry.enabled).length }
    }

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 7, label: () => 'Capabilities hub' }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <CapabilitiesHubPanel countPlugins={countPlugins} hasPanel={isMainPanelId} openPanel={openPanel} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
