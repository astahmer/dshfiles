import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { ServerIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { HostsPage } from './destination/hosts-page.js'
import { HOSTS_PANEL_ID, OPEN_HOSTS_EVENT } from './destination/state.js'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteThreadView } from './remote-thread-view.js'
import { multiHostApi } from './api.js'
import { watchRemoteInteractions } from './interaction-feed.js'
import { RemoteApprovalPanel } from './remote-approval-panel.js'
import { PendingRemoteApproval, RemoteApprovals } from './remote-approvals.js'
import { RemoteHostFallback } from './remote-host-fallback.js'
import { RemoteTerminalPanel, RemoteTerminalTitle } from './remote-terminal-panel.js'

const REMOTE_TERMINAL_ENTRY = 'dshfiles-multi-host-remote-terminal'

interface SidebarRightSubstitutes {
  readonly substituteTab?: (kind: string, substitute: (sessionId: SessionId) => Promise<string | undefined>) => () => void
}

const HostsGlyph = (props: { readonly size?: number }): JSX.Element => <ServerIcon aria-hidden size={props.size ?? 18} strokeWidth={1.5} />

export default defineClient({
  name: '@dshfiles/multi-host',
  inject: ['slots', 'layout', 'uiWorkspace', 'sessions', 'uiSession', 'sidebarRight'],
  setup(ctx, decorate) {
    const openRemoteSession = (rawSessionId: string): void => {
      const sessionId = SessionId(rawSessionId)
      const openIfListed = (): void => {
        const session = ctx.sessions.list.getSnapshot().byId[sessionId]
        if (session === undefined || session.blank) {
          console.error(`multi-host: remote Session ${sessionId} is absent or blank after refreshing the local Session list`)
          return
        }
        ctx.uiWorkspace.openSession(sessionId)
      }
      if (ctx.sessions.list.getSnapshot().byId[sessionId] !== undefined) {
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
    const api = createApiClient(ctx, multiHostApi, '@dshfiles/multi-host')
    const approvals = new RemoteApprovals({
      publish: ctx.uiSession.registerPendingInteraction<PendingRemoteApproval>(() => 0),
      decide: input => api.sessionApprovalDecide(input),
    })
    ctx.effect(() => watchRemoteInteractions({ client: api, onChange: rows => approvals.sync(rows) }), 'multi-host: remote interactions')
    ctx.effect(() => () => approvals.dispose(), 'multi-host: remote approval cards')
    ctx.slots.inject('conversation.composer', () =>
      ctx.slots.register(
        {
          name: 'conversation.composer',
          // Above the question chain, as the native approval panel is: a tool call cannot run until it is decided.
          priority: 1,
          select: ({ pendingInteraction }) => (pendingInteraction instanceof PendingRemoteApproval ? pendingInteraction : null),
        },
        RemoteApprovalPanel,
      ),
    )
    // A terminal belongs to a live agent, and a mirrored thread has none here. An older sidebar lacks this verb and keeps
    // its own body, which reports the failure itself.
    // SAFETY: only the owned sidebar has this verb; it is optional here, and stock DSH leaves it undefined.
    const sidebarRight = ctx.sidebarRight as typeof ctx.sidebarRight & SidebarRightSubstitutes
    if (sidebarRight.substituteTab !== undefined) {
      ctx.effect(
        () =>
          sidebarRight.substituteTab?.('terminal', async sessionId => {
            const owner = await api.sessionRuntime({ sessionId })
            return owner.ok && owner.runtimeId !== null ? REMOTE_TERMINAL_ENTRY : undefined
          }) ?? (() => undefined),
        'multi-host: remote terminals go to the host',
      )
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: REMOTE_TERMINAL_ENTRY, inject: sessionId => ({ sessionId }) },
          decorate((props: { readonly sessionId: SessionId }) => (
            <PluginQueryProvider>
              <RemoteTerminalPanel sessionId={props.sessionId} />
            </PluginQueryProvider>
          )),
        ),
      )
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: REMOTE_TERMINAL_ENTRY }, RemoteTerminalTitle),
      )
    }
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
