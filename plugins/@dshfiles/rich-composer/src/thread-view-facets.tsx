/**
 * Productivity pass Q5 (E5): the thread's secondary views (Trajectory, Traces, Requests…) are facets of the thread
 * panel, not tabs in the thread header. Each registered non-Chat `conversation.view` becomes a page type of the right
 * pane with a guide entry; the Workbench lists every guide entry in its panes' "Choose a view", so Free docking gets
 * them as movable panes too (D6). The page body renders the view through the same authorized `conversation.session`
 * declarer the Workbench conversation-view panels use: the view's own owner props (view requests included) reach it,
 * and no second composer mounts.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { ThreadViewsModel, type ThreadView } from './thread-views.js'

/** Renders one view of one thread; absent while the conversation shell has not mounted its declarer yet. */
export type ThreadViewPanel = ComponentType<{ readonly sessionId: SessionId; readonly viewId: string }>

const ViewGlyph = (props: { readonly size?: number | undefined }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M4 6h10M4 12h16M4 18h7" />
  </svg>
)

/** Guide order: after the built-in facets (Changes … Jobs at 60), before plugin extras. */
const FACET_ORDER = 70

export class ThreadViewFacets {
  /**
   * Keep one right-pane page type per secondary view, in step with the view ledger, and answer open requests from
   * {@link ThreadViewsModel.open} (the header `⋯`, a turn's Trace button) by opening that page for the thread on screen.
   * Lives as long as `ctx` and the right pane's services do.
   */
  static register(input: {
    readonly ctx: Context
    readonly views: ObservableSnapshot<readonly ThreadView[]>
    readonly panel: ObservableSnapshot<{ readonly Panel: ThreadViewPanel } | undefined>
    /** Bring a thread on screen (the panel follows it); the facet opens once it is. */
    readonly openThread: (sessionId: SessionId) => void
  }): void {
    const { ctx, views, panel, openThread } = input
    const FacetBody = ({ sessionId, viewId }: { readonly sessionId: SessionId; readonly viewId: string }): ReactNode => {
      const Panel = useSyncExternalStore(panel.subscribe, panel.getSnapshot, panel.getSnapshot)?.Panel
      if (Panel === undefined) return <div role="status">Loading thread view…</div>
      return (
        <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col" data-thread-view-facet={viewId}>
          <Panel sessionId={sessionId} viewId={viewId} />
        </div>
      )
    }
    const registered = new Map<string, { readonly label: string; readonly dispose: () => void }>()
    let disposeOpen: (() => void) | undefined
    ctx.inject(['sidebarRightTabs', 'sidebarRight'], scope => {
      const tabs = scope.get('sidebarRightTabs')
      const sidebarRight = scope.get('sidebarRight')
      if (tabs === undefined || sidebarRight === undefined) return
      const sync = (): void => {
        const current = views.getSnapshot()
        const wanted = new Set(current.map(view => view.id))
        for (const [viewId, entry] of registered) {
          const view = current.find(candidate => candidate.id === viewId)
          if (view !== undefined && view.label === entry.label) continue
          entry.dispose()
          registered.delete(viewId)
        }
        current.forEach((view, index) => {
          if (registered.has(view.id) || !wanted.has(view.id)) return
          const kind = ThreadViewsModel.facetKind(view.id)
          const disposeType = tabs.register({
            id: kind,
            kind,
            title: () => view.label,
            guide: [{ id: `thread-view-${view.id}`, order: FACET_ORDER + index, title: () => view.label, icon: ViewGlyph }],
          })
          const Body = (props: PropsRuntime<'sidebar.right.pane.tab'>): ReactNode => <FacetBody sessionId={props.sessionId} viewId={view.id} />
          const disposeBody = ctx.slots.register({ name: 'sidebar.right.pane.tab', key: kind }, Body)
          registered.set(view.id, {
            label: view.label,
            dispose: () => {
              disposeBody()
              disposeType()
            },
          })
        })
      }
      const offViews = views.subscribe(sync)
      sync()
      const releaseHost = ThreadViewsModel.host()
      let pending: (() => void) | undefined
      const openFacet = (viewId: string): boolean => {
        try {
          sidebarRight.openTab(ThreadViewsModel.facetKind(viewId), { revealIfOpened: true })
          return true
        } catch {
          return false
        }
      }
      disposeOpen = ThreadViewsModel.handle(request => {
        if (!views.getSnapshot().some(view => view.id === request.viewId)) return false
        pending?.()
        pending = undefined
        if (sidebarRight.mounted.getSnapshot() === request.sessionId) return openFacet(request.viewId)
        // The thread panel follows the thread on screen: bring the thread there first, then open its facet (or give
        // up after a few seconds, when the thread never arrived).
        const off = sidebarRight.mounted.subscribe(() => {
          if (sidebarRight.mounted.getSnapshot() !== request.sessionId) return
          stop()
          openFacet(request.viewId)
        })
        const timer = setTimeout(() => stop(), 5_000)
        const stop = (): void => {
          off()
          clearTimeout(timer)
          if (pending === stop) pending = undefined
        }
        pending = stop
        openThread(SessionId(request.sessionId))
        return true
      })
      scope.effect(
        () => () => {
          releaseHost()
          pending?.()
          offViews()
          disposeOpen?.()
          disposeOpen = undefined
          for (const entry of registered.values()) entry.dispose()
          registered.clear()
        },
        'rich-composer: thread view facets',
      )
    })
  }
}
