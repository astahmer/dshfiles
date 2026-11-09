import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-host-plugin-inventory/remote'
import { defineClient } from '@dshfiles/dshx/client'
import { LayoutGridIcon, StoreIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { DestinationSections } from '@dshfiles/thread-sidebar/destinations'
import { CapabilitiesHubPanel } from './hub-panel.js'
import { createPluginMarketPage } from './market-panel.js'
import { MARKET_SECTION_ID } from './plugin-market-page.js'

const PANEL_ID = 'dshfiles-capabilities-hub'
/** The marketplace page: a stage panel that frames the catalog section dshmarket registers. */
const MARKET_PANEL_ID = 'dshfiles-plugin-market'

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

    // The catalog is a settings section dshmarket owns; this page is only the Settings row that shows it, so the
    // surface keeps working on a profile with no market installed (it then says how to install it).
    metadata?.plugin?.add(DestinationSections, {
      panelId: MARKET_PANEL_ID,
      destination: 'settings',
      label: 'Plugin Market',
      description: 'Community plugins and themes, installed in one click.',
      order: 5,
    })
    const PluginMarketPanel = createPluginMarketPage({
      subscribe: listener => ctx.slots.subscribe('settings.section', listener),
      installed: () => ctx.slots.entriesOfSlot('settings.section').some(entry => entry.options.id === MARKET_SECTION_ID),
      owner: { close: () => ctx.layout.selectPanel(null) },
    })
    const MarketGlyph = (props: { readonly size?: number }): JSX.Element => <StoreIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: MARKET_PANEL_ID, order: 8, label: () => 'Plugin Market' }, MarketGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: MARKET_PANEL_ID, children: { 'settings.section': { kind: 'list', scope: 'root' } } },
        decorate(PluginMarketPanel),
      ),
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
