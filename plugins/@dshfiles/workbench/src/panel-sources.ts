import type { ReactNode } from 'react'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from './registry.js'

// Stock 0.2.1 main-view IDs lack producer-qualified list labels. Keep this
// compatibility list bounded to those installed native views; owned plugins
// declare their own labels rather than relying on package-name inference.
const nativeViewOwners = new Map([
  ['plugins', 'Plugin Manager'],
  ['schedules', 'Schedule'],
])

export interface MainPanelSource {
  readonly key: string
  readonly title: string
  /** Runtime ledger occurrences remain restorable, but are not reusable plugin views. */
  readonly hiddenFromAdd?: boolean
}

/** Reconcile ledger metadata without changing a mounted source component's identity. */
export const createMainPanelSources = (registry: WorkbenchPanelRegistry) => {
  let renderMain: (key: string) => ReactNode = () => null
  const registrations = new Map<string, { definition: WorkbenchPanelDefinition; dispose: () => void }>()
  const remove = (key: string): void => {
    registrations.get(key)?.dispose()
    registrations.delete(key)
  }
  return {
    sync: (entries: readonly MainPanelSource[], nextRenderer: (key: string) => ReactNode): void => {
      renderMain = nextRenderer
      const live = new Map(entries.filter(entry => entry.key !== 'dshfiles-workbench' && entry.key !== 'conversation').map(entry => [entry.key, entry]))
      for (const key of registrations.keys()) if (!live.has(key)) remove(key)
      for (const [key, entry] of live) {
        const previous = registrations.get(key)
        // Explicit contributors remain canonical (saved layouts already use
        // their id). Do not mistake our own synthesized entry for one of them.
        const explicit = registry.list().some(panel => panel.mainPanelId === key && panel !== previous?.definition)
        if (explicit) {
          remove(key)
          continue
        }
        const owner = nativeViewOwners.get(key)
        const title = owner === undefined || entry.title.includes(':') ? entry.title : `${owner}: ${entry.title}`
        if (previous?.definition.title === title && previous.definition.hiddenFromAdd === (entry.hiddenFromAdd ?? false)) continue
        const definition: WorkbenchPanelDefinition = {
          id: `main/${key}`,
          title,
          mainPanelId: key,
          hiddenFromAdd: entry.hiddenFromAdd ?? false,
          component: previous?.definition.component ?? (() => renderMain(key)),
        }
        const dispose = registry.register(definition)
        previous?.dispose()
        registrations.set(key, { definition, dispose })
      }
    },
    dispose: (): void => {
      for (const entry of registrations.values()) entry.dispose()
      registrations.clear()
    },
  }
}

/** One-shot compatibility helper; live seats should retain a reconciliation adapter. */
export const registerMainPanelSources = (
  registry: WorkbenchPanelRegistry,
  entries: readonly MainPanelSource[],
  renderMain: (key: string) => ReactNode,
): (() => void) => {
  const sources = createMainPanelSources(registry)
  sources.sync(entries, renderMain)
  return sources.dispose
}
