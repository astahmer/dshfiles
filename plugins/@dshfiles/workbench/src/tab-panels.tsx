import type { ComponentType } from 'react'
import type { DockviewApi } from 'dockview-react'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry, WorkbenchPanelProps } from './registry.js'
import { semanticLayouts, type SemanticScopeLayouts } from './semantic-layouts.js'
import { workbenchTabs, type WorkbenchTab, type WorkbenchTabsSnapshot } from './tabs.js'

/**
 * Translate one USER reorder into the actor's total tab order. The visible group
 * may contain ordinary panels and only a subset of semantic tabs. API moves and
 * cross-region adoption must not call this helper (Dockview's move event has no origin).
 */
export const semanticTabMove = (input: {
  readonly movedPanelId: string
  readonly orderedPanelIds: readonly string[]
  readonly registry: WorkbenchPanelRegistry
  readonly snapshot: WorkbenchTabsSnapshot
}): { readonly tabId: string; readonly toIndex: number } | null => {
  if (!input.snapshot.enabled) return null
  const tabs = input.snapshot.tabs
  const tabId = input.registry.get(input.movedPanelId)?.tabId
  const fromIndex = tabs.findIndex(tab => tab.id === tabId)
  const moved = tabs[fromIndex]
  if (moved === undefined) return null
  const known = new Set(tabs.map(tab => tab.id))
  const ordered = [
    ...new Set(
      input.orderedPanelIds.flatMap(id => {
        const semantic = input.registry.get(id)?.tabId
        return semantic !== undefined && known.has(semantic) ? [semantic] : []
      }),
    ),
  ]
  const localIndex = ordered.indexOf(moved.id)
  if (localIndex === -1 || ordered.length < 2) return null
  const rest = tabs.filter(tab => tab.id !== moved.id)
  const next = ordered[localIndex + 1]
  const previous = ordered[localIndex - 1]
  const desired = next !== undefined ? rest.findIndex(tab => tab.id === next) : rest.findIndex(tab => tab.id === previous) + 1
  // Mirror the existing actor's pin-group bounds, not a second order owner.
  const pinnedCount = tabs.filter(tab => tab.pinned).length
  const [low, high] = moved.pinned ? [0, pinnedCount - 1] : [pinnedCount, rest.length]
  const toIndex = Math.min(Math.max(desired, low), high)
  return toIndex === fromIndex ? null : { tabId: moved.id, toIndex }
}

/** Deterministic, storage-safe identity independent of region and project set. */
export const tabPanelId = (tabId: string): string => `tab/${Array.from(new TextEncoder().encode(tabId), byte => byte.toString(16).padStart(2, '0')).join('')}`

/** Reconcile actor-owned occurrences without giving Dockview another navigation or persistence owner. */
export const createTabPanelAdapter = (input: {
  readonly registry: WorkbenchPanelRegistry
  readonly thread: (sessionId: string) => ComponentType
  readonly panel: (panelId: string, scope?: string) => ComponentType<WorkbenchPanelProps>
  readonly surfaces: () => readonly DockviewApi[]
  readonly open: (id: string) => void
  readonly scopeLayouts?: SemanticScopeLayouts | undefined
}) => {
  const channel = workbenchTabs()
  const registrations = new Map<string, { definition: WorkbenchPanelDefinition; dispose: () => void }>()
  let adoptedSelection: { scopeKey: string; activeTabId: string | null } | undefined
  let hasAdoptedSelection = false
  let arrangementScope: string | undefined
  let syncing = false
  const componentFor = (tab: WorkbenchTab): ComponentType<WorkbenchPanelProps> => {
    if (tab.target.kind === 'start') return () => channel.renderStart()
    if (tab.target.kind === 'thread') {
      const Thread = input.thread(tab.target.sessionId)
      return () => <Thread />
    }
    const Panel = input.panel(tab.target.panelId, tab.target.scope)
    return props => <Panel {...props} />
  }
  const reconcile = (): void => {
    const snapshot = channel.getSnapshot()
    if (snapshot.enabled && input.scopeLayouts !== undefined && arrangementScope !== snapshot.scopeKey) {
      const layouts = input.scopeLayouts.store ?? semanticLayouts
      const changingScene = arrangementScope !== undefined
      if (arrangementScope !== undefined) layouts.set({ ...layouts.get(), [arrangementScope]: input.scopeLayouts.capture() })
      const targetLayout = layouts.get()[snapshot.scopeKey]
      arrangementScope = snapshot.scopeKey
      // Region stores already restore the current window. The per-scope cache
      // can predate explicit tab closes, so use it only for an actual scene
      // switch, never to overwrite the live layout during initial adoption.
      if (changingScene && targetLayout !== undefined) {
        // Components must exist before fromJSON mounts the restored occurrences.
        for (const tab of snapshot.tabs) {
          const id = tabPanelId(tab.id)
          if (registrations.has(id)) continue
          const definition: WorkbenchPanelDefinition = {
            id,
            title: tab.target.kind === 'start' ? 'New tab' : tab.title,
            tabId: tab.id,
            hiddenFromAdd: true,
            newView: tab.target.kind === 'start',
            component: componentFor(tab),
            beforeClose: () => channel.actions.close(tab.id),
          }
          registrations.set(id, { definition, dispose: input.registry.register(definition) })
        }
        input.scopeLayouts.restore(targetLayout)
      }
    }
    // Retire presentation through the surface API. panel.api.close() reports its
    // automatic neighbor activation as user input and would navigate the actor back.
    if (!snapshot.enabled) {
      for (const [id, registration] of registrations) {
        for (const api of input.surfaces()) {
          const panel = api.getPanel(id)
          if (panel !== undefined) api.removePanel(panel)
        }
        registration.dispose()
      }
      registrations.clear()
      adoptedSelection = undefined
      return
    }
    // Initial provider hydration is not a user selection. Preserve restored ordinary
    // containers while semantic registrations arrive (adding a panel activates it).
    const initialOrdinary = !hasAdoptedSelection
      ? input.surfaces().flatMap(api => {
          const active = api.activePanel
          return active !== undefined && active.id !== 'conversation' && !active.id.startsWith('tab/') ? [{ api, id: active.id }] : []
        })
      : []
    const selectionChanged = adoptedSelection?.scopeKey !== snapshot.scopeKey || adoptedSelection.activeTabId !== snapshot.activeTabId
    let openedActive = false
    const live = new Set(snapshot.tabs.map(tab => tabPanelId(tab.id)))
    // Saved region layouts can contain another project's semantic ids before
    // this adapter has ever registered them. Remove those stale occurrences too.
    for (const api of input.surfaces()) for (const panel of api.panels) if (panel.id.startsWith('tab/') && !live.has(panel.id)) api.removePanel(panel)
    for (const [id, registration] of registrations) {
      if (live.has(id)) continue
      for (const api of input.surfaces()) {
        const panel = api.getPanel(id)
        if (panel !== undefined) api.removePanel(panel)
      }
      registration.dispose()
      registrations.delete(id)
    }
    for (const tab of snapshot.tabs) {
      const id = tabPanelId(tab.id)
      const existing = registrations.get(id)
      const target = tab.target
      const title =
        target.kind === 'start'
          ? 'New tab'
          : target.kind === 'panel' && target.scope === undefined
            ? (input.registry.list().find(source => source.tabId === undefined && !source.hiddenFromAdd && source.mainPanelId === target.panelId)?.title ??
              tab.title)
            : tab.title
      if (existing === undefined || existing.definition.title !== title) {
        const definition: WorkbenchPanelDefinition = {
          id,
          title,
          tabId: tab.id,
          hiddenFromAdd: true,
          newView: tab.target.kind === 'start',
          component: existing?.definition.component ?? componentFor(tab),
          beforeClose: () => channel.actions.close(tab.id),
        }
        const dispose = input.registry.register(definition)
        existing?.dispose()
        registrations.set(id, { definition, dispose })
      }
      const present = input.surfaces().some(api => api.getPanel(id) !== undefined)
      if (!present) {
        input.open(id)
        if (tab.id === snapshot.activeTabId) openedActive = true
      }
      for (const api of input.surfaces()) {
        const panel = api.getPanel(id)
        if (panel !== undefined && panel.title !== title) panel.api.setTitle(title)
      }
    }
    // Reconcile semantic order inside each existing group, preserving ordinary
    // panel slots and region/split placement. API moves must not feed actor events.
    const order = new Map(snapshot.tabs.map((tab, index) => [tabPanelId(tab.id), index]))
    for (const api of input.surfaces())
      for (const group of api.groups) {
        const semantic = group.panels.filter(panel => order.has(panel.id)).sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
        let cursor = 0
        const desired = group.panels.map(panel => (order.has(panel.id) ? (semantic[cursor++] ?? panel) : panel))
        for (const [index, panel] of desired.entries())
          if (group.panels[index]?.id !== panel.id) panel.api.moveTo({ group, index, position: 'center', skipSetActive: true })
      }
    // Opening another occurrence activates it by default. Apply actor selection only
    // after every addition, so iteration order cannot override the semantic active tab.
    // A status/title-only update must not steal focus from an ordinary registry
    // panel the user selected while the actor kept its previous semantic id.
    if ((selectionChanged || openedActive) && snapshot.activeTabId !== null)
      for (const api of input.surfaces()) {
        const active = api.getPanel(tabPanelId(snapshot.activeTabId))
        // Per-panel flags can lag the container during a synchronous activation
        // notification. Selection belongs to the actor, not that stale flag.
        if (active !== undefined && api.activePanel?.id !== active.id) active.api.setActive()
      }
    for (const { api, id } of initialOrdinary) api.getPanel(id)?.api.setActive()
    adoptedSelection = { scopeKey: snapshot.scopeKey, activeTabId: snapshot.activeTabId }
    if (snapshot.activeTabId !== null) hasAdoptedSelection = true
  }
  const sync = (): void => {
    if (syncing) return
    syncing = true
    try {
      reconcile()
    } finally {
      syncing = false
    }
  }
  // Source copy can change independently of actor metadata (locale/HMR). Watch
  // only reusable main-view labels, not our own semantic registrations.
  const readSourceNames = () =>
    new Map(
      input.registry
        .list()
        .filter(source => source.tabId === undefined && !source.hiddenFromAdd && source.mainPanelId !== undefined)
        .map(source => [source.id, source.title]),
    )
  let sourceNames = readSourceNames()
  const unsubscribeNames = input.registry.subscribe(() => {
    const next = readSourceNames()
    if (next.size === sourceNames.size && [...next].every(([id, title]) => sourceNames.get(id) === title)) return
    sourceNames = next
    sync()
  })
  return {
    sync,
    dispose: () => {
      unsubscribeNames()
      if (arrangementScope !== undefined && input.scopeLayouts !== undefined) {
        const layouts = input.scopeLayouts.store ?? semanticLayouts
        layouts.set({ ...layouts.get(), [arrangementScope]: input.scopeLayouts.capture() })
      }
      for (const entry of registrations.values()) entry.dispose()
      registrations.clear()
    },
  }
}
