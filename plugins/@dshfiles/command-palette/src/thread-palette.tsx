import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Kbd, KbdGroup } from '@dshfiles/plugin-ui/components/ui/kbd'
import { ArrowLeftIcon, CheckIcon, CommandIcon, FileIcon, FileSearchIcon, HashIcon, ListOrderedIcon, MessageSquareIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useContentSearch, type ContentSearch } from './content-search-machine.js'
import { PaletteFrecency, paletteFrecency } from './frecency.js'
import { paletteNavigationMachine } from './palette-navigation-machine.js'
import { useWorkspaceFiles } from './workspace-files-machine.js'
import { ProjectTone } from './project-tone.js'
import { PaletteRules, type PalettePrefix, type ThreadCandidate } from './palette.js'
import { PaletteApi } from './palette-api.js'
import type { PaletteAction, PaletteActionContext, PaletteMode } from './palette-contract.js'
import { paletteActionMachine } from './palette-action-machine.js'

export interface ThreadPaletteCopy {
  readonly title: string
  readonly threadsPlaceholder: string
  readonly allPlaceholder: string
  readonly filesPlaceholder: string
  readonly backlog: string
  readonly backlogPlaceholder: string
  readonly backlogOpen: string
  readonly backlogUnavailable: string
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
  readonly clear: string
  readonly back: string
  readonly searchIn: string
  /** Accessible name of the search box; the dialog's description is only linked, not a name. */
  readonly searchLabel: string
  readonly sessionNotFound: string
  readonly unassigned: string
  readonly prefixHint: string
  readonly viewAll: string
  readonly viewCommands: string
  readonly viewContent: string
  readonly viewLine: string
  readonly viewHelp: string
  readonly commandsPlaceholder: string
  readonly contentPlaceholder: string
  readonly linePlaceholder: string
  readonly helpPlaceholder: string
  readonly helpCommands: string
  readonly helpContent: string
  readonly helpLine: string
  readonly helpSession: string
  readonly helpThread: string
  readonly helpNone: string
  readonly goToLine: string
  readonly noEditorFile: string
  readonly contentSearching: string
  readonly contentUnavailable: string
  readonly actionFailed: string
  /** Ask DSH: the entry point shown on an empty palette, its input, and its result row. */
  readonly ask: string
  readonly askPlaceholder: string
  readonly askHint: string
  readonly askEmpty: string
  readonly askPending: string
  readonly askSend: string
  readonly askExit: string
  readonly askFailed: string
}

type PaletteActionOption = Omit<PaletteAction, 'label'> & { readonly label: string }

interface ThreadPaletteProps {
  readonly mode: PaletteMode
  readonly threads: readonly ThreadCandidate[]
  /** The current project's threads; when set, the Threads tab lists only these, while a session ID still finds any thread. */
  readonly projectThreads?: readonly ThreadCandidate[]
  readonly context: PaletteActionContext
  readonly additionalActions: readonly PaletteAction[]
  readonly recentLimit: number
  readonly mac: boolean
  readonly copy: ThreadPaletteCopy
  readonly searchContent: ContentSearch | null
  readonly onOpenThread: (sessionId: string) => void
  /** Send one Ask DSH question and open the thread it creates; a rejection keeps the palette open. */
  readonly onAsk: (question: string) => Promise<void>
  readonly onBacklogCapture: (text: string) => boolean
  readonly onClose: () => void
}

type PaletteRow =
  | { readonly kind: 'thread'; readonly thread: ThreadCandidate }
  | { readonly kind: 'destination'; readonly destination: PaletteActionOption }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'content'; readonly thread: ThreadCandidate; readonly snippet: string }
  | { readonly kind: 'line'; readonly line: number }
  | { readonly kind: 'help'; readonly prefix: PalettePrefix | ''; readonly label: string }
  | { readonly kind: 'ask'; readonly question: string }
  | { readonly kind: 'backlog'; readonly text: string }

const RESULT_LIMIT = 50
const COMMAND_LIMIT = 30
const FRECENT_COMMANDS_ON_EMPTY = 5
const GO_TO_FILE_ID = 'action:go-to-file'

const escapeLabelFor = (input: { readonly ask: boolean; readonly subview: boolean; readonly hasQuery: boolean; readonly copy: ThreadPaletteCopy }): string => {
  if (input.ask) return input.hasQuery ? input.copy.clear : input.copy.askExit
  if (input.subview) return input.copy.back
  if (input.hasQuery) return input.copy.clear
  return input.copy.close
}

const rememberPaletteUse = (id: string): void => {
  paletteFrecency.set(PaletteFrecency.recordUse(paletteFrecency.get(), id, Date.now()))
}

const rowValue = (row: PaletteRow): string => {
  if (row.kind === 'thread') return `thread:${row.thread.id}`
  if (row.kind === 'content') return `content:${row.thread.id}`
  if (row.kind === 'file') return `file:${row.path}`
  if (row.kind === 'line') return `line:${row.line}`
  if (row.kind === 'help') return `help:${row.prefix}`
  if (row.kind === 'ask') return 'ask-dsh'
  if (row.kind === 'backlog') return `backlog:${row.text}`
  return `destination:${row.destination.id}`
}

type PaletteView = PaletteMode | 'commands' | 'content' | 'line' | 'help' | 'ask'

const VIEW_BY_PREFIX = {
  '>': 'commands',
  '<': 'backlog',
  '#': 'content',
  ':': 'line',
  '?': 'help',
  'thread:': 'threads',
  'session:': 'threads',
} satisfies Readonly<Record<PalettePrefix, PaletteView>>

/** Host shortcut commands that do what a differently labelled palette entry already does. */
const SAME_COMMAND_AS = new Map([['@dshfiles/thread-sidebar/command/session.new', 'new thread']])

export const ThreadPalette = (props: ThreadPaletteProps): JSX.Element => {
  const [navigationSnapshot, sendNavigation] = useMachine(paletteNavigationMachine, { input: { mode: props.mode } })
  const { mode, query, backStack, notice, selected, closeRequested, ask } = navigationSnapshot.context
  const parsed = PaletteRules.parsePaletteQuery(query)
  // In Ask DSH the whole query is the question: prefixes are ordinary text there.
  const searchText = ask ? query : parsed.text
  const view: PaletteView = ask ? 'ask' : parsed.prefix === null ? mode : VIEW_BY_PREFIX[parsed.prefix]
  const deferredQuery = useDeferredValue(searchText)
  const subview = !ask && (backStack.length > 0 || parsed.prefix !== null)
  useEffect(() => sendNavigation({ type: 'mode.sync', mode: props.mode }), [props.mode, sendNavigation])
  const emptyQuery = deferredQuery.trim().length === 0
  const [askPending, setAskPending] = useState(false)
  // Ranking happens within one palette visit, so the instant it opened is the whole clock the memo needs.
  const [openedAt] = useState(() => Date.now())
  const askInFlight = useRef(false)
  const [actionSnapshot, sendAction, actionActor] = useMachine(paletteActionMachine)
  const latestOnClose = useRef(props.onClose)
  latestOnClose.current = props.onClose
  useEffect(() => {
    const subscription = actionActor.on('completed', () => latestOnClose.current())
    return () => subscription.unsubscribe()
  }, [actionActor])
  useEffect(() => {
    if (!closeRequested) return
    latestOnClose.current()
    sendNavigation({ type: 'close.handled' })
  }, [closeRequested, sendNavigation])
  const submitAsk = async (question: string): Promise<void> => {
    const trimmed = question.trim()
    if (trimmed.length === 0 || askInFlight.current) return
    askInFlight.current = true
    setAskPending(true)
    try {
      await props.onAsk(trimmed)
      latestOnClose.current()
    } catch {
      sendNavigation({ type: 'notice.show', message: props.copy.askFailed })
    } finally {
      askInFlight.current = false
      setAskPending(false)
    }
  }
  const runningAction = actionSnapshot.matches('running')
  const frecency = paletteFrecency.useValue()
  const boosts = useMemo(() => PaletteFrecency.boosts(frecency, openedAt), [frecency, openedAt])
  const registeredActions = useSyncExternalStore(PaletteApi.subscribe, PaletteApi.getSnapshot, PaletteApi.getSnapshot).actions
  const actionOptions = useMemo<PaletteActionOption[]>(() => {
    // Several bundles register the same command ("New thread" comes from this palette, the sidebar header and the
    // Host shortcut catalog); list it once, keeping an action or destination over its bare shortcut-command twin.
    const registeredLabels = new Set<string>()
    const byKind = [...registeredActions.filter(action => action.group !== 'command'), ...registeredActions.filter(action => action.group === 'command')]
    const registered = byKind.flatMap(action => {
      if (action.isAvailable?.(props.context) === false) return []
      const label = typeof action.label === 'function' ? action.label() : action.label
      const key = SAME_COMMAND_AS.get(action.id) ?? label.trim().toLowerCase()
      if (registeredLabels.has(key)) return []
      registeredLabels.add(key)
      return [{ ...action, label }]
    })
    const additional = props.additionalActions.flatMap(action =>
      action.isAvailable?.(props.context) === false ? [] : [{ ...action, label: typeof action.label === 'function' ? action.label() : action.label }],
    )
    return [...registered, ...additional]
  }, [props.additionalActions, props.context, registeredActions])

  const workspaceFiles = useWorkspaceFiles(mode === 'files')
  const fileIndex = useMemo(() => PaletteRules.indexFiles(workspaceFiles.files), [workspaceFiles.files])
  // Frecency follows the workspace folder, so a file picked in one thread is still frecent in its siblings.
  const fileScope = props.threads.find(thread => thread.id === workspaceFiles.sessionId)?.cwd || workspaceFiles.sessionId
  const fileKey = (path: string): string => `file:${fileScope}:${path}`
  const fileRows = useMemo(
    () =>
      view === 'files'
        ? PaletteRules.rankFiles({ index: fileIndex, query: deferredQuery, limit: RESULT_LIMIT, boost: path => boosts.get(`file:${fileScope}:${path}`) ?? 0 })
        : [],
    [boosts, deferredQuery, fileIndex, fileScope, view],
  )

  const threadIndex = useMemo(() => PaletteRules.indexThreads(props.threads), [props.threads])
  const projectThreadIndex = useMemo(
    () => (props.projectThreads === undefined ? null : PaletteRules.indexThreads(props.projectThreads)),
    [props.projectThreads],
  )
  const threadSearch = PaletteRules.parseThreadSearchInput(deferredQuery)
  const rankedThreadIndex = view === 'threads' && threadSearch.exactId === undefined ? (projectThreadIndex ?? threadIndex) : threadIndex
  const threadRows = useMemo(
    () =>
      view === 'all' || view === 'threads'
        ? PaletteRules.rankThreads({
            index: rankedThreadIndex,
            query: threadSearch.query,
            limit: threadSearch.query.length === 0 ? props.recentLimit : RESULT_LIMIT,
          })
        : [],
    [props.recentLimit, rankedThreadIndex, threadSearch.query, view],
  )
  const exactSearchId = threadSearch.exactId?.toLocaleLowerCase()
  const missingSessionId =
    (view === 'all' || view === 'threads') && exactSearchId !== undefined && !threadIndex.entries.some(entry => entry.id === exactSearchId)

  const content = useContentSearch(view === 'content' ? deferredQuery : '', props.searchContent, props.threads)
  const contentRows = useMemo(() => {
    if (view !== 'content') return []
    const threadsById = new Map(props.threads.map(thread => [thread.id, thread]))
    return content.hits.flatMap(hit => {
      // A finder hit names its own thread, so content search still reaches a thread this client has not listed
      // (a thread from another project, or one whose workspace is gone).
      const known = threadsById.get(hit.sessionId)
      const thread =
        known ??
        (hit.title === undefined
          ? undefined
          : { id: hit.sessionId, title: hit.title, project: hit.project ?? '', cwd: hit.cwd ?? '', updatedAt: hit.updatedAt ?? 0 })
      return thread === undefined ? [] : [{ thread, snippet: hit.snippet }]
    })
  }, [content.hits, props.threads, view])
  const line = view === 'line' ? PaletteRules.parseLineNumber(deferredQuery) : null
  const helpRows = useMemo(
    () =>
      view === 'help'
        ? [
            { prefix: 'thread:' as const, label: props.copy.helpThread },
            { prefix: 'session:' as const, label: props.copy.helpSession },
            { prefix: '>' as const, label: props.copy.helpCommands },
            { prefix: '<' as const, label: props.copy.backlog },
            { prefix: '#' as const, label: props.copy.helpContent },
            { prefix: ':' as const, label: props.copy.helpLine },
            { prefix: '' as const, label: props.copy.helpNone },
          ]
        : [],
    [
      props.copy.backlog,
      props.copy.helpCommands,
      props.copy.helpContent,
      props.copy.helpLine,
      props.copy.helpNone,
      props.copy.helpSession,
      props.copy.helpThread,
      view,
    ],
  )

  const askRows = useMemo<PaletteRow[]>(
    () => (view === 'ask' && deferredQuery.trim().length > 0 ? [{ kind: 'ask', question: deferredQuery.trim() }] : []),
    [deferredQuery, view],
  )

  const backlogRows = useMemo<PaletteRow[]>(
    () => (view === 'backlog' ? [{ kind: 'backlog', text: (parsed.prefix === '<' ? parsed.text : query).trim() }] : []),
    [parsed.prefix, parsed.text, query, view],
  )

  const goToFile: PaletteActionOption = useMemo(
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
      view === 'all' || view === 'commands'
        ? PaletteRules.rankActions({
            actions: [goToFile, ...actionOptions.filter(action => action.group !== 'command')],
            query: deferredQuery,
            boost: id => boosts.get(id) ?? 0,
          })
        : [],
    [actionOptions, boosts, deferredQuery, goToFile, view],
  )
  const commandRows = useMemo(() => {
    if (view !== 'all' && view !== 'commands') return []
    const commands = actionOptions.filter(action => action.group === 'command')
    if (view === 'commands')
      return PaletteRules.rankActions({ actions: commands, query: deferredQuery, boost: id => boosts.get(id) ?? 0 }).slice(0, RESULT_LIMIT)
    if (deferredQuery.trim().length > 0)
      return PaletteRules.rankActions({ actions: commands, query: deferredQuery, boost: id => boosts.get(id) ?? 0 }).slice(0, COMMAND_LIMIT)
    return PaletteRules.rankActions({ actions: commands.filter(command => boosts.has(command.id)), query: '', boost: id => boosts.get(id) ?? 0 }).slice(
      0,
      FRECENT_COMMANDS_ON_EMPTY,
    )
  }, [actionOptions, boosts, deferredQuery, view])

  const rows: PaletteRow[] = useMemo(
    () => [
      ...askRows,
      ...backlogRows,
      ...helpRows.map((help): PaletteRow => ({ kind: 'help', ...help })),
      ...(line === null ? [] : [{ kind: 'line', line } satisfies PaletteRow]),
      ...contentRows.map((hit): PaletteRow => ({ kind: 'content', ...hit })),
      ...destinationRows.map((destination): PaletteRow => ({ kind: 'destination', destination })),
      ...commandRows.map((destination): PaletteRow => ({ kind: 'destination', destination })),
      ...fileRows.map((path): PaletteRow => ({ kind: 'file', path })),
      ...threadRows.map((thread): PaletteRow => ({ kind: 'thread', thread })),
    ],
    [askRows, backlogRows, commandRows, contentRows, destinationRows, fileRows, helpRows, line, threadRows],
  )
  const numbered = rows.slice(0, 9)
  // Until the pointer or arrows pick a row, the first match is active, so Enter runs it right after typing.
  const activeValue = rows.some(row => rowValue(row) === selected) ? selected : rows[0] === undefined ? '' : rowValue(rows[0])

  const activate = (row: PaletteRow): void => {
    if (row.kind === 'ask') {
      // Enter can land before the deferred row catches up with the last keystroke; the live query wins.
      void submitAsk(query)
      return
    }
    if (row.kind === 'backlog') {
      if (!props.onBacklogCapture(row.text)) {
        sendNavigation({ type: 'notice.show', message: props.copy.backlogUnavailable })
        return
      }
      props.onClose()
      return
    }
    if (row.kind === 'help') {
      sendNavigation({ type: 'query.change', query: row.prefix })
      return
    }
    if (row.kind === 'line') {
      const handled = !window.dispatchEvent(new CustomEvent(PaletteRules.GO_TO_LINE_EVENT, { detail: { line: row.line }, cancelable: true }))
      if (handled) props.onClose()
      else sendNavigation({ type: 'notice.show', message: props.copy.noEditorFile })
      return
    }
    if (row.kind === 'destination' && row.destination.id === GO_TO_FILE_ID) {
      rememberPaletteUse(GO_TO_FILE_ID)
      sendNavigation({ type: 'files.navigate' })
      return
    }
    if (row.kind === 'thread' || row.kind === 'content') {
      props.onClose()
      props.onOpenThread(row.thread.id)
      return
    }
    if (row.kind === 'file') {
      props.onClose()
      rememberPaletteUse(fileKey(row.path))
      window.dispatchEvent(new CustomEvent(PaletteRules.OPEN_FILE_EVENT, { detail: { path: row.path }, cancelable: true }))
      return
    }
    rememberPaletteUse(row.destination.id)
    sendAction({ type: 'run', action: row.destination, context: props.context })
  }

  const clearNotice = (): void => {
    sendNavigation({ type: 'notice.clear' })
    if (actionSnapshot.matches('failed')) sendAction({ type: 'reset' })
  }

  const goBack = (): void => {
    sendNavigation({ type: 'back' })
    if (actionSnapshot.matches('failed')) sendAction({ type: 'reset' })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Tab on an empty search toggles the Ask DSH bar, as Linear's palette does for Ask Linear.
    if (event.key === 'Tab' && !event.shiftKey && !subview && query.length === 0) {
      event.preventDefault()
      event.stopPropagation()
      sendNavigation({ type: ask ? 'ask.exit' : 'ask.enter' })
      return
    }
    if (!(props.mac ? event.metaKey : event.ctrlKey) || !/^Digit[1-9]$/.test(event.code)) return
    const row = numbered[Number(event.code.slice(5)) - 1]
    if (row === undefined) return
    event.preventDefault()
    event.stopPropagation()
    void activate(row)
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
  const viewCopy = {
    all: { chip: props.copy.viewAll, placeholder: props.copy.allPlaceholder },
    threads: { chip: props.copy.threads, placeholder: props.copy.threadsPlaceholder },
    files: { chip: props.copy.files, placeholder: props.copy.filesPlaceholder },
    backlog: { chip: props.copy.backlog, placeholder: props.copy.backlogPlaceholder },
    commands: { chip: props.copy.viewCommands, placeholder: props.copy.commandsPlaceholder },
    content: { chip: props.copy.viewContent, placeholder: props.copy.contentPlaceholder },
    line: { chip: props.copy.viewLine, placeholder: props.copy.linePlaceholder },
    help: { chip: props.copy.viewHelp, placeholder: props.copy.helpPlaceholder },
    ask: { chip: props.copy.ask, placeholder: props.copy.askPlaceholder },
  } satisfies Readonly<Record<PaletteView, { readonly chip: string; readonly placeholder: string }>>
  const placeholder = viewCopy[view].placeholder
  const escapeLabel = escapeLabelFor({ ask, subview, hasQuery: query.length > 0, copy: props.copy })
  const showAskEntry = !ask && !subview && query.length === 0
  const askStatus = ask ? (askPending ? props.copy.askPending : props.copy.askHint) : props.copy.prefixHint

  const destinationItem = (destination: PaletteActionOption): JSX.Element => {
    const row: PaletteRow = { kind: 'destination', destination }
    return (
      <CommandItem key={destination.id} value={rowValue(row)} className={itemClass} disabled={runningAction} onSelect={() => void activate(row)}>
        <span className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground" aria-hidden="true">
          {destination.icon ?? <CommandIcon className="dshx:size-4" />}
        </span>
        <span className="dshx:truncate dshx:text-sm">{destination.label}</span>
        {destination.isSelected?.(props.context) === true ? <CheckIcon className="dshx:ml-auto dshx:size-4 dshx:text-primary" aria-hidden="true" /> : null}
        {shortcut(row)}
      </CommandItem>
    )
  }

  let contentStatus: string | null = null
  if (view === 'content' && (props.searchContent === null || content.status === 'failed')) contentStatus = props.copy.contentUnavailable
  else if (view === 'content' && content.status === 'searching') contentStatus = props.copy.contentSearching
  let filesStatus: string | null = null
  if (view === 'files' && workspaceFiles.status === 'unavailable') filesStatus = props.copy.filesUnavailable
  else if (view === 'files' && workspaceFiles.status === 'no-session') filesStatus = props.copy.filesNoSession
  else if (view === 'files' && (workspaceFiles.status === 'loading' || workspaceFiles.status === 'indexing')) filesStatus = props.copy.filesIndexing
  else if (view === 'files' && workspaceFiles.truncated) filesStatus = props.copy.filesTruncated

  return (
    <Dialog open onOpenChange={(open: boolean) => (open ? undefined : props.onClose())}>
      <DialogContent
        className="dshx-root dshx:gap-0 dshx:overflow-hidden dshx:p-0 dshx:sm:max-w-2xl"
        showCloseButton={false}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          if (!ask && !subview && query.length === 0) return
          event.preventDefault()
          goBack()
        }}
      >
        <DialogTitle className="dshx:sr-only">{props.copy.title}</DialogTitle>
        <DialogDescription className="dshx:sr-only">{placeholder}</DialogDescription>
        <Command
          shouldFilter={false}
          value={activeValue}
          onValueChange={value => sendNavigation({ type: 'selection.change', value })}
          onKeyDown={onKeyDown}
          loop
          className="dshx:rounded-none"
        >
          <div className="dshx:relative">
            <CommandInput
              autoFocus
              aria-label={props.copy.searchLabel}
              className="dshx:h-11"
              value={query}
              onValueChange={next => {
                sendNavigation({ type: 'query.change', query: next })
                clearNotice()
              }}
              placeholder={placeholder}
            />
            {showAskEntry ? (
              <button
                type="button"
                aria-label={props.copy.ask}
                title={props.copy.ask}
                onMouseDown={event => event.preventDefault()}
                onClick={() => sendNavigation({ type: 'ask.enter' })}
                className="dshx:absolute dshx:right-2 dshx:top-1/2 dshx:flex dshx:-translate-y-1/2 dshx:items-center dshx:gap-2 dshx:rounded dshx:px-1.5 dshx:py-0.5 dshx:text-xs dshx:text-muted-foreground dshx:hover:text-foreground"
              >
                <span>{props.copy.ask}</span>
                <KbdGroup>
                  <Kbd>Tab</Kbd>
                </KbdGroup>
              </button>
            ) : null}
          </div>
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:px-3 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">
            {ask || subview ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={ask ? props.copy.askExit : props.copy.back}
                title={ask ? props.copy.askExit : props.copy.back}
                onClick={event => {
                  if (ask) sendNavigation({ type: 'ask.exit' })
                  else goBack()
                  event.currentTarget.closest('[role="dialog"]')?.querySelector<HTMLInputElement>('[data-slot="command-input"]')?.focus()
                }}
              >
                <ArrowLeftIcon aria-hidden="true" />
              </Button>
            ) : (
              <Tabs
                value={mode}
                onValueChange={(value: string) => {
                  if (value !== 'all' && value !== 'threads' && value !== 'files' && value !== 'backlog') return
                  sendNavigation({ type: 'mode.change', mode: value })
                }}
              >
                <TabsList aria-label={props.copy.searchIn}>
                  <TabsTrigger value="all">{props.copy.viewAll}</TabsTrigger>
                  <TabsTrigger value="threads">{props.copy.threads}</TabsTrigger>
                  <TabsTrigger value="files">{props.copy.files}</TabsTrigger>
                  <TabsTrigger value="backlog">{props.copy.backlog}</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
            {ask || subview ? <Badge variant="secondary">{viewCopy[view].chip}</Badge> : null}
            <span className="dshx:truncate">{notice ?? (actionSnapshot.matches('failed') && !ask ? props.copy.actionFailed : askStatus)}</span>
          </div>
          <CommandList className="dshx:max-h-[min(60vh,440px)] dshx:p-1">
            <CommandEmpty className="dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">
              {ask && emptyQuery
                ? props.copy.askEmpty
                : missingSessionId && threadSearch.exactId !== undefined
                  ? props.copy.sessionNotFound.replace('{id}', threadSearch.exactId)
                  : (filesStatus ?? contentStatus ?? (view === 'line' ? props.copy.linePlaceholder : props.copy.empty))}
            </CommandEmpty>
            {backlogRows.length > 0 ? (
              <CommandGroup heading={props.copy.backlog}>
                {backlogRows.map(row => (
                  <CommandItem key={rowValue(row)} value={rowValue(row)} className={itemClass} onSelect={() => void activate(row)}>
                    <HashIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" />
                    <span className="dshx:truncate dshx:text-sm">
                      {row.kind === 'backlog' && row.text.length > 0 ? `${props.copy.backlogOpen}: ${row.text}` : props.copy.backlogOpen}
                    </span>
                    {shortcut(row)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {askRows.length > 0 ? (
              <CommandGroup heading={props.copy.ask}>
                {askRows.map(row => (
                  <CommandItem key="ask-dsh" value={rowValue(row)} className={itemClass} disabled={askPending} onSelect={() => void activate(row)}>
                    <span
                      className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground"
                      aria-hidden="true"
                    >
                      <MessageSquareIcon className="dshx:size-4" />
                    </span>
                    <span className="dshx:truncate dshx:text-sm">{`${props.copy.ask}: ${row.kind === 'ask' ? row.question : ''}`}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {helpRows.length > 0 ? (
              <CommandGroup heading={props.copy.viewHelp}>
                {helpRows.map(help => {
                  const row: PaletteRow = { kind: 'help', ...help }
                  return (
                    <CommandItem key={help.prefix} value={rowValue(row)} className={itemClass} onSelect={() => void activate(row)}>
                      <Kbd className="dshx:min-w-7 dshx:justify-center">{help.prefix === '' ? '∅' : help.prefix}</Kbd>
                      <span className="dshx:truncate dshx:text-sm">{help.label}</span>
                      {shortcut(row)}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            {line === null ? null : (
              <CommandGroup heading={props.copy.viewLine}>
                <CommandItem value={rowValue({ kind: 'line', line })} className={itemClass} onSelect={() => void activate({ kind: 'line', line })}>
                  <ListOrderedIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" />
                  <span className="dshx:truncate dshx:text-sm">{`${props.copy.goToLine} ${line}`}</span>
                  {shortcut({ kind: 'line', line })}
                </CommandItem>
              </CommandGroup>
            )}
            {contentRows.length > 0 ? (
              <CommandGroup heading={props.copy.viewContent}>
                {contentRows.map(hit => {
                  const row: PaletteRow = { kind: 'content', ...hit }
                  return (
                    <CommandItem key={hit.thread.id} value={rowValue(row)} className={itemClass} onSelect={() => void activate(row)}>
                      <HashIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" />
                      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                        <span className="dshx:truncate dshx:text-sm dshx:font-medium">{hit.thread.title}</span>
                        <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{hit.snippet}</span>
                      </span>
                      {shortcut(row)}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
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
                    <CommandItem key={path} value={rowValue(row)} className={itemClass} onSelect={() => void activate(row)}>
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
                    <CommandItem key={thread.id} value={rowValue(row)} className={itemClass} onSelect={() => void activate(row)}>
                      <span
                        className={cn(
                          'dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-[11px] dshx:font-semibold',
                          thread.project.length > 0 ? ProjectTone.glyph(project) : 'dshx:bg-muted dshx:text-muted-foreground',
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
            {ask ? props.copy.askSend : props.copy.open}
          </span>
          <span className="dshx:flex dshx:items-center dshx:gap-1.5">
            <Kbd>Esc</Kbd>
            {escapeLabel}
          </span>
          {filesStatus !== null && fileRows.length > 0 ? <span className="dshx:ml-auto dshx:truncate">{filesStatus}</span> : null}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
