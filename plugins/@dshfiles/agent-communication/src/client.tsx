import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { AgentCommunicationPanel } from './agent-communication-panel.js'
import { AGENT_COMMUNICATION_LOCALE_NAMESPACE, agentCommunicationLocale } from './locales.js'

const PANEL_ID = 'agent-communication'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M4 5.5h16v11H9l-5 3v-14Z" />
    <path d="M8 10h8M8 13.5h5" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/agent-communication',
  locales: [agentCommunicationLocale],
  inject: ['slots', 'sessions', 'workspaces'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(AGENT_COMMUNICATION_LOCALE_NAMESPACE)
    const label = (): string => translate('title')
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 4, label, locale: AGENT_COMMUNICATION_LOCALE_NAMESPACE }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: AGENT_COMMUNICATION_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <AgentCommunicationPanel sessions={ctx.sessions} t={props.t} workspaces={ctx.workspaces} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
