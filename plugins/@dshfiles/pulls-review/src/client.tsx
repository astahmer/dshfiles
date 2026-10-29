import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { Changes, defineClientPlugin, hostStorage } from '@dshfiles/dshx/client'
import { GitPullRequest } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { PullsReviewPanel } from './panel.js'
import { PageReviewContextModel } from './review-page-context.js'
import { ReviewedMarksModel } from './reviewed.js'
import { createSessionFocus } from './session-focus.js'

const PANEL_ID = 'pulls-review'

export default defineClientPlugin({
  id: 'dshfiles-pulls-review',
  name: 'pulls.review',
  uses: ['ui'],
  inject: ['layout', 'sidebarRight', 'sessions', 'workspaces'],
  setup(api) {
    const ctx = api.raw.ctx
    const focus = createSessionFocus(ctx.sidebarRight.mounted)
    ctx.effect(() => () => focus.dispose(), 'dshfiles-pulls-review: remember the on-screen thread')
    const reviewed = hostStorage(api).store({ key: 'reviewed', scope: 'global', schema: ReviewedMarksModel.schema, initial: {} })
    void reviewed.ready
      .then(() => {
        const legacyText = globalThis.localStorage?.getItem(ReviewedMarksModel.legacyBrowserKey) ?? 'null'
        globalThis.localStorage?.removeItem(ReviewedMarksModel.legacyBrowserKey)
        const legacy = ReviewedMarksModel.schema.safeParse(JSON.parse(legacyText))
        if (legacy.success && Object.keys(reviewed.get()).length === 0) reviewed.set(legacy.data)
      })
      .catch((error: unknown) => console.warn('pulls.review: reviewed marks stay unsaved until the Host storage answers.', error))
    api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: 'pulls.review: Reviews' }, () => <GitPullRequest aria-hidden />)
    api.provide(Changes, {
      review: input => {
        PageReviewContextModel.set({ workspacePath: input.workspacePath, sessionId: input.sessionId })
        return api.layout.openPanel(PANEL_ID)
      },
    })
    api.ui.register({ name: 'main', key: PANEL_ID }, () => (
      <PluginQueryProvider>
        <PullsReviewPanel focus={focus} sessions={ctx.sessions} workspaces={ctx.workspaces} reviewed={reviewed} />
      </PluginQueryProvider>
    ))
  },
})
