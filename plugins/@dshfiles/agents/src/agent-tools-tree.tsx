import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ChevronRightIcon, PinIcon, RotateCcwIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

import type { AgentTools } from './agent.js'
import type { ToolCatalogView } from './api.js'
import { ToolTrees, type ToolCheck, type ToolTarget, type ToolTreeGroup, type ToolTreeRow, type ToolTreeTool } from './tool-tree.js'

/** Tools an expanded group renders before a "Show more" row; each press adds a page. */
const PAGE = 50
const HINT_ID = 'dshfiles-agent-tools-keys'
const KIND_LABEL = { mcp: 'MCP', plugin: 'Plugin', native: 'DSH' } as const

export interface AgentToolsTreeProps {
  readonly catalog: ToolCatalogView | undefined
  readonly loading: boolean
  readonly error: string | null
  readonly onRetry: () => void
  /** The draft access the tree edits, and the saved one it compares with. */
  readonly access: AgentTools
  readonly saved: AgentTools
  readonly onChange: (next: AgentTools) => void
}

const ariaChecked = (state: ToolCheck): boolean | 'mixed' => (state === 'indeterminate' ? 'mixed' : state)
const count = (value: number): string => value.toLocaleString('en-US')

/** Where a tool's state comes from, in a few words; the row's accessible description repeats it. */
const originOf = (tool: ToolTreeTool): string => {
  if (tool.reserved) return 'always on'
  if (tool.entry !== undefined) return 'set here'
  if (tool.decision.by === 'group') return 'from group'
  return 'default'
}

/**
 * VS Code's "Configure Tools" for one agent: a group per MCP server, plugin or DSH, a tri-state checkbox per group, a
 * checkbox and a pin per tool. It is a WAI-ARIA tree with one tab stop: arrows move, Space toggles, P pins, Delete
 * resets. Collapsed groups render one row, and an expanded one renders a page of tools at a time.
 */
export const AgentToolsTree = (props: AgentToolsTreeProps): JSX.Element => {
  const [query, setQuery] = useState('')
  // Groups start collapsed; a search opens every group with a match. `flipped` holds the ones the person flipped.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set())
  const [limits, setLimits] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [activeId, setActiveId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const focusNext = useRef(false)

  const searching = query.trim() !== ''
  const tree = useMemo(
    () => (props.catalog === undefined ? null : ToolTrees.build(props.catalog, props.access, props.saved, query)),
    [props.catalog, props.access, props.saved, query],
  )
  const rows = useMemo(
    () =>
      tree === null
        ? []
        : ToolTrees.rows(tree, {
            isExpanded: key => searching !== flipped.has(key),
            limitOf: key => limits.get(key) ?? PAGE,
          }),
    [tree, searching, flipped, limits],
  )
  const tabId = rows.some(row => row.id === activeId) ? activeId : (rows[0]?.id ?? null)

  useEffect(() => {
    if (!focusNext.current || tabId === null) return
    focusNext.current = false
    rowRefs.current.get(tabId)?.focus()
  }, [tabId, rows])

  const onSearch = (text: string): void => {
    setQuery(text)
    setFlipped(new Set())
  }
  const flip = (key: string): void =>
    setFlipped(previous => {
      const next = new Set(previous)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const showMore = (key: string): void => setLimits(previous => new Map(previous).set(key, (previous.get(key) ?? PAGE) + PAGE * 2))

  const change = (next: AgentTools): void => props.onChange(next)
  const toggleTool = (tool: ToolTreeTool): void => change(ToolTrees.setTool(props.access, tool, 'enabled', !tool.decision.enabled))
  const pinTool = (tool: ToolTreeTool): void => {
    if (tool.decision.enabled) change(ToolTrees.setTool(props.access, tool, 'pinned', !tool.decision.pinned))
  }
  const toggleGroup = (group: ToolTreeGroup): void => change(ToolTrees.setGroup(props.access, group, 'enabled', ToolTrees.nextCheck(group.enabled)))
  const pinGroup = (group: ToolTreeGroup): void => {
    if (group.enabledCount > 0) change(ToolTrees.setGroup(props.access, group, 'pinned', ToolTrees.nextCheck(group.pinned)))
  }
  const reset = (target: ToolTarget): void => change(ToolTrees.reset(props.access, target))

  const activate = (row: ToolTreeRow, how: 'check' | 'open'): void => {
    if (row.kind === 'more') showMore(row.group.key)
    else if (row.kind === 'tool') toggleTool(row.tool)
    else if (how === 'open') flip(row.group.key)
    else toggleGroup(row.group)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: ToolTreeRow): void => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return
    const key = event.key
    if (key === ' ' || key === 'Enter') {
      event.preventDefault()
      activate(row, key === 'Enter' && row.kind === 'group' ? 'open' : 'check')
      return
    }
    if (key.toLowerCase() === 'p') {
      event.preventDefault()
      if (row.kind === 'tool') pinTool(row.tool)
      else if (row.kind === 'group') pinGroup(row.group)
      return
    }
    if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault()
      if (row.kind === 'tool' && row.tool.entry !== undefined) reset({ kind: 'tool', key: row.tool.name })
      else if (row.kind === 'group' && row.group.entry !== undefined) reset({ kind: 'group', key: row.group.key })
      return
    }
    const next = ToolTrees.move(rows, row.id, key)
    if (next === null) return
    event.preventDefault()
    focusNext.current = true
    if (next.kind === 'focus') setActiveId(next.id)
    else flip(next.key)
  }

  const rowProps = (row: ToolTreeRow) => ({
    ref: (element: HTMLDivElement | null) => {
      if (element === null) rowRefs.current.delete(row.id)
      else rowRefs.current.set(row.id, element)
    },
    role: 'treeitem',
    tabIndex: row.id === tabId ? 0 : -1,
    'aria-describedby': HINT_ID,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => onKeyDown(event, row),
    onFocus: () => setActiveId(row.id),
  })

  /** A control inside a row runs its own verb and leaves focus on the row, the tree's one tab stop. */
  const inner = (run: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    run()
  }

  if (props.error !== null)
    return (
      <div role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-destructive">
        <span className="dshx:min-w-0 dshx:flex-1">
          The tool list did not load ({props.error}). Retry; if the Host was just updated, restart DSH so the Agents plugin serves it.
        </span>
        <Button type="button" size="xs" variant="outline" onClick={props.onRetry}>
          Retry
        </Button>
      </div>
    )
  if (props.loading || tree === null) return <Spinner aria-label="Loading tools" className="dshx:my-3" />

  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <SearchInput
          aria-label="Filter tools"
          placeholder="Filter by name or description…"
          value={query}
          autoComplete="off"
          spellCheck={false}
          className="dshx:min-w-0 dshx:flex-1 dshx:basis-56"
          onChange={event => onSearch(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Escape' && query !== '') {
              event.preventDefault()
              onSearch('')
            }
          }}
        />
        <p aria-live="polite" className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">
          {count(tree.enabled)} of {count(tree.total)} tools selected · {count(tree.pinned)} pinned
          {tree.changed > 0 ? ` · ${count(tree.changed)} unsaved` : ''}
        </p>
      </div>
      <p id={HINT_ID} className="dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:sr-only">
        Arrows move, Space selects, P pins, Delete resets to inherited.
      </p>

      {tree.groups.length === 0 ? (
        <p className="dshx:rounded-md dshx:border dshx:border-dashed dshx:border-border dshx:px-3 dshx:py-4 dshx:text-center dshx:text-xs dshx:text-muted-foreground">
          {searching ? `No tool matches “${query.trim()}”. Clear the filter to see every group.` : 'This Host lists no tools yet.'}
        </p>
      ) : (
        <div role="tree" aria-label="Tools" className="dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-border">
          {rows.map((row, index) =>
            row.kind === 'group' ? (
              <div
                key={row.id}
                {...rowProps(row)}
                aria-level={1}
                aria-expanded={row.expanded}
                aria-checked={ariaChecked(row.group.enabled)}
                aria-label={`${row.group.label}, ${KIND_LABEL[row.group.kind]}, ${String(row.group.enabledCount)} of ${String(row.group.tools.length)} selected${row.group.pinnedCount > 0 ? `, ${String(row.group.pinnedCount)} pinned` : ''}${row.group.entry === undefined ? '' : ', set here'}`}
                onClick={() => flip(row.group.key)}
                className={cn(
                  'dshx:flex dshx:min-h-10 dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:bg-muted/30 dshx:px-2 dshx:outline-none dshx:@max-pane-narrow:min-h-11',
                  'dshx:hover:bg-accent/60 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset',
                  index > 0 && 'dshx:border-t dshx:border-border',
                )}
              >
                <ChevronRightIcon
                  aria-hidden
                  className={cn('dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground dshx:transition-transform', row.expanded && 'dshx:rotate-90')}
                />
                <Checkbox aria-hidden tabIndex={-1} checked={row.group.enabled} onClick={inner(() => toggleGroup(row.group))} />
                <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5">
                  <span className="dshx:min-w-0 dshx:truncate dshx:text-sm dshx:font-medium">{row.group.label}</span>
                  <Badge variant="muted" className="dshx:@max-pane-narrow:hidden">
                    {KIND_LABEL[row.group.kind]}
                  </Badge>
                  {row.group.changed ? <ChangedDot /> : null}
                </span>
                <span aria-hidden className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">
                  {row.group.enabledCount}/{row.group.tools.length}
                </span>
                {row.group.entry === undefined ? null : (
                  <ResetButton label={`Reset ${row.group.label} to defaults`} onClick={inner(() => reset({ kind: 'group', key: row.group.key }))} />
                )}
                <PinButton
                  label={`Pin every ${row.group.label} tool`}
                  state={row.group.pinned}
                  disabled={row.group.enabledCount === 0}
                  onClick={inner(() => pinGroup(row.group))}
                />
              </div>
            ) : row.kind === 'tool' ? (
              <div
                key={row.id}
                {...rowProps(row)}
                aria-level={2}
                aria-checked={row.tool.decision.enabled}
                aria-disabled={row.tool.reserved || undefined}
                aria-label={`${row.tool.name}${row.tool.decision.pinned ? ', pinned' : ''}, ${originOf(row.tool)}${row.tool.changed ? ', unsaved' : ''}`}
                onClick={() => toggleTool(row.tool)}
                className={cn(
                  'dshx:flex dshx:min-h-10 dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:border-t dshx:border-border/60 dshx:py-1 dshx:pr-2 dshx:pl-8 dshx:outline-none dshx:@max-pane-narrow:min-h-11 dshx:@max-pane-narrow:pl-4',
                  'dshx:hover:bg-accent/40 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset',
                  !row.tool.decision.enabled && 'dshx:text-muted-foreground',
                )}
              >
                <Checkbox
                  aria-hidden
                  tabIndex={-1}
                  checked={row.tool.decision.enabled}
                  disabled={row.tool.reserved}
                  onClick={inner(() => toggleTool(row.tool))}
                />
                <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                  <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
                    <span className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:text-xs">{row.tool.name}</span>
                    {row.tool.changed ? <ChangedDot /> : null}
                  </span>
                  {row.tool.summary === '' ? null : (
                    <span className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground">{row.tool.summary}</span>
                  )}
                </span>
                {row.tool.decision.by === 'default' && row.tool.entry === undefined ? null : (
                  <span
                    aria-hidden
                    className={cn(
                      'dshx:shrink-0 dshx:text-[11px] dshx:@max-pane-narrow:hidden',
                      row.tool.entry === undefined ? 'dshx:text-muted-foreground' : 'dshx:font-medium dshx:text-foreground',
                    )}
                  >
                    {originOf(row.tool)}
                  </span>
                )}
                {row.tool.entry === undefined ? null : (
                  <ResetButton label={`Reset ${row.tool.name} to inherited`} onClick={inner(() => reset({ kind: 'tool', key: row.tool.name }))} />
                )}
                <PinButton
                  label={`Pin ${row.tool.name}`}
                  state={row.tool.decision.pinned}
                  disabled={!row.tool.decision.enabled}
                  onClick={inner(() => pinTool(row.tool))}
                />
              </div>
            ) : (
              <div
                key={row.id}
                {...rowProps(row)}
                aria-level={2}
                onClick={() => showMore(row.group.key)}
                className="dshx:flex dshx:min-h-10 dshx:cursor-pointer dshx:items-center dshx:border-t dshx:border-border/60 dshx:pl-8 dshx:text-xs dshx:text-primary dshx:outline-none dshx:hover:underline dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset dshx:@max-pane-narrow:min-h-11 dshx:@max-pane-narrow:pl-4"
              >
                Show {count(Math.min(row.hidden, PAGE * 2))} more of {count(row.hidden)}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}

const ChangedDot = (): JSX.Element => (
  <span className="dshx:inline-flex dshx:shrink-0 dshx:items-center">
    <span aria-hidden className="dshx:size-1.5 dshx:rounded-full dshx:bg-warning" />
    <span className="dshx:sr-only">unsaved</span>
  </span>
)

/** Inside a treeitem: reachable by pointer, while the keyboard uses the row's own keys (one tab stop per tree). */
const PinButton = (props: { readonly label: string; readonly state: ToolCheck; readonly disabled: boolean; readonly onClick: (event: MouseEvent) => void }) => (
  <Button
    type="button"
    size="icon-sm"
    variant="ghost"
    tabIndex={-1}
    aria-label={props.label}
    aria-pressed={ariaChecked(props.state)}
    disabled={props.disabled}
    className={cn('dshx:shrink-0', props.state === false ? 'dshx:text-muted-foreground/60' : 'dshx:text-foreground')}
    onClick={props.onClick}
  >
    <PinIcon className={cn(props.state === true && 'dshx:fill-current', props.state === 'indeterminate' && 'dshx:opacity-70')} />
  </Button>
)

const ResetButton = (props: { readonly label: string; readonly onClick: (event: MouseEvent) => void }) => (
  <Button
    type="button"
    size="icon-sm"
    variant="ghost"
    tabIndex={-1}
    aria-label={props.label}
    className="dshx:shrink-0 dshx:text-muted-foreground"
    onClick={props.onClick}
  >
    <RotateCcwIcon />
  </Button>
)
