import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'
import { useMemo, useRef, useSyncExternalStore } from 'react'
import { Destinations, type DestinationPanel, type DestinationSection } from './destinations.js'
import type { SidebarPanel } from './sidebar-tree.js'

/**
 * The panels this browser can file in a sidebar folder (b:952m): every main page (`sidebar.panellist`), every thread
 * facet and every other addable Workbench view (not a runtime occurrence, not `hiddenFromAdd`). A Workbench view that
 * only stands for a main page (`mainPanelId`) is that page, listed once.
 */
const catalog = (input: {
  readonly pages: readonly DestinationPanel[]
  readonly sections: readonly DestinationSection[]
  readonly views: readonly WorkbenchPanelDefinition[]
}): readonly SidebarPanel[] => {
  const labels = new Map(input.sections.map(section => [section.panelId, section.label]))
  const panels = new Map<string, SidebarPanel>()
  for (const page of input.pages) panels.set(page.id, { id: page.id, title: labels.get(page.id) ?? Destinations.withoutPluginPrefix(page.label), kind: 'page' })
  for (const view of input.views) {
    if (view.hiddenFromAdd === true || view.tabId !== undefined || view.newView === true) continue
    if (view.mainPanelId !== undefined && panels.has(view.mainPanelId)) continue
    if (panels.has(view.id) || view.id.startsWith('dshfiles-thread-sidebar.')) continue
    const title = view.threadFacet?.title() ?? view.title
    panels.set(view.id, {
      id: view.id,
      title: Destinations.withoutPluginPrefix(title).slice(0, 120) || view.id,
      kind: view.threadFacet === undefined ? 'view' : 'facet',
    })
  }
  return [...panels.values()]
}

/** The catalog of the pages and Workbench views on this page, the same array while its content is unchanged. */
const useCatalog = (input: {
  readonly pages: readonly DestinationPanel[]
  readonly destinations: readonly { readonly sections: readonly DestinationSection[] }[]
  readonly registry: Pick<WorkbenchPanelRegistry, 'list' | 'subscribe'>
}): readonly SidebarPanel[] => {
  const views = useSyncExternalStore(input.registry.subscribe, input.registry.list, input.registry.list)
  const fresh = useMemo(
    () => catalog({ pages: input.pages, sections: input.destinations.flatMap(destination => destination.sections), views }),
    [input.pages, input.destinations, views],
  )
  // Every thread switch replaces Workbench occurrences the catalog leaves out; an equal catalog keeps its identity so
  // the folders and the palette actions derived from it are not rebuilt and registered again.
  const kept = useRef(fresh)
  const same =
    kept.current.length === fresh.length &&
    kept.current.every((panel, index) => panel.id === fresh[index]?.id && panel.title === fresh[index].title && panel.kind === fresh[index].kind)
  if (!same) kept.current = fresh
  return kept.current
}

const browserIdSchema = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{8,64}$/u))
const storedBrowserId = createStoredValue({ key: 'dshfiles.thread-sidebar.browser-id.v1', schema: Schema.NullOr(browserIdSchema), fallback: null })

/** A random id this browser keeps, so its catalog report replaces only its own on the Host. */
const browserId = (): string => {
  const stored = storedBrowserId.get()
  if (stored !== null) return stored
  // getRandomValues also works on a plain-HTTP LAN or tailnet page, where crypto.randomUUID is missing.
  const id = `b-${Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('')}`
  storedBrowserId.set(id)
  return id
}

/** A stable key of one catalog, so an unchanged list is not reported again. */
const key = (panels: readonly SidebarPanel[]): string =>
  panels
    .map(panel => `${panel.kind}:${panel.id}:${panel.title}`)
    .sort()
    .join('\n')

export class SidebarCatalog {
  static readonly catalog = catalog
  static readonly useCatalog = useCatalog
  static readonly browserId = browserId
  static readonly key = key
}
