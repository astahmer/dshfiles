import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ActivityTimelinePanel } from './panel.js'
import { ACTIVITY_TIMELINE_LOCALE_NAMESPACE, activityTimelineLocale } from './locales.js'

const PANEL_ID = 'activity-timeline'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M4 6h16M4 12h10M4 18h13" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/activity-timeline',
  locales: [activityTimelineLocale],
  inject: ['slots', 'sessions', 'uiWorkspace', 'workspaces'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(ACTIVITY_TIMELINE_LOCALE_NAMESPACE)
    const label = (): string => translate('title')
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 3, label, locale: ACTIVITY_TIMELINE_LOCALE_NAMESPACE }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: ACTIVITY_TIMELINE_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <ActivityTimelinePanel sessions={ctx.sessions} uiWorkspace={ctx.uiWorkspace} workspaces={ctx.workspaces} t={props.t} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
