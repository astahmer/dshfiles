import type { DockviewApi } from 'dockview-react'
import type { ArrangementPorts, ArrangementSurface } from './layout-arrangements.js'
import { nestedSurfacePathSchema, WORKBENCH_COMPONENT, type LayoutStore } from './layout-store.js'
import type { WorkbenchPanelRegistry } from './registry.js'
import { nestedPanelId } from './nested-surfaces.js'
import { createNativeAsidePlacement } from './native-aside-placement.js'
import { NewViewTabs } from './new-view.js'
import type { WorkbenchTabsSnapshot } from './tabs.js'

/** Reset also cancels delayed Session-pane handoffs, without detaching live panes. */
export const createResettableAsidePlacement = <Surface>(show: (surface: Surface, panelId: string) => void) => {
  let placement = createNativeAsidePlacement(show)
  const attached = new Map<string, { readonly surface: Surface; dispose: () => void }>()
  return {
    request: (sessionId: string, panelId: string): void => placement.request(sessionId, panelId),
    attach: (sessionId: string, surface: Surface): (() => void) => {
      attached.get(sessionId)?.dispose()
      const entry = { surface, dispose: placement.attach(sessionId, surface) }
      attached.set(sessionId, entry)
      return () => {
        if (attached.get(sessionId) !== entry) return
        entry.dispose()
        attached.delete(sessionId)
      }
    },
    surfaces: (): readonly Surface[] => [...attached.values()].map(entry => entry.surface),
    reset: (): void => {
      placement.dispose()
      placement = createNativeAsidePlacement(show)
      for (const [sessionId, entry] of attached) entry.dispose = placement.attach(sessionId, entry.surface)
    },
    dispose: (): void => {
      placement.dispose()
      attached.clear()
    },
  }
}

export interface WorkbenchResetPorts<Surface extends ArrangementSurface> extends ArrangementPorts<Surface> {
  readonly sideStore: Pick<LayoutStore, 'remove'>
  readonly sideSurfaces: () => readonly Surface[]
  readonly clearScopeLayouts: () => void
  readonly discardPendingPlacements: () => void
  /** Reconcile existing semantic tabs or the main conversation; never close actor tabs. */
  readonly restoreMain: () => void
  /** Restore navigation/threads and reveal the frame-owned sidebar, even before its API mounts. */
  readonly restoreLeft: () => void
}

export class WorkbenchReset {
  /**
   * Recover the authoritative current Session, not the actor's active tool. Reuse
   * its existing semantic view and editor owner when available. Only legacy/blank
   * sessions need the authorized ordinary current-conversation renderer.
   */
  static conversation(api: DockviewApi, registry: WorkbenchPanelRegistry, snapshot?: WorkbenchTabsSnapshot): string | undefined {
    const selected = snapshot?.currentSessionId
    const semantic = selected === undefined ? undefined : snapshot?.tabs.find(tab => tab.target.kind === 'thread' && tab.target.sessionId === selected)
    const fallback = registry.get('conversation') ?? registry.get('current-conversation')
    const definition = semantic === undefined ? fallback : registry.list().find(panel => panel.tabId === semantic.id)
    const source = definition ?? fallback
    if (source === undefined) return undefined
    const group = api.groups.find(candidate => candidate.api.location.type === 'grid') ?? api.addGroup()
    const current =
      api.getPanel(source.id) ?? api.addPanel({ id: source.id, title: source.title, component: WORKBENCH_COMPONENT, position: { referenceGroup: group } })
    if (current.group !== group) current.api.moveTo({ group, position: 'center' })
    // The permanent-grid guard may recreate a chooser during clear(). Admit the
    // real conversation first, then retire only ordinary reset placeholders via
    // the presentation API. Semantic Start tabs and resource callbacks stay intact.
    for (const panel of [...api.panels])
      if (panel.id !== current.id && (panel.id === 'conversation' || panel.id === 'current-conversation' || NewViewTabs.isChooser(panel.id)))
        api.removePanel(panel)
    current.api.setActive()
    return source.tabId
  }

  /**
   * Reset is one presentation operation, not one surface's default layout. Clear
   * descendants before their parents destroy their mounts. Otherwise the semantic
   * adapter can see a tab on a stale nested API and leave the new main empty.
   */
  static run<Surface extends ArrangementSurface>(ports: WorkbenchResetPorts<Surface>): void {
    ports.discardPendingPlacements()
    ports.clearScopeLayouts()
    const live = ports.regions.entries()
    const parentOf = new Map<Surface, Surface>()
    for (const [region, api] of live) {
      if (!region.startsWith('nested/')) continue
      const id = nestedPanelId(nestedSurfacePathSchema.parse(region))
      const parent = live.find(([, candidate]) => candidate.getPanel(id) !== undefined)?.[1]
      if (parent !== undefined) parentOf.set(api, parent)
    }
    const depthOf = (api: Surface): number => {
      const seen = new Set<Surface>()
      let cursor: Surface | undefined = api
      while (cursor !== undefined && !seen.has(cursor)) {
        seen.add(cursor)
        cursor = parentOf.get(cursor)
      }
      return seen.size
    }
    for (const [region, api] of [...live].sort(([, a], [, b]) => depthOf(b) - depthOf(a))) {
      if (ports.regions.get(region) === api) api.clear()
    }
    for (const api of ports.sideSurfaces()) api.clear()
    // Clear stores after APIs too: synchronous persistence events must not rewrite
    // an old layout after removal. Unmounted roots/descendants are included.
    for (const store of Object.values(ports.rootStores)) store.remove()
    ports.sideStore.remove()
    for (const path of ports.nestedStores.paths()) ports.nestedStores.store(path).remove()
    ports.restoreMain()
    ports.restoreLeft()
  }
}
