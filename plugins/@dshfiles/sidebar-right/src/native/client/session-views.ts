/** Selection and retention policy for independently owned Sidebar Session views. */
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SidebarSessionView } from './session-view.ts'

/** The reference is exclusively a framework SessionProvider target, not a business-component service. */
export interface SidebarSessionViewSnapshot {
  readonly sessionId: SessionId
  readonly reference: SessionReference
  readonly selected: boolean
  /** Stable for this View's lifetime, independently of Session injection bindings. */
  readonly retainTab: SidebarSessionView['retainTab']
}

/** Selects and retires views; the Sidebar plugin's injected dependencies own global teardown. */
export class SidebarSessionViews {
  /** Selected and retained View targets observed by the root renderer. */
  readonly source = createSnapshotStore<readonly SidebarSessionViewSnapshot[]>([])
  private readonly views = new Map<SessionId, SidebarSessionView>()
  private readonly viewsByReference = new Map<SessionReference, SidebarSessionView>()
  private resourceSessions = new Set<SessionId>()
  private readonly openingResources = new Map<SessionId, SessionReference>()
  private restoringResources = false
  private selected: SessionId | undefined
  private closed = false

  constructor(
    private readonly sessions: Pick<ISessions, 'retain'>,
    private readonly onRetired: (sessionId: SessionId) => void = () => {},
  ) {}

  /**
   * Change the foreground Session while preserving retained background Views.
   * @param sessionId - main selection, or absence.
   */
  select(sessionId: SessionId | undefined): void {
    if (this.closed || this.selected === sessionId) return
    this.selected = sessionId
    if (sessionId !== undefined) this.ensure(sessionId, 'sidebarView')
    for (const view of this.views.values()) this.prune(view)
    this.publish()
  }

  /** Retain only Sessions named by real persisted resource records while Workbench restores them. */
  retainResourceSessions(sessionIds: readonly SessionId[]): void {
    if (this.closed) return
    const next = new Set(sessionIds)
    if (next.size === this.resourceSessions.size && [...next].every(id => this.resourceSessions.has(id))) return
    this.resourceSessions = next
    for (const [id] of this.openingResources) {
      if (!next.has(id)) this.openingResources.delete(id)
    }
    for (const view of this.views.values()) this.prune(view)
    this.pumpResourceRestores()
    this.publish()
  }

  /** At most four initial history openings at once; no parallel eager replay of every saved Session. */
  private pumpResourceRestores(): void {
    if (this.closed || this.restoringResources) return
    this.restoringResources = true
    try {
      for (const id of this.resourceSessions) {
        if (this.openingResources.size >= 4) break
        if (this.views.has(id)) continue
        this.ensure(id, 'sidebarResourceView')
        const reference = this.views.get(id)?.reference
        if (reference === undefined) continue
        this.openingResources.set(id, reference)
        const settled = (): void => {
          if (this.openingResources.get(id) !== reference) return
          this.openingResources.delete(id)
          this.pumpResourceRestores()
          this.publish()
        }
        void reference.ready.then(settled, settled)
      }
    } finally {
      this.restoringResources = false
    }
  }

  private ensure(sessionId: SessionId, source: 'sidebarView' | 'sidebarResourceView'): void {
    if (this.views.has(sessionId)) return
    const view = new SidebarSessionView(
      sessionId,
      this.sessions,
      disposed => {
        this.viewsByReference.delete(disposed.reference)
        // A same-id replacement can mount before the retired generation finishes unmounting.
        if (!this.views.has(disposed.sessionId)) this.onRetired(disposed.sessionId)
      },
      released => {
        this.prune(released)
      },
      source,
    )
    this.views.set(sessionId, view)
    this.viewsByReference.set(view.reference, view)
  }

  /**
   * Bind a committed root; release retired references after that root unmounts.
   * @param reference - framework target published by this owner.
   * @returns releases this committed mount.
   */
  mount(reference: SessionReference): () => void {
    const view = this.viewsByReference.get(reference)
    if (view === undefined) {
      if (this.closed) return () => {}
      throw new Error('Sidebar Session view reference is no longer owned')
    }
    return view.mount()
  }

  /** Plugin shutdown releases every view, including any awaiting a React unmount. */
  dispose(): void {
    this.closed = true
    this.resourceSessions.clear()
    this.openingResources.clear()
    this.views.clear()
    this.source.set([])
    for (const view of this.viewsByReference.values()) view.dispose()
  }

  private prune(view: SidebarSessionView): void {
    if (view.sessionId === this.selected || this.resourceSessions.has(view.sessionId) || view.hasRetainedTabs || this.views.get(view.sessionId) !== view) return
    this.views.delete(view.sessionId)
    // Render targets must be withdrawn before an unmounted view can release its reference.
    this.publish()
    view.retire()
  }

  private publish(): void {
    this.source.set(
      [...this.views.values()]
        .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
        .map(view => ({
          sessionId: view.sessionId,
          reference: view.reference,
          selected: view.sessionId === this.selected,
          retainTab: view.retainTab,
        })),
    )
  }
}
