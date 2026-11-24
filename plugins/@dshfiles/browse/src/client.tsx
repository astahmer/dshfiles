import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Command, defineClient, useApi, useSettings, type PluginContext } from '@dshfiles/dshx/client'
import { GlobeIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { DestinationSections } from '@dshfiles/thread-sidebar/destinations'
import { useMemo } from 'react'
import { browseApi } from './api.js'
import { BrowsePanel, type BrowsePanelServices } from './browse-panel.js'
import { BROWSE_SETTINGS_DEFAULTS, browseSettings } from './settings.js'

export const BROWSE_PANEL_ID = 'dshfiles-browse'
const PANEL_LABEL = 'Browser (browse)'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => <GlobeIcon aria-hidden size={props.size ?? 18} strokeWidth={1.6} />

const ConnectedPanel = (): JSX.Element => {
  const api = useApi(browseApi)
  // The namespace is unregistered on a Host that predates this plugin: the defaults apply until it restarts.
  const settings = useSettings(browseSettings)
  const services = useMemo(
    (): BrowsePanelServices => ({
      status: signal => api.status({}, { signal }),
      pairings: signal => api.pairings({}, { signal }),
      startPairing: () => api.pairingStart({}),
      cancelPairing: () => api.pairingCancel({}),
      revoke: target => api.pairingRevoke({ target, confirm: true }),
    }),
    [api],
  )
  return <BrowsePanel pollIntervalMs={settings.value?.pollIntervalMs ?? BROWSE_SETTINGS_DEFAULTS.pollIntervalMs} services={services} />
}

export default defineClient({
  name: '@dshfiles/browse',
  inject: ['slots'],
  setup(ctx, decorate, metadata) {
    const plugin: PluginContext | undefined = metadata?.plugin
    plugin?.add(DestinationSections, {
      panelId: BROWSE_PANEL_ID,
      destination: 'agents',
      label: PANEL_LABEL,
      description: 'The browser agents drive: relay, pairing and tabs waiting on you.',
      order: 40,
    })
    plugin?.add(Command, {
      id: '@dshfiles/browse.open',
      title: PANEL_LABEL,
      keywords: ['browse', 'browser', 'pair', 'pairing', 'extension', 'relay', 'tabs', 'handoff', 'chrome'],
      run: () => {
        plugin.layout.openPanel(BROWSE_PANEL_ID)
      },
    })
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: BROWSE_PANEL_ID, order: 40, label: () => PANEL_LABEL }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: BROWSE_PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <ConnectedPanel />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
