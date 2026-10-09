import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { MessageSquareIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useDeferredValue, useMemo, useState, type KeyboardEvent } from 'react'
import { filterByLabel, indexThreads, rankThreads, type PaletteMode, type ThreadCandidate } from './palette.js'
import type { PaletteDestination } from './sidebar-state.js'

export interface ThreadPaletteCopy {
  readonly title: string
  readonly threadsPlaceholder: string
  readonly allPlaceholder: string
  readonly recent: string
  readonly threads: string
  readonly destinations: string
  readonly empty: string
  readonly navigate: string
  readonly open: string
  readonly close: string
  readonly unassigned: string
}

interface ThreadPaletteProps {
  readonly mode: PaletteMode
  readonly threads: readonly ThreadCandidate[]
  readonly destinations: readonly PaletteDestination[]
  readonly recentLimit: number
  readonly mac: boolean
  readonly copy: ThreadPaletteCopy
  readonly onOpenThread: (sessionId: string) => void
  readonly onClose: () => void
}

type PaletteRow = { readonly kind: 'thread'; readonly thread: ThreadCandidate } | { readonly kind: 'destination'; readonly destination: PaletteDestination }

const rowValue = (row: PaletteRow): string => (row.kind === 'thread' ? `thread:${row.thread.id}` : `destination:${row.destination.id}`)

const projectGlyphTones = [
  'dshx:bg-chart-1/15 dshx:text-chart-1',
  'dshx:bg-chart-2/15 dshx:text-chart-2',
  'dshx:bg-chart-3/15 dshx:text-chart-3',
  'dshx:bg-chart-4/15 dshx:text-chart-4',
  'dshx:bg-chart-5/15 dshx:text-chart-5',
] as const

const glyphTone = (project: string): string => {
  let hash = 0
  for (const character of project) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return projectGlyphTones[Math.abs(hash) % projectGlyphTones.length] ?? projectGlyphTones[0]
}

export const ThreadPalette = (props: ThreadPaletteProps): JSX.Element => {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [selected, setSelected] = useState('')
  const threadIndex = useMemo(() => indexThreads(props.threads), [props.threads])
  const threadRows = useMemo(
    () => rankThreads({ index: threadIndex, query: deferredQuery, limit: deferredQuery.trim().length === 0 ? props.recentLimit : 50 }),
    [props.recentLimit, threadIndex, deferredQuery],
  )
  const destinationRows = useMemo(
    () => (props.mode === 'all' ? filterByLabel(props.destinations, deferredQuery) : []),
    [props.destinations, props.mode, deferredQuery],
  )
  const rows: PaletteRow[] = useMemo(
    () => [
      ...destinationRows.map((destination): PaletteRow => ({ kind: 'destination', destination })),
      ...threadRows.map((thread): PaletteRow => ({ kind: 'thread', thread })),
    ],
    [destinationRows, threadRows],
  )
  const numbered = rows.slice(0, 9)

  const activate = (row: PaletteRow): void => {
    props.onClose()
    if (row.kind === 'thread') props.onOpenThread(row.thread.id)
    else row.destination.run()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(props.mac ? event.metaKey : event.ctrlKey) || !/^Digit[1-9]$/.test(event.code)) return
    const row = numbered[Number(event.code.slice(5)) - 1]
    if (row === undefined) return
    event.preventDefault()
    event.stopPropagation()
    activate(row)
  }

  const numberFor = (row: PaletteRow): number | null => {
    const index = numbered.findIndex(candidate => rowValue(candidate) === rowValue(row))
    return index < 0 ? null : index + 1
  }

  const shortcut = (row: PaletteRow): JSX.Element | null => {
    const number = numberFor(row)
    if (number === null) return null
    return (
      <KbdGroup className="dshx:ml-auto dshx:shrink-0">
        <Kbd>{props.mac ? '⌘' : 'Ctrl'}</Kbd>
        <Kbd>{number}</Kbd>
      </KbdGroup>
    )
  }

  const itemClass = 'dshx:gap-3 dshx:rounded-md dshx:px-2.5 dshx:py-2'

  return (
    <Dialog open onOpenChange={open => (open ? undefined : props.onClose())}>
      <DialogContent className="dshx-root dshx:gap-0 dshx:overflow-hidden dshx:p-0 dshx:sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="dshx:sr-only">{props.copy.title}</DialogTitle>
        <DialogDescription className="dshx:sr-only">{props.mode === 'threads' ? props.copy.threadsPlaceholder : props.copy.allPlaceholder}</DialogDescription>
        <Command shouldFilter={false} value={selected} onValueChange={setSelected} onKeyDown={onKeyDown} loop className="dshx:rounded-none">
          <CommandInput
            autoFocus
            className="dshx:h-11"
            value={query}
            onValueChange={setQuery}
            placeholder={props.mode === 'threads' ? props.copy.threadsPlaceholder : props.copy.allPlaceholder}
          />
          <CommandList className="dshx:max-h-[min(60vh,440px)] dshx:p-1">
            <CommandEmpty className="dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">{props.copy.empty}</CommandEmpty>
            {destinationRows.length > 0 ? (
              <CommandGroup heading={props.copy.destinations}>
                {destinationRows.map(destination => {
                  const row: PaletteRow = { kind: 'destination', destination }
                  return (
                    <CommandItem key={destination.id} value={rowValue(row)} className={itemClass} onSelect={() => activate(row)}>
                      <span
                        className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground"
                        aria-hidden="true"
                      >
                        {destination.icon}
                      </span>
                      <span className="dshx:truncate dshx:text-sm">{destination.label}</span>
                      {shortcut(row)}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            {destinationRows.length > 0 && threadRows.length > 0 ? <CommandSeparator className="dshx:my-1" /> : null}
            {threadRows.length > 0 ? (
              <CommandGroup heading={deferredQuery.trim().length === 0 ? props.copy.recent : props.copy.threads}>
                {threadRows.map(thread => {
                  const row: PaletteRow = { kind: 'thread', thread }
                  const project = thread.project.length > 0 ? thread.project : props.copy.unassigned
                  return (
                    <CommandItem key={thread.id} value={rowValue(row)} className={itemClass} onSelect={() => activate(row)}>
                      <span
                        className={cn(
                          'dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-[11px] dshx:font-semibold',
                          thread.project.length > 0 ? glyphTone(project) : 'dshx:bg-muted dshx:text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        {thread.project.length > 0 ? project.slice(0, 2).toLocaleUpperCase() : <MessageSquareIcon className="dshx:size-3.5" />}
                      </span>
                      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                        <span className="dshx:truncate dshx:text-sm dshx:font-medium">{thread.title}</span>
                        <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                          {project}
                          {thread.cwd.length > 0 ? (
                            <>
                              {' · '}
                              <span className="dshx:font-mono">{thread.cwd}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      {shortcut(row)}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        <footer className="dshx:flex dshx:items-center dshx:gap-4 dshx:border-t dshx:bg-muted/40 dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">
          <span className="dshx:flex dshx:items-center dshx:gap-1.5">
            <KbdGroup>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </KbdGroup>
            {props.copy.navigate}
          </span>
          <span className="dshx:flex dshx:items-center dshx:gap-1.5">
            <Kbd>Enter</Kbd>
            {props.copy.open}
          </span>
          <span className="dshx:flex dshx:items-center dshx:gap-1.5">
            <Kbd>Esc</Kbd>
            {props.copy.close}
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
