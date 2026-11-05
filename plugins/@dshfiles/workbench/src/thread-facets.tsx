import type { SidebarRightGuideBox } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { SidebarResourcePanelModel, type SidebarResourcePanel } from '@dshfiles/sidebar-right/resource-panels'
import type { DockviewApi } from 'dockview-react'
import type { NativePageAdmission } from './native-page-admission.js'
import type { NewViewSelection } from './new-view.js'
import type { ThreadFacet, ThreadFacetObservable, WorkbenchPanelDefinition, WorkbenchPanelRegistry } from './registry.js'

const FACET_SOURCE_PREFIX = 'dshfiles-workbench.facet/'

/**
 * Guide kinds that are not thread facets here: the guide itself, the Workbench's own side panel, and Terminal, which
 * already has its own launcher (a terminal is a process of one thread, not a view that follows the thread).
 */
const NOT_FACETS: ReadonlySet<string> = new Set(['guide', 'terminal', 'dshfiles-workbench-side-panel'])

const sameFacet = (left: ThreadFacet, right: ThreadFacet): boolean =>
  left.kind === right.kind && left.order === right.order && left.title === right.title && left.description === right.description && left.icon === right.icon

/**
 * Thread facets in the Workbench: every native right-pane page type that offers a guide entry (Changes, Cost, Jobs…)
 * becomes a launcher in each pane's "Choose a view". Picking one asks native SidebarRight to open that page for the
 * on-screen thread; its body still renders through the `sidebar.right.pane.tab` seat with that thread's `sessionId`.
 * This owns presentation only: the guide registry, the page records and their Session scope stay native.
 */
export class ThreadFacets {
  static sourceId(kind: string): string {
    return `${FACET_SOURCE_PREFIX}${kind.replace(/[^a-zA-Z0-9._/-]/gu, '-')}`
  }

  /** One facet per kind, from the first guide entry in `order` that opens it. */
  static fromGuide(guide: readonly SidebarRightGuideBox[]): readonly ThreadFacet[] {
    const facets = new Map<string, ThreadFacet>()
    for (const box of guide) {
      if (NOT_FACETS.has(box.kind) || facets.has(box.kind)) continue
      facets.set(box.kind, {
        kind: box.kind,
        order: box.order,
        title: box.title,
        ...(box.description !== undefined && { description: box.description }),
        ...(box.icon !== undefined && { icon: box.icon }),
      })
    }
    return [...facets.values()].sort((left, right) => left.order - right.order)
  }

  /**
   * The thread a facet pick opens for. Native SidebarRight keeps the last selected Session mounted after its Workbench
   * tab closed, so the mounted Session counts only while a tab still has it open. `open` lists the Sessions of open
   * thread tabs; undefined when the Workbench tabs do not own the main region.
   */
  static threadOnScreen(input: {
    readonly mounted: ThreadFacetObservable<string | undefined>
    readonly open: ThreadFacetObservable<readonly string[] | undefined>
  }): ThreadFacetObservable<string | undefined> {
    return {
      subscribe: listener => {
        const offMounted = input.mounted.subscribe(listener)
        const offOpen = input.open.subscribe(listener)
        return () => {
          offMounted()
          offOpen()
        }
      },
      getSnapshot: () => {
        const mounted = input.mounted.getSnapshot()
        const open = input.open.getSnapshot()
        return mounted === undefined || ThreadFacets.hasOpenTab(mounted, open) ? mounted : undefined
      },
    }
  }

  /** Whether a thread still has an open thread tab; always true while the Workbench tabs do not own the main region. */
  static hasOpenTab(sessionId: string, open: readonly string[] | undefined): boolean {
    return open === undefined || open.includes(sessionId)
  }

  /** Whether a projected native record is a facet page that should follow the on-screen thread. */
  static follows(record: Pick<SidebarResourcePanel, 'kind' | 'address'>, facetKinds: ReadonlySet<string>): boolean {
    return facetKinds.has(record.kind) && SidebarResourcePanelModel.isPage(record)
  }

  static create(options: {
    readonly guide: ThreadFacetObservable<readonly SidebarRightGuideBox[]>
    readonly onScreen: ThreadFacetObservable<string | undefined>
    readonly registry: WorkbenchPanelRegistry
    readonly admission: NativePageAdmission
  }) {
    const { guide, onScreen, registry, admission } = options
    const registered = new Map<string, { readonly dispose: () => void; readonly facet: ThreadFacet }>()
    let kinds: ReadonlySet<string> = new Set()
    const sync = (): void => {
      const facets = ThreadFacets.fromGuide(guide.getSnapshot())
      kinds = new Set(facets.map(facet => facet.kind))
      for (const [kind, entry] of registered) {
        if (facets.some(facet => sameFacet(facet, entry.facet))) continue
        entry.dispose()
        registered.delete(kind)
      }
      for (const facet of facets) {
        if (registered.has(facet.kind)) continue
        const definition: WorkbenchPanelDefinition = {
          id: ThreadFacets.sourceId(facet.kind),
          title: facet.title(),
          allowMultiple: false,
          threadFacet: { ...facet, onScreen },
          // A launcher, not a mounted view: a successful pick seats the native page instead. This body shows only
          // when no thread was on screen to take the page.
          component: () => (
            <p className="dshx-root dshx:p-4 dshx:text-sm dshx:text-muted-foreground" role="status">
              Open a thread, then choose {facet.title()} again: it shows the thread on screen.
            </p>
          ),
        }
        registered.set(facet.kind, { dispose: registry.register(definition), facet })
      }
    }
    return {
      /** Register the launchers and keep them in step with the guide registry; returns the disposer. */
      start: (): (() => void) => {
        const off = guide.subscribe(sync)
        sync()
        return () => {
          off()
          for (const entry of registered.values()) entry.dispose()
          registered.clear()
          kinds = new Set()
        }
      },
      /** Explicit picker intent. False leaves the caller's default (the launcher's own explanation) in place. */
      open: (source: WorkbenchPanelDefinition, api: DockviewApi, selection: NewViewSelection = {}): boolean => {
        const kind = source.threadFacet?.kind
        if (kind === undefined || onScreen.getSnapshot() === undefined) return false
        return admission.launch(kind, api, selection)
      },
      follows: (record: Pick<SidebarResourcePanel, 'kind' | 'address'>): boolean => ThreadFacets.follows(record, kinds),
    }
  }
}

export type ThreadFacetSource = ReturnType<typeof ThreadFacets.create>
