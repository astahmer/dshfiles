import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@dshfiles/plugin-ui/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@dshfiles/plugin-ui/components/ui/tabs'
import { matchesPhoneShell } from '@dshfiles/plugin-ui/lib/phone-shell'
import { Kbd, KbdGroup, KeyHint } from '@dshfiles/plugin-ui/components/ui/kbd'
import { AttentionMeta } from '@dshfiles/plugin-ui/components/ui/attention-meta'
import type { ProjectMarkProps } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { LEADING_GLYPH_ATTRIBUTE } from '@dshfiles/plugin-ui/components/selection'
import { ArrowLeftIcon, CheckIcon, CommandIcon, FileIcon, FileSearchIcon, HashIcon, ListOrderedIcon, MessageSquareIcon } from '@dshfiles/plugin-ui/icons'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from 'react'
import { useContentSearch, type ContentSearch } from './content-search-machine.js'
import { PaletteFrecency, paletteFrecency } from './frecency.js'
import { paletteNavigationMachine } from './palette-navigation-machine.js'
import { useWorkspaceFiles } from './workspace-files-machine.js'
import { PaletteRules, type PalettePrefix, type ThreadCandidate } from './palette.js'
import { PaletteApi } from './palette-api.js'
import type { PaletteAction, PaletteActionContext, PaletteMode, PaletteProjectColor, PaletteThreadStatus } from './palette-contract.js'
import { paletteActionMachine } from './palette-action-machine.js'
import { recentTime } from './recent-time.js'

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
  readonly working: string
  readonly idle: string

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
  readonly contentStatusRunning: string
  readonly contentStatusFinished: string
  readonly contentStatusLive: string
  readonly contentStatusSaved: string
  readonly actionFailed: string
  /** Ask DSH: the entry point shown on an empty palette, its input, and its result row. */
  readonly ask: string
  readonly askPlaceholder: string
  readonly askHint: string
  readonly askEmpty: string
  readonly askPending: string
  readonly askSend: string
  readonly askExit: string
  /** The phone's way out of the full-screen search, at the trailing edge of its first row. */
  readonly cancel: string
  readonly askFailed: string
}

type PaletteActionOption = Omit<PaletteAction, 'label' | 'heading'> & { readonly label: string; readonly heading?: string }

interface ThreadPaletteProps {
  readonly mode: PaletteMode
  readonly threads: readonly ThreadCandidate[]
  /** The current project's threads; when set, the Threads tab lists only these, while a session ID still finds any thread. */
  readonly projectThreads?: readonly ThreadCandidate[]
  /** The colour the thread list gives a thread's project; without it, project marks stay neutral. */
  readonly projectColorOf?: (thread: ThreadCandidate) => PaletteProjectColor | undefined
  /** The thread list's status of a thread (glyph and word); without it a row says Working or Idle from its own turn. */
  readonly threadStatusOf?: (thread: ThreadCandidate) => PaletteThreadStatus | undefined
  readonly context: PaletteActionContext
  readonly additionalActions: readonly PaletteAction[]
  readonly recentLimit: number
  readonly mac: boolean
  /** The keycaps the Host shortcut registry presents for one of its command ids, for rows that name a `shortcutId`. */
  readonly hostKeys?: (shortcutId: string) => readonly string[] | undefined
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
  | {
      readonly kind: 'content'
      readonly thread: ThreadCandidate
      readonly snippet: string
      readonly live?: boolean | undefined
      readonly persisted?: boolean | undefined
    }
  | { readonly kind: 'line'; readonly line: number }
  | { readonly kind: 'help'; readonly prefix: PalettePrefix | ''; readonly label: string }
  | { readonly kind: 'ask'; readonly question: string }
  | { readonly kind: 'backlog'; readonly text: string }

const RESULT_LIMIT = 50
const COMMAND_LIMIT = 30
const FRECENT_COMMANDS_ON_EMPTY = 5
const GO_TO_FILE_ID = 'action:go-to-file'

const withoutRepeatedTitle = (snippet: string, title: string): string => {
  const trimmed = snippet.trim()
  const normalizedTitle = title.trim().toLocaleLowerCase()
  const normalizedSnippet = trimmed.toLocaleLowerCase()
  if (normalizedTitle.length === 0 || !normalizedSnippet.startsWith(normalizedTitle)) return trimmed
  const next = trimmed[title.trim().length] ?? ''
  if (next.length > 0 && !/[\s—–:-]/u.test(next)) return trimmed
  return trimmed
    .slice(title.trim().length)
    .replace(/^[\s—–:-]+/u, '')
    .trim()
}

const neutralMark = 'dshx:bg-muted dshx:text-muted-foreground'

type ProjectMarkPaint = Pick<ProjectMarkProps, 'tone' | 'color' | 'palette' | 'className' | 'style'>

/**
 * The project mark on a thread row's meta line (round five T6, council round 16 B1): the thread list's `ProjectMark`, in the tone or colour the list gives
 * the project. A custom pick rides as --chip and is clamped per scheme (L <= 0.52 in light, L >= 0.78 in dark), so a
 * pale or dark pick still reads. Without a colour source the tile stays neutral ink.
 */
const projectMarkPaint = (color: PaletteProjectColor | undefined): ProjectMarkPaint => {
  if (color === undefined || (color.tone === undefined && color.color === undefined)) return { color: 'currentColor', className: neutralMark }
  if (color.color === undefined) return { tone: color.tone, palette: color.palette }
  const style: CSSProperties & Readonly<Record<'--chip' | '--chip-light' | '--chip-dark', string>> = {
    '--chip': color.color,
    '--chip-light': 'oklch(from var(--chip) min(l, 0.52) c h)',
    '--chip-dark': 'oklch(from var(--chip) max(l, 0.78) c h)',
  }
  return { color: 'var(--chip-clamped)', className: 'dshx:[--chip-clamped:var(--chip-light)] dshx:dark:[--chip-clamped:var(--chip-dark)]', style }
}

const projectLabel = (project: string): string => project.split(/[\\/]/u).filter(Boolean).at(-1) ?? project

const contentStatusLabel = (input: {
  readonly running: boolean | undefined
  readonly live: boolean | undefined
  readonly persisted: boolean | undefined
  readonly copy: ThreadPaletteCopy
}): string | undefined => {
  if (input.running === true) return input.copy.contentStatusRunning
  if (input.running === false) return input.copy.contentStatusFinished
  if (input.live === true) return input.copy.contentStatusLive
  if (input.persisted === true) return input.copy.contentStatusSaved
  return undefined
}

const contentDate = (timestamp: number | undefined): string | undefined =>
  timestamp === undefined || !Number.isFinite(timestamp) ? undefined : new Date(timestamp).toISOString().slice(0, 10)

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

/**
 * The visible part of the screen while the palette is open, as `--palette-height` and `--palette-top`: with the
 * software keyboard up the visual viewport is what is left above it, so the phone palette's results end at the
 * keyboard instead of under it. Desktop rules ignore both variables.
 */
const usePaletteViewport = (): CSSProperties | undefined => {
  const [box, setBox] = useState<{ readonly height: number; readonly top: number } | null>(null)
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
    if (viewport === undefined || viewport === null) return undefined
    const update = (): void => setBox({ height: Math.round(viewport.height), top: Math.round(viewport.offsetTop) })
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])
  return useMemo(
    // SAFETY: both keys are CSS custom properties, which React passes through as style; CSSProperties has no `--*` names.
    () => (box === null ? undefined : ({ '--palette-height': `${String(box.height)}px`, '--palette-top': `${String(box.top)}px` } as CSSProperties)),
    [box],
  )
}

export const ThreadPalette = (props: ThreadPaletteProps): JSX.Element => {
  const phoneViewport = usePaletteViewport()
  const [navigationSnapshot, sendNavigation, navigationActor] = useMachine(paletteNavigationMachine, { input: { mode: props.mode } })
  const { mode, query, backStack, notice, selected, ask } = navigationSnapshot.context
  const parsed = PaletteRules.parsePaletteQuery(query)
  // In Ask DSH the whole query is the question: prefixes are ordinary text there.
  const searchText = ask ? query : parsed.text
  const view: PaletteView = ask ? 'ask' : parsed.prefix === null ? mode : VIEW_BY_PREFIX[parsed.prefix]
  const deferredQuery = useDeferredValue(searchText)
  const subview = !ask && (backStack.length > 0 || parsed.prefix !== null)
  useEffect(() => sendNavigation({ type: 'mode.sync', mode: props.mode }), [props.mode, sendNavigation])
  const emptyQuery = deferredQuery.trim().length === 0
  const latestOnClose = useRef(props.onClose)
  latestOnClose.current = props.onClose
  useEffect(() => {
    const subscription = navigationActor.on('close', () => latestOnClose.current())
    return () => subscription.unsubscribe()
  }, [navigationActor])
  // Read once per visit: the phone shell does not change while the palette is open.
  const [phoneShell] = useState(() => matchesPhoneShell())
  // Closing returns focus to what was focused when the palette opened (a list row, the composer), never to the page body.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  useEffect(
    () => () => {
      if (!(opener instanceof HTMLElement)) return
      // After the dialog's own focus scope lets go, which happens in the same unmount.
      requestAnimationFrame(() => {
        if (opener.isConnected && (document.activeElement === null || document.activeElement === document.body)) opener.focus({ preventScroll: true })
      })
    },
    [opener],
  )
  // Ranking happens within one palette visit, so the instant it opened is the whole clock the memo needs.
  const [openedAt] = useState(() => Date.now())
  const latestOnAsk = useRef(props.onAsk)
  latestOnAsk.current = props.onAsk
  const [actionSnapshot, sendAction, actionActor] = useMachine(paletteActionMachine, {
    input: { ask: question => latestOnAsk.current(question) },
  })
  useEffect(() => {
    const completed = actionActor.on('completed', () => latestOnClose.current())
    const askFailed = actionActor.on('askFailed', () => sendNavigation({ type: 'notice.show', message: props.copy.askFailed }))
    return () => {
      completed.unsubscribe()
      askFailed.unsubscribe()
    }
  }, [actionActor, props.copy.askFailed, sendNavigation])
  const submitAsk = (question: string): void => {
    const trimmed = question.trim()
    if (trimmed.length === 0) return
    sendAction({ type: 'ask', question: trimmed })
  }
  const runningAction = actionSnapshot.matches('running')
  const askPending = actionSnapshot.matches('asking')
  const frecency = paletteFrecency.useValue()
  const boosts = useMemo(() => PaletteFrecency.boosts(frecency, openedAt), [frecency, openedAt])
  const registeredActions = useSyncExternalStore(PaletteApi.subscribe, PaletteApi.getSnapshot, PaletteApi.getSnapshot).actions
  const actionOptions = useMemo<PaletteActionOption[]>(() => {
    // Several bundles register the same command ("New thread" comes from this palette, the sidebar header and the
    // Host shortcut catalog); list it once, keeping an action or destination over its bare shortcut-command twin.
    const registeredLabels = new Set<string>()
    const textOf = (value: string | (() => string)): string => (typeof value === 'function' ? value() : value)
    // Thread rows act on one thread and carry their own heading; they never stand in for a same-named command.
    const threadActions = registeredActions.flatMap(action =>
      action.group !== 'thread' || action.isAvailable?.(props.context) === false
        ? []
        : [
            action.heading === undefined
              ? { ...action, label: textOf(action.label) }
              : { ...action, label: textOf(action.label), heading: textOf(action.heading) },
          ],
    )
    const byKind = [
      ...registeredActions.filter(action => action.group !== 'command' && action.group !== 'thread'),
      ...registeredActions.filter(action => action.group === 'command'),
    ]
    const registered = byKind.flatMap(action => {
      if (action.isAvailable?.(props.context) === false) return []
      const label = typeof action.label === 'function' ? action.label() : action.label
      const key = SAME_COMMAND_AS.get(action.id) ?? label.trim().toLowerCase()
      if (registeredLabels.has(key)) return []
      registeredLabels.add(key)
      const { heading: _heading, ...rest } = action
      return [{ ...rest, label }]
    })
    const additional = props.additionalActions.flatMap(action => {
      if (action.isAvailable?.(props.context) === false) return []
      const { heading: _heading, ...rest } = action
      return [{ ...rest, label: textOf(action.label) }]
    })
    return [...threadActions, ...registered, ...additional]
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
  const rankedThreads = useMemo(
    () =>
      view === 'all' || view === 'threads'
        ? PaletteRules.rankThreadsScored({
            index: rankedThreadIndex,
            query: threadSearch.query,
            limit: threadSearch.query.length === 0 ? props.recentLimit : RESULT_LIMIT,
          })
        : { rows: [], best: -Infinity },
    [props.recentLimit, rankedThreadIndex, threadSearch.query, view],
  )
  const threadRows = rankedThreads.rows
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
      return thread === undefined ? [] : [{ thread, snippet: hit.snippet, live: hit.live, persisted: hit.persisted }]
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
  // The thread the user is on comes first: its own verbs, under "Actions for …" (plan Q2 T2.4).
  const rankedThreadActions = useMemo(
    () =>
      view === 'all' || view === 'commands'
        ? PaletteRules.rankActionsScored({ actions: actionOptions.filter(action => action.group === 'thread'), query: deferredQuery, boost: () => 0 })
        : { rows: [], best: -Infinity },
    [actionOptions, deferredQuery, view],
  )
  const threadActionRows = rankedThreadActions.rows
  const threadActionHeading = threadActionRows.find(action => action.heading !== undefined)?.heading
  const rankedDestinations = useMemo(
    () =>
      view === 'all' || view === 'commands'
        ? PaletteRules.rankActionsScored({
            actions: [goToFile, ...actionOptions.filter(action => action.group !== 'command' && action.group !== 'thread')],
            query: deferredQuery,
            boost: id => boosts.get(id) ?? 0,
          })
        : { rows: [], best: -Infinity },
    [actionOptions, boosts, deferredQuery, goToFile, view],
  )
  const destinationRows = rankedDestinations.rows
  const rankedCommands = useMemo(() => {
    if (view !== 'all' && view !== 'commands') return { rows: [], best: -Infinity }
    const commands = actionOptions.filter(action => action.group === 'command')
    const ranked =
      view === 'commands' || deferredQuery.trim().length > 0
        ? PaletteRules.rankActionsScored({ actions: commands, query: deferredQuery, boost: id => boosts.get(id) ?? 0 })
        : PaletteRules.rankActionsScored({
            actions: commands.filter(command => boosts.has(command.id) || command.suggested === true),
            query: '',
            boost: id => boosts.get(id) ?? 0,
          })
    const limit = view === 'commands' ? RESULT_LIMIT : deferredQuery.trim().length > 0 ? COMMAND_LIMIT : FRECENT_COMMANDS_ON_EMPTY
    return { rows: ranked.rows.slice(0, limit), best: ranked.best }
  }, [actionOptions, boosts, deferredQuery, view])
  const commandRows = rankedCommands.rows
  // Groups go by their best match (F7): "fake" ranked Settings › Projects above three threads whose titles say fake. An
  // empty search leads with recent threads (F26); the verbs of the thread the user is on follow them.
  const threadsFirst =
    threadRows.length > 0 && (emptyQuery || rankedThreads.best >= Math.max(rankedThreadActions.best, rankedDestinations.best, rankedCommands.best))

  const rows: PaletteRow[] = useMemo(
    () => [
      ...askRows,
      ...backlogRows,
      ...helpRows.map((help): PaletteRow => ({ kind: 'help', ...help })),
      ...(line === null ? [] : [{ kind: 'line', line } satisfies PaletteRow]),
      ...contentRows.map((hit): PaletteRow => ({ kind: 'content', ...hit })),
      ...(threadsFirst ? threadRows.map((thread): PaletteRow => ({ kind: 'thread', thread })) : []),
      ...threadActionRows.map((destination): PaletteRow => ({ kind: 'destination', destination })),
      ...destinationRows.map((destination): PaletteRow => ({ kind: 'destination', destination })),
      ...commandRows.map((destination): PaletteRow => ({ kind: 'destination', destination })),
      ...fileRows.map((path): PaletteRow => ({ kind: 'file', path })),
      ...(threadsFirst ? [] : threadRows.map((thread): PaletteRow => ({ kind: 'thread', thread }))),
    ],
    [askRows, backlogRows, commandRows, contentRows, destinationRows, fileRows, helpRows, line, threadActionRows, threadRows, threadsFirst],
  )
  const numbered = rows.slice(0, 9)
  // Until the pointer or arrows pick a row, the first match is active, so Enter runs it right after typing.
  const activeValue = rows.some(row => rowValue(row) === selected) ? selected : rows[0] === undefined ? '' : rowValue(rows[0])

  const activate = (row: PaletteRow): void => {
    if (row.kind === 'ask') {
      // Enter can land before the deferred row catches up with the last keystroke; the live query wins.
      submitAsk(query)
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
    // A Host-registry row shows the binding the user has now, already presented by the Host (⌘ ⇧ P).
    const hostCaps =
      row.kind === 'destination' && keys.length === 0 && row.destination.shortcutId !== undefined ? (props.hostKeys?.(row.destination.shortcutId) ?? []) : []
    const hasHint = index >= 0 || keys.length > 0 || hostCaps.length > 0
    // The hint seat (council round 12 B2): the active row shows an ink ↵ in place of its own hint, so the selection
    // reads on rows that start with a glyph. Both share one grid cell, so the seat keeps the wider one's width; opacity, not
    // visibility, keeps the row's own binding in its accessible name while it steps aside.
    return (
      <span className="dshx:ml-auto dshx:grid dshx:shrink-0 dshx:items-center dshx:justify-items-end">
        {hasHint ? (
          <span
            data-palette-hint=""
            className="dshx:col-start-1 dshx:row-start-1 dshx:flex dshx:items-center dshx:gap-2 dshx:group-data-[selected=true]/item:opacity-0"
          >
            {/* The kit's one shortcut chip at full strength (council round 10 A5, B4): a 70% chip fell under AA. */}
            {keys.length > 0 ? <KeyHint keys={keys} mac={props.mac} /> : null}
            {hostCaps.length > 0 ? (
              <KbdGroup>
                {hostCaps.map(cap => (
                  <Kbd key={cap}>{cap}</Kbd>
                ))}
              </KbdGroup>
            ) : null}
            {index < 0 ? null : (
              // One keycap, under the pointer only (round five B6): a column of ⌘ 1…⌘ 8 on every row read as noise. It
              // keeps its width while hidden, so nothing moves when it shows.
              <Kbd
                data-palette-number=""
                className="dshx:opacity-0 dshx:transition-opacity dshx:duration-(--dshx-duration-hover) dshx:group-hover/item:opacity-100 dshx:group-data-[selected=true]/item:opacity-100"
              >
                {`${props.mac ? '⌘' : 'Ctrl+'}${String(index + 1)}`}
              </Kbd>
            )}
          </span>
        ) : null}
        <Kbd
          data-palette-enter=""
          aria-hidden="true"
          className="dshx:col-start-1 dshx:row-start-1 dshx:text-foreground dshx:opacity-0 dshx:group-data-[selected=true]/item:opacity-100"
        >
          ↵
        </Kbd>
      </span>
    )
  }

  // Two-line rows at 56px (council round 4 A5/B7): the title, then its meta line, with room above and below. The active
  // row takes the kit selected edge beside its wash and ↵ (council round 13 B1): the dark wash alone read 1.1:1.
  const itemClass = 'dshx:group/item dshx:min-h-14 dshx:gap-3 dshx:rounded-md dshx:px-2.5 dshx:py-2 dshx:data-[selected=true]:selected-edge'
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
  const askStatus = ask ? (askPending ? props.copy.askPending : props.copy.askHint) : null

  const destinationItem = (destination: PaletteActionOption): JSX.Element => {
    const row: PaletteRow = { kind: 'destination', destination }
    return (
      <CommandItem key={destination.id} value={rowValue(row)} className={itemClass} disabled={runningAction} onSelect={() => void activate(row)}>
        <span className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground" aria-hidden="true" {...LEADING_GLYPH_ATTRIBUTE}>
          {destination.icon ?? <CommandIcon className="dshx:size-4" />}
        </span>
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm">{destination.label}</span>
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

  const hasActionRows = threadActionRows.length > 0 || destinationRows.length > 0 || commandRows.length > 0
  const threadGroup =
    threadRows.length === 0 ? null : (
      <>
        {!threadsFirst && (destinationRows.length > 0 || commandRows.length > 0) ? <CommandSeparator className="dshx:my-1" /> : null}
        <CommandGroup heading={emptyQuery ? props.copy.recent : props.copy.threads}>
          {threadRows.map(thread => {
            const row: PaletteRow = { kind: 'thread', thread }
            // The list's status, rolled up: a thread that waits for an answer is Needs you here too, not Working.
            const listed = props.threadStatusOf?.(thread)
            // One row grammar, the thread list's (council round 16 B1): the rail is the status glyph on every row, and
            // line 2 is the kit's AttentionMeta, `[mark] project · word · age`, the word from the one list (Working,
            // Ready, Idle, Approval, Question, Turn failed). No status tail, no project tile in the rail. Without a status
            // provider the thread's own running fact picks Working or Idle.
            const status = listed?.status ?? (thread.running === true ? 'working' : 'idle')
            const word = listed === undefined ? (thread.running === true ? props.copy.working : props.copy.idle) : (listed.kind ?? listed.label)
            const age = thread.updatedAt > 0 ? recentTime(thread.updatedAt) : undefined
            return (
              <CommandItem key={thread.id} value={rowValue(row)} className={itemClass} onSelect={() => void activate(row)}>
                {/* The palette's 28px leading column keeps every row's title on one edge; inside it the glyph sits in the
                    kit's 20px rail seat, the thread list's. */}
                <span className="dshx:flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center" aria-hidden="true" {...LEADING_GLYPH_ATTRIBUTE}>
                  <span className="dshx:inline-flex dshx:w-[var(--attention-meta-rail-seat,20px)] dshx:justify-center" data-palette-status-seat="">
                    {/* The row's own rule greys every icon without a text colour; the glyph keeps its status hue. */}
                    <StatusGlyph status={status} decorative className="dshx:[&_svg]:text-current!" />
                  </span>
                </span>
                <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                  <span className="dshx:truncate dshx:text-sm dshx:font-medium">{thread.title}</span>
                  <AttentionMeta
                    project={thread.project.length > 0 ? thread.project : undefined}
                    kind={word}
                    age={age}
                    mark={thread.project.length > 0 ? { ...projectMarkPaint(props.projectColorOf?.(thread)), 'data-palette-project-mark': '' } : undefined}
                  />
                </span>
                {shortcut(row)}
              </CommandItem>
            )
          })}
        </CommandGroup>
        {threadsFirst && hasActionRows ? <CommandSeparator className="dshx:my-1" /> : null}
      </>
    )
  return (
    <Dialog open onOpenChange={(open: boolean) => (open ? undefined : props.onClose())}>
      <DialogContent
        className={cn(
          // A 16px outer inset (council round 3 B5): the kit dialog's 24px read as a loose frame around the search. Important,
          // to beat the kit's own sm: padding without a viewport variant here; the full-screen phone search keeps none.
          // 640px wide (council round 10 B4): the rows and the footer read as one column, not a 672px sheet.
          'dshx-root dshx:gap-0 dshx:overflow-hidden dshx:p-4! dshx:phone:p-0! dshx:sm:max-w-160',
          // One frame: the kit dialog's floating surface (council round 3 B5, kit A8), so in dark the palette is a raised
          // warm card with a faint edge and one deep shadow, not the brightest box on screen.
          // A phone gets a full-screen search: the input at the top, results down to the software keyboard (the visual
          // viewport, published below), no centred card.
          'dshx:phone:top-[var(--palette-top,0px)] dshx:phone:left-0 dshx:phone:translate-x-0 dshx:phone:translate-y-0 dshx:phone:w-full dshx:phone:max-w-none! dshx:phone:h-[var(--palette-height,100dvh)] dshx:phone:max-h-none dshx:phone:flex dshx:phone:flex-col dshx:phone:rounded-none dshx:phone:border-0 dshx:phone:pt-[env(safe-area-inset-top,0px)] dshx:phone:shadow-none',
        )}
        style={phoneViewport}
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
          className="dshx:rounded-none dshx:phone:min-h-0 dshx:phone:flex-1"
        >
          {/* The dialog is the field's one frame: no second ring around the search row inside it (round five B6). A 48px
              search lane with no rule of its own: the one rule sits under the filters, above the results (council round 4
              B7). */}
          <div className="dshx:relative dshx:[&_[data-slot=command-input-wrapper]]:h-12! dshx:[&_[data-slot=command-input-wrapper]]:border-b-0! dshx:[&_[data-slot=command-input-wrapper]]:outline-none!">
            <CommandInput
              autoFocus
              aria-label={props.copy.searchLabel}
              // The query reads at the kit's 16px query step (council round 3 B5, round 4 B7), the size of what you type,
              // above 14px results.
              className={cn('dshx:h-12 dshx:text-query dshx:text-ellipsis dshx:phone:pr-20', showAskEntry && 'dshx:pr-24 dshx:pointer-coarse:pr-16 dshx:phone:pr-20')}
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
                className="dshx:absolute dshx:right-2 dshx:top-1/2 dshx:flex dshx:-translate-y-1/2 dshx:items-center dshx:gap-2 dshx:rounded dshx:px-1.5 dshx:py-0.5 dshx:text-xs dshx:text-muted-foreground dshx:hover:text-foreground dshx:phone:hidden"
              >
                <span>{props.copy.ask}</span>
                <KbdGroup className="dshx:pointer-coarse:hidden">
                  <Kbd>Tab</Kbd>
                </KbdGroup>
              </button>
            ) : null}
            {/* A full-screen surface on a phone has a visible way out in its first row (DESIGN.md Density). */}
            <Button
              type="button"
              variant="ghost"
              className="dshx:absolute dshx:right-1 dshx:top-0.5 dshx:hidden dshx:h-11 dshx:min-w-11 dshx:px-3 dshx:phone:inline-flex"
              data-palette-cancel=""
              onClick={() => props.onClose()}
            >
              {props.copy.cancel}
            </Button>
          </div>
          {/* The filters at 13px, and under them the palette's one rule before the results (council round 4 B7). */}
          <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:px-3 dshx:pt-0.5 dshx:pb-1.5 dshx:text-xs dshx:text-muted-foreground dshx:phone:flex-wrap dshx:[&_[role=tab]]:text-sm">
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
            {notice === null && !ask && !actionSnapshot.matches('failed') ? (
              // One "? Prefixes" hint instead of a legend the row clipped (round five T6): it opens the prefix list. It is
              // for a keyboard: the phone keeps this row for a notice or Ask DSH's status only.
              <button
                type="button"
                data-palette-prefix-hint=""
                onMouseDown={event => event.preventDefault()}
                onClick={() => sendNavigation({ type: 'query.change', query: '?' })}
                className="dshx:ml-auto dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded dshx:px-1.5 dshx:py-0.5 dshx:hover:text-foreground dshx:phone:hidden"
              >
                <Kbd>?</Kbd>
                <span>{props.copy.prefixHint}</span>
              </button>
            ) : (
              <span className="dshx:truncate dshx:phone:basis-full dshx:phone:whitespace-normal">
                {notice ?? (actionSnapshot.matches('failed') && !ask ? props.copy.actionFailed : askStatus)}
              </span>
            )}
          </div>
          <CommandList className="dshx:max-h-[min(60vh,440px)] dshx:p-1 dshx:phone:max-h-none dshx:phone:min-h-0 dshx:phone:flex-1">
            <CommandEmpty className="dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">
              {ask && emptyQuery
                ? props.copy.askEmpty
                : missingSessionId && threadSearch.exactId !== undefined
                  ? props.copy.sessionNotFound.replace('{id}', threadSearch.exactId)
                  : (filesStatus ?? contentStatus ?? (view === 'line' ? props.copy.linePlaceholder : props.copy.empty))}
            </CommandEmpty>
            {showAskEntry && phoneShell ? (
              // On the phone the search row's trailing edge is Cancel, so Ask DSH leads the results instead.
              <CommandGroup>
                <CommandItem value="ask-dsh-entry" className={itemClass} onSelect={() => sendNavigation({ type: 'ask.enter' })}>
                  <span className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground" aria-hidden="true" {...LEADING_GLYPH_ATTRIBUTE}>
                    <MessageSquareIcon className="dshx:size-4" />
                  </span>
                  <span className="dshx:truncate dshx:text-sm">{props.copy.ask}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {backlogRows.length > 0 ? (
              <CommandGroup heading={props.copy.backlog}>
                {backlogRows.map(row => (
                  <CommandItem key={rowValue(row)} value={rowValue(row)} className={itemClass} onSelect={() => void activate(row)}>
                    <HashIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" {...LEADING_GLYPH_ATTRIBUTE} />
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
                      {...LEADING_GLYPH_ATTRIBUTE}
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
                      {/* A prefix is typed, on a phone keyboard too: a chip, not a keycap (the kit hides keycaps on touch). */}
                      <span
                        className="dshx:inline-flex dshx:h-5 dshx:min-w-7 dshx:items-center dshx:justify-center dshx:rounded-sm dshx:bg-muted dshx:px-1 dshx:font-mono dshx:text-xs dshx:text-muted-foreground"
                        {...LEADING_GLYPH_ATTRIBUTE}
                      >
                        {help.prefix === '' ? '∅' : help.prefix}
                      </span>
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
                  <ListOrderedIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" {...LEADING_GLYPH_ATTRIBUTE} />
                  <span className="dshx:truncate dshx:text-sm">{`${props.copy.goToLine} ${line}`}</span>
                  {shortcut({ kind: 'line', line })}
                </CommandItem>
              </CommandGroup>
            )}
            {contentRows.length > 0 ? (
              <CommandGroup heading={props.copy.viewContent}>
                {contentRows.map(hit => {
                  const row: PaletteRow = { kind: 'content', ...hit }
                  const snippet = withoutRepeatedTitle(hit.snippet, hit.thread.title)
                  const date = contentDate(hit.thread.updatedAt)
                  const status = contentStatusLabel({ running: hit.thread.running, live: hit.live, persisted: hit.persisted, copy: props.copy })
                  const project = hit.thread.project.length === 0 ? props.copy.unassigned : projectLabel(hit.thread.project)
                  return (
                    <CommandItem key={hit.thread.id} value={rowValue(row)} className={itemClass} onSelect={() => void activate(row)}>
                      <HashIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" {...LEADING_GLYPH_ATTRIBUTE} />
                      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
                        <span className="dshx:truncate dshx:text-sm dshx:font-medium">{hit.thread.title}</span>
                        <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:overflow-hidden dshx:text-xs dshx:text-muted-foreground">
                          <Badge variant="secondary" className="dshx:max-w-32 dshx:truncate">
                            {project}
                          </Badge>
                          {date === undefined ? null : <span className="dshx:shrink-0">{date}</span>}
                          {status === undefined ? null : (
                            <Badge variant="outline" className="dshx:shrink-0">
                              {status}
                            </Badge>
                          )}
                        </span>
                        {snippet.length === 0 ? null : <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{snippet}</span>}
                      </span>
                      {shortcut(row)}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            {threadsFirst ? threadGroup : null}
            {threadActionRows.length > 0 ? (
              <>
                <CommandGroup heading={threadActionHeading ?? props.copy.commands} data-palette-thread-actions="">
                  {threadActionRows.map(destinationItem)}
                </CommandGroup>
                <CommandSeparator className="dshx:my-1" />
              </>
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
                      <FileIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" {...LEADING_GLYPH_ATTRIBUTE} />
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
            {threadsFirst ? null : threadGroup}
          </CommandList>
        </Command>
        <footer
          className={cn(
            'dshx:flex dshx:items-center dshx:gap-4 dshx:border-t dshx:bg-muted/40 dshx:px-3 dshx:py-2 dshx:text-xs dshx:text-muted-foreground',
            // On touch the key legend goes (the kit hides `data-key-legend`); the bar stays only for a files note.
            (filesStatus === null || fileRows.length === 0) && 'dshx:pointer-coarse:hidden',
          )}
        >
          <span data-key-legend="" className="dshx:flex dshx:items-center dshx:gap-1.5">
            <KbdGroup>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </KbdGroup>
            {props.copy.navigate}
          </span>
          <span data-key-legend="" className="dshx:flex dshx:items-center dshx:gap-1.5">
            <Kbd>Enter</Kbd>
            {ask ? props.copy.askSend : props.copy.open}
          </span>
          <span data-key-legend="" className="dshx:flex dshx:items-center dshx:gap-1.5">
            <Kbd>Esc</Kbd>
            {escapeLabel}
          </span>
          {filesStatus !== null && fileRows.length > 0 ? <span className="dshx:ml-auto dshx:truncate">{filesStatus}</span> : null}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
