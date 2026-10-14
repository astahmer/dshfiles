import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import type { OpenThread } from './format.js'
import { UsagePanel } from './panel.js'
import './client.css'

const PANEL_ID = 'dshfiles-usage'

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
  >
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/usage',
  inject: ['slots', 'sessions', 'uiWorkspace'],
  setup(ctx, decorate) {
    /**
     * Open the thread a request belongs to. A subagent's own session is not
     * always in the thread list; its parent thread is the next best place.
     */
    const openThread: OpenThread = target => {
      const sessions = Object.values(ctx.sessions.list.getSnapshot().byId)
      const own = sessions.find(session => session?.id === target.sessionId)
      const parent = target.parentSessionId === null ? undefined : sessions.find(session => session?.id === target.parentSessionId)
      const destination = own ?? parent
      if (destination === undefined) return 'missing'
      ctx.uiWorkspace.openSession(destination.id)
      return own === undefined ? 'parent' : 'opened'
    }
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 4, label: 'Usage analytics' }, PanelGlyph))
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID },
        decorate(() => (
          <PluginQueryProvider>
            <UsagePanel openThread={openThread} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
