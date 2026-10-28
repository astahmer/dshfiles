import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConvViewOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ChatTurnActionExtras } from '@dshfiles/chat/chat-focus'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { AlertNotifier } from './alerts/alert-notifier.js'
import { TRACES_ALERTS_LOCALE_NAMESPACE, tracesAlertsLocale } from './alerts/alerts-locale.js'
import { TRACES_LOCALE_NAMESPACE, tracesLocale } from './locales.js'
import { createThreadOpener } from './open-thread.js'
import { TracesPanel } from './panel.js'
import { SessionRequestsView } from './session-requests-view.js'
import { SessionTracesView } from './session-view.js'
import { ThreadLinks } from './thread-links.js'
import { TurnTraceButton } from './turn-trace-button.js'
import { storedTracesView } from './view-state.js'

const PANEL_ID = 'traces'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M3 6h9M6 12h12M9 18h8" />
    <path d="M3 3v18" strokeOpacity="0.5" />
  </svg>
)

type SessionViewProps = { readonly sessionId: string } & Partial<Pick<ConvViewOwnerProps, 'viewRequest' | 'openView' | 'completeViewRequest'>>

export default defineClient({
  name: '@dshfiles/traces',
  locales: [tracesLocale, tracesAlertsLocale],
  inject: ['slots', 'layout', 'sessions', 'uiWorkspace', 'workspaces'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(TRACES_LOCALE_NAMESPACE)
    const label = (): string => translate('title')
    const translateAlerts = ctx.locale.bind(TRACES_ALERTS_LOCALE_NAMESPACE)
    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (panelId: string): panelId is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === panelId)
    const openAlerts = (): void => {
      storedTracesView.set({ ...storedTracesView.get(), tab: 'alerts' })
      if (isMainPanelId(PANEL_ID)) ctx.layout.selectPanel(PANEL_ID)
    }
    const openThread = createThreadOpener({
      sessions: ctx.sessions,
      workspaces: ctx.workspaces,
      uiWorkspace: ctx.uiWorkspace,
      unavailable: () => translate('threadUnavailable'),
    })
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 4, label: () => `Traces: ${translate('viewExplorer')}`, locale: TRACES_LOCALE_NAMESPACE },
        PanelGlyph,
      ),
    )
    // A conversation view tab after the native Trajectory view (order 10); Chat is 0.
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        { name: 'conversation.view', id: ThreadLinks.viewId, order: 11, label, locale: TRACES_LOCALE_NAMESPACE, inject: sessionId => ({ sessionId }) },
        decorate((props: SessionViewProps) => (
          <PluginQueryProvider>
            <SessionTracesView {...props} openThread={openThread} t={translate} />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        {
          name: 'conversation.view',
          id: 'dshfiles-traces-requests',
          order: 12,
          label: () => translate('tabRequests'),
          locale: TRACES_LOCALE_NAMESPACE,
          inject: sessionId => ({ sessionId }),
        },
        decorate((props: SessionViewProps) => (
          <PluginQueryProvider>
            <SessionRequestsView
              {...props}
              openThread={target => {
                const opened = openThread({ sessionId: target.sessionId, focus: null })
                if (opened === null) return 'opened'
                if (target.parentSessionId !== null && openThread({ sessionId: target.parentSessionId, focus: null }) === null) return 'parent'
                return 'missing'
              }}
            />
          </PluginQueryProvider>
        )),
      ),
    )
    // Join the completed Turn's action row beside copy, branch and usage controls.
    ctx.slots.inject('conversation.chat.assistant-actions', () =>
      ctx.slots.register(
        { name: 'conversation.chat.assistant-actions', id: 'dshfiles-traces-turn-trace', order: 90, locale: TRACES_LOCALE_NAMESPACE },
        (props: ChatTurnActionExtras) => (props.turn === undefined ? null : <TurnTraceButton turn={props.turn.turn} openView={props.openView} t={translate} />),
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: TRACES_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <TracesPanel sessions={ctx.sessions} workspaces={ctx.workspaces} uiWorkspace={ctx.uiWorkspace} t={props.t} tAlerts={translateAlerts} />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-traces-alert-notifier', order: 123 },
        decorate(() => (
          <PluginQueryProvider>
            <AlertNotifier onOpenAlerts={openAlerts} t={translateAlerts} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
