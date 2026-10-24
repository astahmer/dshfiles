import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ApiClientLifecycle, defineClientPlugin } from '@dshfiles/dshx/client'
import { createSettingsClientRuntime, provideSettingsContext } from '@dshfiles/dshx/settings'
import { GitPullRequest } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import type { ReactNode } from 'react'
import { PullsReviewPanel } from './panel.js'
import { REVIEW_TAB_ID, REVIEW_TAB_KIND, REVIEW_TAB_PATTERN, createReviewTabBody } from './review-tab.js'
import { ReviewModel } from './review-model.js'
import { createSessionFocus } from './session-focus.js'
import { reviewSettings } from './settings.js'
import './client.css'

const PANEL_ID = 'pulls-review'
const MAIN_PANEL_ID = 'pulls-review'

export default defineClientPlugin({
  id: 'dshfiles-pulls-review',
  name: 'pulls.review',
  uses: ['ui'],
  inject: ['sidebarRight', 'sidebarRightTabs', 'sessions'],
  setup(api) {
    const ctx = api.raw.ctx
    const focus = createSessionFocus(ctx.sidebarRight.mounted)
    ctx.effect(() => () => focus.dispose(), 'dshfiles-pulls-review: remember the on-screen thread')

    const openMainPage = (): void => {
      if (ctx.get('layout') === undefined) return
      try {
        ctx.layout.selectPanel(MAIN_PANEL_ID as MainPanelId)
      } catch {
        // A profile without the frame layout keeps the Sidebar review; the page is not reachable there.
      }
    }

    api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: 'pulls.review' }, () => <GitPullRequest aria-hidden />)
    // The main-area page reads the on-screen thread's workspace, so a panel click needs no extra navigation.
    const Page = (): ReactNode => (
      <PluginQueryProvider>
        <PullsReviewPanel focus={focus} sessions={ctx.sessions} />
      </PluginQueryProvider>
    )
    api.ui.register({ name: 'main', key: PANEL_ID }, Page)

    const settingsRuntime = createSettingsClientRuntime(ctx)
    const settings = settingsRuntime.binding(reviewSettings)
    let disposeTakeover: (() => void) | undefined

    const takeover = (): (() => void) => {
      const unregisterType = ctx.sidebarRightTabs.register({
        id: REVIEW_TAB_ID,
        kind: REVIEW_TAB_KIND,
        patterns: [REVIEW_TAB_PATTERN],
        priority: 'extension',
        canOpen: address => ReviewModel.parseChangesReviewAddress(address) !== undefined,
        title: address => {
          const source = ReviewModel.parseChangesReviewAddress(address)
          return source === undefined ? 'Review' : `Review · turn ${String(source.turn)}`
        },
      })
      const TabBody = provideSettingsContext(
        ApiClientLifecycle.provide(
          createReviewTabBody({ sessions: ctx.sessions, onExpand: openMainPage }),
          ApiClientLifecycle.create(ctx, 'dshfiles-pulls-review'),
        ),
        settingsRuntime,
      )
      const body = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: REVIEW_TAB_ID }, TabBody))
      return () => {
        body()
        unregisterType()
      }
    }

    const syncTakeover = (): void => {
      const classic = settings.scope.getSnapshot().value?.classicReviewTab === true
      if (classic) {
        disposeTakeover?.()
        disposeTakeover = undefined
        return
      }
      disposeTakeover ??= ctx.effect(takeover, 'dshfiles-pulls-review: all-files changes-review tab')
    }

    syncTakeover()
    ctx.effect(() => settings.scope.subscribe(syncTakeover), 'dshfiles-pulls-review: classic review tab setting')
  },
})
