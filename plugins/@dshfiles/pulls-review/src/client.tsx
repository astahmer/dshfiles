import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClientPlugin } from '@dshfiles/dshx/client'
import { GitPullRequest } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { PullsReviewPanel } from './panel.js'
import { createSessionFocus } from './session-focus.js'

const PANEL_ID = 'pulls-review'

export default defineClientPlugin({
  id: 'dshfiles-pulls-review',
  name: 'pulls.review',
  uses: ['ui'],
  inject: ['sidebarRight', 'sessions', 'workspaces'],
  setup(api) {
    const ctx = api.raw.ctx
    const focus = createSessionFocus(ctx.sidebarRight.mounted)
    ctx.effect(() => () => focus.dispose(), 'dshfiles-pulls-review: remember the on-screen thread')
    api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: 'pulls.review: Reviews' }, () => <GitPullRequest aria-hidden />)
    api.ui.register({ name: 'main', key: PANEL_ID }, () => (
      <PluginQueryProvider>
        <PullsReviewPanel focus={focus} sessions={ctx.sessions} workspaces={ctx.workspaces} />
      </PluginQueryProvider>
    ))
  },
})
