import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { JjIntegrationPanel } from './panel.js'
import { WorkspaceStatusChip } from './workspace-chip.js'
import { JJ_INTEGRATION_LOCALE_NAMESPACE, jjIntegrationLocale } from './locales.js'
import './client.css'

const PANEL_ID = 'jj-integration'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M6 4v16M18 4v16M6 9h7a4 4 0 0 1 4 4v3" />
    <circle cx="6" cy="4" r="1.6" />
    <circle cx="18" cy="20" r="1.6" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/jj-integration',
  locales: [jjIntegrationLocale],
  inject: ['slots', 'layout'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(JJ_INTEGRATION_LOCALE_NAMESPACE)
    const label = (): string => translate('title')
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label, locale: JJ_INTEGRATION_LOCALE_NAMESPACE }, PanelGlyph),
    )
    // The composer's existing leading control row, so the status costs no
    // vertical space and never sits between the user and the input.
    ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: 'jj-integration-status',
          order: 4,
          locale: JJ_INTEGRATION_LOCALE_NAMESPACE,
          inject: (sessionId: string) => ({ sessionId }),
        },
        decorate(props => (
          <PluginQueryProvider>
            <WorkspaceStatusChip
              sessionId={props.sessionId}
              t={props.t}
              onOpen={() => ctx.layout.selectPanel(PANEL_ID as MainPanelId)}
            />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: JJ_INTEGRATION_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <JjIntegrationPanel t={props.t} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
