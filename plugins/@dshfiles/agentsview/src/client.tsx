import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { AGENTSVIEW_LOCALE_NAMESPACE, agentsviewLocale } from './locales.js'
import { AgentSessionsPanel } from './panel.js'

const PANEL_ID = 'dshfiles-agentsview'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4z" />
    <path d="M17 9h3v8h-1v3l-3-3h-4" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/agentsview',
  locales: [agentsviewLocale],
  inject: ['slots'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(AGENTSVIEW_LOCALE_NAMESPACE)
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 7, label: () => translate('title'), locale: AGENTSVIEW_LOCALE_NAMESPACE },
        PanelGlyph,
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: AGENTSVIEW_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <AgentSessionsPanel t={props.t} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
