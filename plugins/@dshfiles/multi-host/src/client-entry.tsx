import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { defineClient } from '@dshfiles/dshx/client'
import { ServerIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { HostsPage } from './destination/hosts-page.js'
import { HOSTS_PANEL_ID, OPEN_HOSTS_EVENT } from './destination/state.js'
import { RemoteThreadView } from './remote-thread-view.js'

const HostsGlyph = (props: { readonly size?: number }): JSX.Element => <ServerIcon aria-hidden size={props.size ?? 18} strokeWidth={1.5} />

export default defineClient({
  name: '@dshfiles/multi-host',
  inject: ['slots', 'layout'],
  setup(ctx, decorate) {
    const isMainPanelId = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)
    const openHosts = (): void => {
      if (isMainPanelId(HOSTS_PANEL_ID)) ctx.layout.selectPanel(HOSTS_PANEL_ID)
    }
    ctx.effect(() => {
      window.addEventListener(OPEN_HOSTS_EVENT, openHosts)
      return () => window.removeEventListener(OPEN_HOSTS_EVENT, openHosts)
    }, 'multi-host: open hosts page')
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: 'dshfiles-multi-host-hosts', order: 8, label: 'Hosts' }, HostsGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: 'dshfiles-multi-host-hosts' },
        decorate(() => (
          <PluginQueryProvider>
            <HostsPage />
          </PluginQueryProvider>
        )),
      ),
    )
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
