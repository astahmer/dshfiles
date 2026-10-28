import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { ArrowUpRightIcon, SearchIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useRef, useState } from 'react'
import type { WorkbenchPanelDefinition } from './registry.js'

export const NewViewChooser = (props: {
  readonly definitions: readonly WorkbenchPanelDefinition[]
  readonly onSelect: (definition: WorkbenchPanelDefinition) => void
  readonly autoFocus?: boolean
}): JSX.Element => {
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (props.autoFocus === false) return
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
  const matches = (definition: WorkbenchPanelDefinition): boolean => definition.title.toLocaleLowerCase().includes(query)
  const views = available.filter(matches).sort((left, right) => {
    const priority = (definition: WorkbenchPanelDefinition): number =>
      definition.id === 'dshfiles-settings' ? 0 : definition.id === 'dshfiles-thread-sidebar.workbench-navigation' ? 1 : 2
    return priority(left) - priority(right) || left.title.localeCompare(right.title)
  })
  return (
    <section aria-label="Choose a view" className="dshx-root dshx:@container dshx:h-full dshx:overflow-y-auto dshx:bg-background dshx:text-sm">
      <div className="dshx:mx-auto dshx:flex dshx:w-full dshx:max-w-xl dshx:flex-col dshx:gap-5 dshx:p-6 dshx:@max-pane-narrow:p-4">
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <h2 className="dshx:text-lg dshx:font-semibold">Choose a view</h2>
          <p className="dshx:text-muted-foreground">Choose a workspace view. Open conversations from the thread list.</p>
        </div>
        <div className="dshx:relative">
          <SearchIcon aria-hidden className="dshx:pointer-events-none dshx:absolute dshx:top-2 dshx:left-3 dshx:size-4 dshx:text-muted-foreground" />
          <Input
            ref={searchInput}
            aria-label="Search views"
            placeholder="Search views"
            value={search}
            onChange={event => setSearch(event.currentTarget.value)}
            className="dshx:pl-9"
          />
        </div>
        {views.length > 0 && (
          <div className="dshx:flex dshx:flex-col dshx:gap-1">
            <p className="dshx:mb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Workspace views</p>
            {views.map(definition => (
              <Button
                key={definition.id}
                variant="ghost"
                className="dshx:h-auto dshx:min-h-10 dshx:w-full dshx:justify-start dshx:gap-2 dshx:py-2"
                onClick={() => props.onSelect(definition)}
              >
                <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left">{definition.title}</span>
                <ArrowUpRightIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
              </Button>
            ))}
          </div>
        )}
        {views.length === 0 && <p className="dshx:text-muted-foreground">No matching views.</p>}
      </div>
    </section>
  )
}
