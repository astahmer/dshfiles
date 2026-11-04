import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { diffViewedApi } from '@dshfiles/diff-viewed/marks-api'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { Changes, createApiClient, defineClientPlugin, hostStorage } from '@dshfiles/dshx/client'
import { GitPullRequest } from '@dshfiles/plugin-ui/icons'
import { createWorkspacePickerPorts } from '@dshfiles/workspace-folder-picker/picker'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useEffect, useSyncExternalStore } from 'react'
import { ChangesFacet } from './changes-facet.js'
import { ChangesScopeModel, type ChangesRequest } from './changes-scope.js'
import { PullsReviewPanel, type OpenInThread } from './panel.js'
import { PageReviewContextModel } from './review-page-context.js'
import { ReviewedMarksModel } from './reviewed.js'
import { createSessionFocus } from './session-focus.js'

const PANEL_ID = 'pulls-review'
/** The thread panel's Changes facet: one page per thread, opened by kind. */
const CHANGES_TAB_ID = '@dshfiles/pulls-review/changes'
const CHANGES_TAB_KIND = 'dshfiles-pulls-review-changes'
/** Claims a turn's "Edited N files" card address and hands it to the facet scoped to that turn. */
const TURN_LINK_ID = '@dshfiles/pulls-review/turn-link'
const TURN_LINK_KIND = 'dshfiles-pulls-review-turn-link'
/** How long "Open in thread" waits for the chosen thread to come on screen before it gives up quietly. */
const OPEN_IN_THREAD_TIMEOUT_MS = 5_000
/** One diff-viewed batch write carries at most this many marks. */
const MIGRATION_BATCH = 4_000

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dshfiles-pulls-review-changes': ChangesRequest
  }
}

const noSession = (): undefined => undefined

export default defineClientPlugin({
  id: 'dshfiles-pulls-review',
  name: 'pulls.review',
  uses: ['ui'],
  inject: ['layout', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'uiWorkspace', 'remote', 'remote.directoryPicker', 'remote.workspace'],
  setup(api) {
    const ctx = api.raw.ctx
    const focus = createSessionFocus(ctx.sidebarRight.mounted)
    const workspacePicker = createWorkspacePickerPorts(ctx.remote)
    ctx.effect(() => () => focus.dispose(), 'dshfiles-pulls-review: remember the on-screen thread')

    // Marks the Review page kept here before diff-viewed owned every viewed mark move there once; then this record
    // empties. A failed write leaves the record in place, so the next load tries again and nothing is lost.
    const reviewedSchema = zodSchemaFromEffect(ReviewedMarksModel.schema)
    const reviewed = hostStorage(api).store({ key: 'reviewed', scope: 'global', schema: reviewedSchema, initial: {} })
    const viewedMarks = createApiClient(ctx, diffViewedApi)
    void reviewed.ready
      .then(async () => {
        const legacyText = globalThis.localStorage?.getItem(ReviewedMarksModel.legacyBrowserKey) ?? 'null'
        globalThis.localStorage?.removeItem(ReviewedMarksModel.legacyBrowserKey)
        const legacy = reviewedSchema.safeParse(JSON.parse(legacyText))
        if (legacy.success && Object.keys(reviewed.get()).length === 0) reviewed.set(legacy.data)
        const targets = ReviewedMarksModel.migrationTargets(reviewed.get())
        for (let index = 0; index < targets.length; index += MIGRATION_BATCH)
          await viewedMarks.set({ targets: targets.slice(index, index + MIGRATION_BATCH), viewed: true })
        if (Object.keys(reviewed.get()).length > 0) reviewed.set({})
      })
      .catch((error: unknown) => console.warn('pulls.review: earlier reviewed marks stay where they were until diff-viewed answers.', error))

    const openHistory = (): void => {
      api.layout.openPanel('dshfiles-jujutsu')
    }
    /** Bring a thread on screen, then open its Changes facet once its right pane follows it. */
    const openInThread: OpenInThread = (sessionId, request) => {
      const openIfShown = (): boolean => {
        if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return false
        ctx.sidebarRight.openTab(CHANGES_TAB_KIND, { revealIfOpened: true, params: request ?? { scope: 'thread' } })
        return true
      }
      if (openIfShown()) return true
      ctx.uiWorkspace.openSession(SessionId(sessionId))
      if (openIfShown()) return true
      // The right pane follows the thread a moment after it comes on screen; a page still loading may never announce it,
      // so the timeout checks once more before giving up.
      let stop = (): void => {}
      const timer = setTimeout(() => {
        stop()
        openIfShown()
      }, OPEN_IN_THREAD_TIMEOUT_MS)
      stop = ctx.sidebarRight.mounted.subscribe(() => {
        if (!openIfShown()) return
        clearTimeout(timer)
        stop()
      })
      return true
    }

    api.ui.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 40, label: 'Review' }, () => <GitPullRequest aria-hidden />)
    api.provide(Changes, {
      review: input => {
        if (input.sessionId !== undefined) return openInThread(input.sessionId)
        PageReviewContextModel.set({ workspacePath: input.workspacePath, sessionId: input.sessionId })
        return api.layout.openPanel(PANEL_ID)
      },
    })
    api.ui.register({ name: 'main', key: PANEL_ID }, () => (
      <PluginQueryProvider>
        <PullsReviewPanel focus={focus} openInThread={openInThread} sessions={ctx.sessions} workspacePicker={workspacePicker} />
      </PluginQueryProvider>
    ))

    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: CHANGES_TAB_ID,
          kind: CHANGES_TAB_KIND,
          title: () => 'Changes',
          guide: [
            {
              id: 'changes',
              order: 20,
              title: () => 'Changes',
              description: () => "Review this thread's changes by turn or revision, mark files viewed and land the work.",
              icon: ChangesGlyph,
            },
          ],
        }),
      'dshfiles-pulls-review: Changes facet tab type',
    )
    const ChangesTab = (props: { readonly useTabInfo: UseSidebarRightTabInfo }): JSX.Element => {
      const { tab } = props.useTabInfo()
      const sessionId = useSyncExternalStore(focus.subscribe, focus.getSnapshot, noSession)
      const request = ChangesScopeModel.decodeRequest(tab.navigation.params)
      return (
        <PluginQueryProvider>
          <ChangesFacet
            openHistory={openHistory}
            request={request}
            requestRevision={tab.navigation.revision}
            sessionId={sessionId === undefined ? undefined : String(sessionId)}
            sessions={ctx.sessions}
          />
        </PluginQueryProvider>
      )
    }
    api.ui.register({ name: 'sidebar.right.pane.tab', key: CHANGES_TAB_ID }, ChangesTab)

    // A turn's card opens `dsh-resource://changes-review/session/…`; this type outranks the native review tab
    // (`builtin` band) for those addresses, opens the one Changes facet on that turn and closes itself.
    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: TURN_LINK_ID,
          kind: TURN_LINK_KIND,
          patterns: [ChangesScopeModel.turnAddressPattern],
          priority: 'extension',
          canOpen: address => ChangesScopeModel.parseTurnAddress(address) !== undefined,
          title: () => 'Changes',
        }),
      'dshfiles-pulls-review: claim turn change cards',
    )
    const TurnLinkRedirect = (props: { readonly useTabInfo: UseSidebarRightTabInfo }): null => {
      const { tab } = props.useTabInfo()
      const address = tab.navigation.address
      const revision = tab.navigation.revision
      const actions = tab.actions
      useEffect(() => {
        const turn = ChangesScopeModel.parseTurnAddress(address)
        if (turn !== undefined) ctx.sidebarRight.openTab(CHANGES_TAB_KIND, { revealIfOpened: true, params: { scope: 'turn', seq: turn.seq, turn: turn.turn } })
        actions.close()
      }, [address, revision, actions])
      return null
    }
    api.ui.register({ name: 'sidebar.right.pane.tab', key: TURN_LINK_ID }, TurnLinkRedirect)
  },
})

const ChangesGlyph = (props: { readonly size?: number | undefined }): JSX.Element => <GitPullRequest aria-hidden size={props.size ?? 18} />
