import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { FileIcon, FileSearchIcon, MessageSquareIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { z } from 'zod'
import { frecencyBoosts, paletteFrecency, recordUse } from './frecency.js'
import {
  indexFiles,
  indexThreads,
  OPEN_FILE_EVENT,
  rankActions,
  rankFiles,
  rankThreads,
  WORKSPACE_FILES_EVENT,
  type PaletteMode,
  type ThreadCandidate,
} from './palette.js'
import type { PaletteDestination } from './sidebar-state.js'

export interface ThreadPaletteCopy {
  readonly title: string
  readonly threadsPlaceholder: string
  readonly allPlaceholder: string
  readonly filesPlaceholder: string
  readonly recent: string
  readonly threads: string
  readonly destinations: string
  readonly commands: string
  readonly files: string
  readonly goToFile: string
  readonly filesIndexing: string
  readonly filesTruncated: string
  readonly filesNoSession: string
  readonly filesUnavailable: string
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

type PaletteRow =
  | { readonly kind: 'thread'; readonly thread: ThreadCandidate }
  | { readonly kind: 'destination'; readonly destination: PaletteDestination }
  | { readonly kind: 'file'; readonly path: string }

const RESULT_LIMIT = 50
const COMMAND_LIMIT = 30
const FRECENT_COMMANDS_ON_EMPTY = 5
const GO_TO_FILE_ID = 'action:go-to-file'

const rowValue = (row: PaletteRow): string => {
  if (row.kind === 'thread') return `thread:${row.thread.id}`
  if (row.kind === 'file') return `file:${row.path}`
  return `destination:${row.destination.id}`
}

const filesReplySchema = z.union([
  z.object({ status: z.literal('no-session') }),
  z.object({
    status: z.enum(['indexing', 'ready']),
    sessionId: z.string().min(1).max(256),
    files: z.array(z.string().min(1).max(4096)).max(50_000),
    truncated: z.boolean(),
  }),
])

interface FilesState {
  readonly status: 'loading' | 'indexing' | 'ready' | 'no-session' | 'unavailable'
  readonly sessionId: string | null
  readonly files: readonly string[]
  readonly truncated: boolean
}

const NO_FILES: FilesState = { status: 'loading', sessionId: null, files: [], truncated: false }

/** Asks @dshfiles/editor for the file list of the thread on screen; replies stream in while it walks the workspace. */
const useWorkspaceFiles = (enabled: boolean): FilesState => {
  const [state, setState] = useState<FilesState>(NO_FILES)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const respond = (reply: unknown): void => {
      const decoded = filesReplySchema.safeParse(reply)
      if (!decoded.success || controller.signal.aborted) return
      if (decoded.data.status === 'no-session') setState({ ...NO_FILES, status: 'no-session' })
      else setState(decoded.data)
    }
    const handled = !window.dispatchEvent(new CustomEvent(WORKSPACE_FILES_EVENT, { detail: { respond, signal: controller.signal }, cancelable: true }))
    if (!handled) setState({ ...NO_FILES, status: 'unavailable' })
    return () => controller.abort()
  }, [enabled])
  return state
}

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
  const [mode, setMode] = useState(props.mode)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const emptyQuery = deferredQuery.trim().length === 0
  const [selected, setSelected] = useState('')
  const frecency = paletteFrecency.useValue()
  const boosts = useMemo(() => frecencyBoosts(frecency, Date.now()), [frecency])

  const workspaceFiles = useWorkspaceFiles(mode === 'files')
  const fileIndex = useMemo(() => indexFiles(workspaceFiles.files), [workspaceFiles.files])
  // Frecency follows the workspace folder, so a file picked in one thread is still frecent in its siblings.
  const fileScope = props.threads.find(thread => thread.id === workspaceFiles.sessionId)?.cwd || workspaceFiles.sessionId
  const fileKey = (path: string): string => `file:${fileScope}:${path}`
  const fileRows = useMemo(
    () =>
      mode === 'files'
        ? rankFiles({ index: fileIndex, query: deferredQuery, limit: RESULT_LIMIT, boost: path => boosts.get(`file:${fileScope}:${path}`) ?? 0 })
        : [],
    [boosts, deferredQuery, fileIndex, fileScope, mode],
  )

  const threadIndex = useMemo(() => indexThreads(props.threads), [props.threads])
  const threadRows = useMemo(
    () =>
      mode === 'files'
        ? []
        : rankThreads({ index: threadIndex, query: deferredQuery, limit: deferredQuery.trim().length === 0 ? props.recentLimit : RESULT_LIMIT }),
    [deferredQuery, mode, props.recentLimit, threadIndex],
  )

  const goToFile: PaletteDestination = useMemo(
    () => ({
      id: GO_TO_FILE_ID,
      group: 'destination',
      label: props.copy.goToFile,
      aliases: ['open file', 'find file'],
      icon: <FileSearchIcon className="dshx:size-4" />,
      run: () => undefined,
    }),
    [props.copy.goToFile],
  )
  const destinationRows = useMemo(
    () =>
      mode === 'all'
        ? rankActions({
            actions: [goToFile, ...props.destinations.filter(destination => destination.group === 'destination')],
            query: deferredQuery,
            boost: id => boosts.get(id) ?? 0,
          })
        : [],
    [boosts, deferredQuery, goToFile, mode, props.destinations],
  )
  const commandRows = useMemo(() => {
    if (mode !== 'all') return []
    const commands = props.destinations.filter(destination => destination.group === 'command')
    if (deferredQuery.trim().length > 0)
      return rankActions({ actions: commands, query: deferredQuery, boost: id => boosts.get(id) ?? 0 }).slice(0, COMMAND_LIMIT)
    return rankActions({ actions: commands.filter(command => boosts.has(command.id)), query: '', boost: id => boosts.get(id) ?? 0 }).slice(
      0,
      FRECENT_COMMANDS_ON_EMPTY,
    )
  }, [boosts, deferredQuery, mode, props.destinations])

  const rows: PaletteRow[] = useMemo(
    () => [
      ...destinationRows.map((destination): PaletteRow => ({ kind: 'destination', destination })),
      ...commandRows.map((destination): PaletteRow => ({ kind: 'destination', destination })),
      ...fileRows.map((path): PaletteRow => ({ kind: 'file', path })),
      ...threadRows.map((thread): PaletteRow => ({ kind: 'thread', thread })),
    ],
    [commandRows, destinationRows, fileRows, threadRows],
  )
  const numbered = rows.slice(0, 9)

  const remember = (id: string): void => {
    paletteFrecency.set(recordUse(paletteFrecency.get(), id, Date.now()))
  }

  const activate = (row: PaletteRow): void => {
    if (row.kind === 'destination' && row.destination.id === GO_TO_FILE_ID) {
      remember(GO_TO_FILE_ID)
      setMode('files')
      setQuery('')
      return
    }
    props.onClose()
    if (row.kind === 'thread') {
      props.onOpenThread(row.thread.id)
      return
    }
    if (row.kind === 'file') {
      remember(fileKey(row.path))
      window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: { path: row.path }, cancelable: true }))
      return
    }
    remember(row.destination.id)
    row.destination.run()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(props.mac ? event.metaKey : event.ctrlKey) || !/^Digit[1-9]$/.test(event.code)) return
    const row = numbered[Number(event.code.slice(5)) - 1]
    if (row === undefined) return
    event.preventDefault()
    event.stopPropagation()
    activate(row)
  }

  const shortcut = (row: PaletteRow): JSX.Element | null => {
    const index = numbered.findIndex(candidate => rowValue(candidate) === rowValue(row))
    const keys = row.kind === 'destination' ? (row.destination.keys ?? []) : []
    if (index < 0 && keys.length === 0) return null
    return (
      <span className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
        {keys.length > 0 ? (
          <KbdGroup className="dshx:opacity-70">
            {keys.map(key => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        ) : null}
        {index < 0 ? null : (
          <KbdGroup>
            <Kbd>{props.mac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>{index + 1}</Kbd>
          </KbdGroup>
        )}
      </span>
    )
  }

  const itemClass = 'dshx:gap-3 dshx:rounded-md dshx:px-2.5 dshx:py-2'
  const placeholder = mode === 'files' ? props.copy.filesPlaceholder : mode === 'threads' ? props.copy.threadsPlaceholder : props.copy.allPlaceholder

  const destinationItem = (destination: PaletteDestination): JSX.Element => {
    const row: PaletteRow = { kind: 'destination', destination }
    return (
      <CommandItem key={destination.id} value={rowValue(row)} className={itemClass} onSelect={() => activate(row)}>
        <span className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground" aria-hidden="true">
          {destination.icon}
        </span>
        <span className="dshx:truncate dshx:text-sm">{destination.label}</span>
        {shortcut(row)}
      </CommandItem>
    )
  }

  const filesStatus =
    mode !== 'files'
      ? null
      : workspaceFiles.status === 'unavailable'
        ? props.copy.filesUnavailable
        : workspaceFiles.status === 'no-session'
          ? props.copy.filesNoSession
          : workspaceFiles.status === 'loading' || workspaceFiles.status === 'indexing'
            ? props.copy.filesIndexing
            : workspaceFiles.truncated
              ? props.copy.filesTruncated
              : null

  return (
    <Dialog open onOpenChange={open => (open ? undefined : props.onClose())}>
      <DialogContent className="dshx-root dshx:gap-0 dshx:overflow-hidden dshx:p-0 dshx:sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="dshx:sr-only">{props.copy.title}</DialogTitle>
        <DialogDescription className="dshx:sr-only">{placeholder}</DialogDescription>
        <Command shouldFilter={false} value={selected} onValueChange={setSelected} onKeyDown={onKeyDown} loop className="dshx:rounded-none">
          <CommandInput autoFocus className="dshx:h-11" value={query} onValueChange={setQuery} placeholder={placeholder} />
          <CommandList className="dshx:max-h-[min(60vh,440px)] dshx:p-1">
            <CommandEmpty className="dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">{filesStatus ?? props.copy.empty}</CommandEmpty>
            {destinationRows.length > 0 ? <CommandGroup heading={props.copy.destinations}>{destinationRows.map(destinationItem)}</CommandGroup> : null}
            {commandRows.length > 0 ? (
              <>
                {destinationRows.length > 0 ? <CommandSeparator className="dshx:my-1" /> : null}
                <CommandGroup heading={props.copy.commands}>{commandRows.map(destinationItem)}</CommandGroup>
              </>
            ) : null}
            {fileRows.length > 0 ? (
              <CommandGroup heading={props.copy.files}>
                {fileRows.map(path => {
                  const row: PaletteRow = { kind: 'file', path }
                  const slash = path.lastIndexOf('/')
                  return (
                    <CommandItem key={path} value={rowValue(row)} className={itemClass} onSelect={() => activate(row)}>
                      <FileIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" />
                      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-2">
                        <span className="dshx:truncate dshx:text-sm dshx:font-medium">{path.slice(slash + 1)}</span>
                        {slash > 0 ? (
                          <span className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{path.slice(0, slash)}</span>
                        ) : null}
                      </span>
                      {shortcut(row)}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            {(destinationRows.length > 0 || commandRows.length > 0) && threadRows.length > 0 ? <CommandSeparator className="dshx:my-1" /> : null}
            {threadRows.length > 0 ? (
              <CommandGroup heading={emptyQuery ? props.copy.recent : props.copy.threads}>
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
          {filesStatus !== null && fileRows.length > 0 ? <span className="dshx:ml-auto dshx:truncate">{filesStatus}</span> : null}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
