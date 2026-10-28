import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { defineClient } from '@dshfiles/dshx/client'
import { ServerIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { HostsPage } from './destination/hosts-page.js'
import { HOSTS_PANEL_ID, OPEN_HOSTS_EVENT } from './destination/state.js'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteThreadView } from './remote-thread-view.js'
import { RemoteHostFallback } from './remote-host-fallback.js'

const HostsGlyph = (props: { readonly size?: number }): JSX.Element => <ServerIcon aria-hidden size={props.size ?? 18} strokeWidth={1.5} />

export default defineClient({
  name: '@dshfiles/multi-host',
  inject: ['slots', 'layout', 'uiWorkspace', 'sessions'],
  setup(ctx, decorate) {
    const openRemoteSession = (rawSessionId: string): void => {
      const sessionId = SessionId(rawSessionId)
      const openIfListed = (): void => {
        if (!ctx.sessions.list.getSnapshot().ids.includes(sessionId)) {
          console.error(`multi-host: remote Session ${sessionId} is absent after refreshing the local Session list`)
          return
        }
        ctx.uiWorkspace.openSession(sessionId)
      }
      if (ctx.sessions.list.getSnapshot().ids.includes(sessionId)) {
        openIfListed()
        return
      }
      void ctx.sessions
        .refresh()
        .then(openIfListed)
        .catch(error => {
          console.error('multi-host: could not refresh the local Session list before opening a remote Session', error)
        })
    }
    const isMainPanelId = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)
    const openHosts = (): void => {
      if (isMainPanelId(HOSTS_PANEL_ID)) ctx.layout.selectPanel(HOSTS_PANEL_ID)
    }
    ctx.effect(() => {
      window.addEventListener(OPEN_HOSTS_EVENT, openHosts)
      return () => window.removeEventListener(OPEN_HOSTS_EVENT, openHosts)
    }, 'multi-host: open hosts page')
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: 'dshfiles-multi-host-hosts', order: 8, label: 'Multi-host: Hosts' }, HostsGlyph),
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
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'dshfiles-multi-host-open-remote-host',
          order: 42,
          inject: sessionId => ({ sessionId }),
        },
        decorate((props: { readonly sessionId: SessionId }) => (
          <PluginQueryProvider>
            <RemoteHostFallback sessionId={props.sessionId} />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: 'dshfiles-multi-host-thread' },
        decorate(() => (
          <PluginQueryProvider>
            <RemoteThreadView onOpenSession={openRemoteSession} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
