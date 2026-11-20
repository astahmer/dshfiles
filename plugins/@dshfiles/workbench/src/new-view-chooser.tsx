import { MenuItem, useRegistry } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { ArrowUpRightIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { NewThreadSource } from './new-thread-source.js'
import { withoutPluginPrefix, type ThreadFacet, type ThreadFacetObservable, type WorkbenchPanelDefinition } from './registry.js'

const noThread: ThreadFacetObservable<string | undefined> = { subscribe: () => () => undefined, getSnapshot: () => undefined }

/** Thread facets follow the on-screen thread; without one a pick would have nothing to show. */
const useThreadOnScreen = (facets: readonly ThreadFacet[]): boolean => {
  const source = facets.find(facet => facet.onScreen !== undefined)?.onScreen ?? noThread
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot) !== undefined
}

/** One column in a narrow pane, more as the pane widens, so the list fills its pane instead of one centred column. */
const ROW_GRID = 'dshx:grid dshx:grid-cols-1 dshx:gap-1 dshx:@min-[40rem]:grid-cols-2 dshx:@min-[64rem]:grid-cols-3'

/** The `MenuItem` menu id this chooser lists below the views. */
const NEW_VIEW_MENU = 'workbench.new-view'

export const NewViewChooser = (props: {
  readonly definitions: readonly WorkbenchPanelDefinition[]
  readonly onSelect: (definition: WorkbenchPanelDefinition) => void
  /** Called after a contributed `workbench.new-view` row ran, to close the chooser. */
  readonly onRun?: () => void
  readonly autoFocus?: boolean
}): JSX.Element => {
  const menuRows = useRegistry(MenuItem)
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // A touch device would raise its software keyboard over the list just because the chooser opened.
    if (props.autoFocus === false || window.matchMedia?.('(pointer: coarse)').matches === true) return
    searchInput.current?.focus({ preventScroll: true })
    // Dockview finishes header activation after mounting its retained portal.
    // Restore focus once at the next paint; hidden/inactive panes cancel it.
    const frame = requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [props.autoFocus])
  const query = search.trim().toLocaleLowerCase()
  const available = props.definitions.filter(
    definition => !definition.hiddenFromAdd && definition.tabId === undefined && definition.id !== 'conversation' && definition.id !== 'current-conversation',
  )
  const matches = (definition: WorkbenchPanelDefinition): boolean =>
    [definition.title, definition.discoveryTitle ?? ''].some(title => title.toLocaleLowerCase().includes(query))
  const facetDefinitions = available.flatMap(definition => (definition.threadFacet === undefined ? [] : [{ definition, facet: definition.threadFacet }]))
  const threadOnScreen = useThreadOnScreen(facetDefinitions.map(entry => entry.facet))
  const facets = facetDefinitions
    .filter(({ facet }) => [facet.title(), facet.description?.() ?? ''].some(text => text.toLocaleLowerCase().includes(query)))
    .toSorted((left, right) => left.facet.order - right.facet.order)
  const viewDefinitions = available.filter(definition => definition.threadFacet === undefined)
  // Rows name the page, never its plugin ("Settings Shell: Settings" reads "Settings"); a short name two views share keeps
  // its qualified name. Search still matches the full names.
  const shortName = (definition: WorkbenchPanelDefinition): string => withoutPluginPrefix(definition.discoveryTitle ?? definition.title)
  const shortNames = viewDefinitions.map(shortName)
  const label = (definition: WorkbenchPanelDefinition): string => {
    const short = shortName(definition)
    return shortNames.indexOf(short) === shortNames.lastIndexOf(short) ? short : (definition.discoveryTitle ?? definition.title)
  }
  const views = viewDefinitions.filter(matches).sort((left, right) => {
    const priority = (definition: WorkbenchPanelDefinition): number => {
      const index = [NewThreadSource.id, 'dshfiles-settings', 'dshfiles-thread-sidebar.workbench-navigation'].indexOf(definition.id)
      return index === -1 ? 3 : index
    }
    return priority(left) - priority(right) || label(left).localeCompare(label(right))
  })
  const actions = menuRows
    .filter(row => row.menu === NEW_VIEW_MENU && [row.title, ...(row.keywords ?? [])].some(text => text.toLocaleLowerCase().includes(query)))
    .toSorted((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.title.localeCompare(right.title))
  return (
    <section aria-label="Choose a view" className="dshx-root dshx:@container dshx:h-full dshx:overflow-y-auto dshx:bg-background dshx:text-sm">
      {/* The page fills its pane (DESIGN.md "Layout"): rows flow into columns as the pane widens. */}
      <div className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-5 dshx:p-5 dshx:@max-pane-narrow:p-3">
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <h2 className="dshx:text-lg dshx:font-semibold">Choose a view</h2>
          <p className="dshx:text-muted-foreground">Choose a workspace view. Open threads from the thread list.</p>
        </div>
        <SearchInput
          ref={searchInput}
          aria-label="Search views"
          placeholder="Search views"
          className="dshx:max-w-md"
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
        />
        {/* Thread panels need a thread: without one, one line says so instead of a screenful of rows that cannot be picked. */}
        {facets.length > 0 && !threadOnScreen && (
          <p data-chooser-thread-hint="" className="dshx:text-xs dshx:text-muted-foreground">
            Open a thread to choose its panels here.
          </p>
        )}
        {facets.length > 0 && threadOnScreen && (
          <div role="group" aria-label="Thread panels" className="dshx:flex dshx:flex-col dshx:gap-1">
            <p className="dshx:mb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Thread panels</p>
            <div className={ROW_GRID}>
              {facets.map(({ definition, facet }) => {
                const Icon = facet.icon
                const description = facet.description?.()
                return (
                  <Button
                    key={definition.id}
                    variant="ghost"
                    className="dshx:h-auto dshx:min-h-10 dshx:w-full dshx:justify-start dshx:gap-2 dshx:py-2"
                    onClick={() => props.onSelect(definition)}
                  >
                    {Icon === undefined ? null : (
                      <span aria-hidden className="dshx:flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground">
                        <Icon size={16} />
                      </span>
                    )}
                    <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:items-start dshx:text-left">
                      <span className="dshx:max-w-full dshx:truncate">{facet.title()}</span>
                      {description === undefined || description === '' ? null : (
                        <span className="dshx:max-w-full dshx:truncate dshx:text-xs dshx:font-normal dshx:text-muted-foreground">{description}</span>
                      )}
                    </span>
                  </Button>
                )
              })}
            </div>
          </div>
        )}
        {views.length > 0 && (
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <p className="dshx:mb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Workspace views</p>
            <div className={ROW_GRID}>
              {views.map(definition => (
                <Button
                  key={definition.id}
                  variant="ghost"
                  className="dshx:h-auto dshx:min-h-10 dshx:w-full dshx:justify-start dshx:gap-2 dshx:py-2"
                  onClick={() => props.onSelect(definition)}
                >
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left">{label(definition)}</span>
                  <ArrowUpRightIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
                </Button>
              ))}
            </div>
          </div>
        )}
        {actions.length > 0 && (
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <p className="dshx:mb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Actions</p>
            <div className={ROW_GRID}>
              {actions.map(row => (
                <Button
                  key={row.id}
                  variant="ghost"
                  className="dshx:h-auto dshx:min-h-10 dshx:w-full dshx:justify-start dshx:gap-2 dshx:py-2"
                  onClick={() => {
                    row.run()
                    props.onRun?.()
                  }}
                >
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left">{row.title}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
        {views.length === 0 && actions.length === 0 && facets.length === 0 && <p className="dshx:text-muted-foreground">No matching views.</p>}
      </div>
    </section>
  )
}
