import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@dshfiles/input-trigger/client'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'

import { backlogApi, BacklogViews } from './api.js'
import { BacklogMentions } from './backlog-mentions.js'
import { BacklogPanel } from './backlog-panel.js'

const PANEL_ID = 'dshfiles-backlog-panel'

export default defineClient({
  name: '@dshfiles/backlog',
  inject: ['slots', 'sessions', 'uiWorkspace', 'inputTriggers'],
  setup(ctx, decorate) {
    const api = createApiClient(ctx, backlogApi)
    const mentions = BacklogMentions.createSource({
      section: 'Backlog',
      search: async (query, limit, signal) => BacklogViews.list(await api.list({ query, freshness: 'active', limit }, { signal })).items,
    })
    ctx.effect(() => ctx.inputTriggers.registerSource(mentions), 'backlog: @ mentions')
    const PanelView = (): JSX.Element => (
      <PluginQueryProvider>
        <BacklogPanel
          listThreads={() => {
            const state = ctx.sessions.list.getSnapshot()
            return state.ids.flatMap(id => {
              const session = state.byId[id]
              if (session === undefined || session.blank || session.parentId !== undefined) return []
              const thread = { id: session.id, title: session.displayTitle, running: session.running }
              return [session.cwd === undefined ? thread : { ...thread, cwd: session.cwd }]
            })
          }}
          openThread={sessionId => {
            const session = Object.values(ctx.sessions.list.getSnapshot().byId).find(candidate => candidate?.id === sessionId)
            if (session !== undefined) ctx.uiWorkspace.openSession(session.id)
          }}
        />
      </PluginQueryProvider>
    )
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 3, label: 'Backlog' }, PanelGlyph))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, decorate(PanelView)))
  },
})

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg
    aria-hidden
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
    <rect x="10" y="4" width="5" height="10" rx="1.5" />
    <rect x="16.5" y="4" width="4" height="6" rx="1.5" />
  </svg>
)
