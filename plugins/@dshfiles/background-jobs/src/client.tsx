import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { BackgroundJobsPanel } from './panel.js'
import { BACKGROUND_JOBS_LOCALE_NAMESPACE, backgroundJobsLocale } from './locales.js'

const PANEL_ID = 'dshfiles-background-jobs'

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
    <path d="M4 6h16M4 12h16M4 18h10" />
    <circle cx="19" cy="18" r="1.4" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/background-jobs',
  locales: [backgroundJobsLocale],
  inject: ['slots', 'sessions', 'uiWorkspace'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(BACKGROUND_JOBS_LOCALE_NAMESPACE)
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => translate('title'), locale: BACKGROUND_JOBS_LOCALE_NAMESPACE },
        PanelGlyph,
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: BACKGROUND_JOBS_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <BackgroundJobsPanel sessions={ctx.sessions} uiWorkspace={ctx.uiWorkspace} t={props.t} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
