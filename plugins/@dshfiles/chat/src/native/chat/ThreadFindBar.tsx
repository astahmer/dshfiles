/**
 * dshfiles (productivity pass T4.1): find in thread. ⌘F in a thread opens it (a second ⌘F while its field has focus
 * goes to the browser); the thread `⋯` menu opens it on a phone. It asks `@dshfiles/session-search` for every match in
 * the whole thread, so Turns the transcript has not paged in are found too; stepping to a match pages its Turn in,
 * opens the fold that hides it and highlights the text. Without the index it searches the loaded rows and says so.
 */
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { keepPreviousData, PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { ThreadFindPort, ThreadFindUnavailable } from '../../thread-find-port.ts'
import { clearFindHighlight, findInLoadedRows, revealFindHit } from './find-reveal.ts'
import { ThreadFindModel, type FindHit, type FindTurnAnchor } from './thread-find-model.ts'
import css from './ThreadFindBar.module.css'

export interface ThreadFindBarProps {
  readonly sessionId: string
  /** Bumped to focus and select the field again (⌘F while the bar is open but not focused). */
  readonly focusRequest: number
  readonly onClose: () => void
  readonly list: () => HTMLElement | null
  /** Every known Turn with its `turn/start` sequence, ascending. */
  readonly anchors: readonly FindTurnAnchor[]
  /** The rendered row of a loaded Turn holding an event sequence; null until the Turn's Nodes are loaded. */
  readonly rowFor: (turn: number, seq: number, type: string | undefined) => string | null
  /** Bring a Turn into the mounted window (paging history in when needed). */
  readonly revealTurn: (turn: number) => void
  /** Last event sequence above the reader, so a new search starts at the nearest match above them. */
  readonly readerSeq: () => number | null
  readonly t: ChatViewSlotProps['t']
}

type Answer =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'hits'; readonly source: 'index' | 'loaded'; readonly hits: readonly FindHit[]; readonly total: number; readonly note: string | null }

const DEBOUNCE_MS = 160

function FindBar({ sessionId, focusRequest, onClose, list, anchors, rowFor, revealTurn, readerSeq, t }: ThreadFindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const debounced = useDebouncedValue({ value: text, delayMs: DEBOUNCE_MS })
  const query = ThreadFindModel.indexQuery(debounced)
  const terms = useMemo(() => ThreadFindModel.terms(debounced), [debounced])
  const search = useQuery({
    queryKey: ['chat', 'thread-find', sessionId, query],
    enabled: query !== null,
    queryFn: ({ signal }) => ThreadFindPort.search({ sessionId, query: query ?? '' }, signal),
    retry: false,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  })
  // The loaded-window fallback reads the DOM, so it runs after commit for the query it answers.
  const [loaded, setLoaded] = useState<{ readonly query: string; readonly hits: readonly FindHit[] } | null>(null)
  const unavailable = search.error instanceof ThreadFindUnavailable && search.error.missing
  const degraded = search.data !== undefined && search.data.state !== 'ready'
  const needsLoaded = query !== null && (unavailable || (degraded && !search.isPlaceholderData))
  useEffect(() => {
    if (!needsLoaded) return
    const root = list()
    const hits = root === null ? [] : findInLoadedRows(root, terms).map(hit => ({ seq: null, nodeKey: hit.nodeKey, occurrence: hit.occurrence, snippet: hit.snippet }))
    setLoaded({ query: debounced, hits })
  }, [needsLoaded, debounced, terms, list])

  const answer = useMemo<Answer>(() => {
    if (query === null) return { kind: 'idle' }
    if (needsLoaded) {
      if (loaded === null || loaded.query !== debounced) return { kind: 'searching' }
      const note = unavailable ? t('chat.find.notInstalled') : t('chat.find.loadedOnly')
      return { kind: 'hits', source: 'loaded', hits: loaded.hits, total: loaded.hits.length, note }
    }
    if (search.isError) return { kind: 'error', message: search.error instanceof Error ? search.error.message : String(search.error) }
    if (search.data === undefined) return { kind: 'searching' }
    return { kind: 'hits', source: 'index', hits: search.data.hits, total: search.data.total, note: null }
  }, [query, needsLoaded, loaded, debounced, unavailable, search.isError, search.error, search.data, t])

  const hits = answer.kind === 'hits' ? answer.hits : null
  const [current, setCurrent] = useState(-1)
  const readerSeqRef = useRef(readerSeq)
  readerSeqRef.current = readerSeq
  // A new answer lands on the match nearest above the reader.
  useLayoutEffect(() => {
    setCurrent(hits === null ? -1 : ThreadFindModel.initialIndex(hits, readerSeqRef.current()))
  }, [hits])

  // Land on the current match: page its Turn in, open what hides it, highlight it.
  const ports = useRef({ anchors, rowFor, revealTurn, list })
  ports.current = { anchors, rowFor, revealTurn, list }
  const hit = hits?.[current]
  useEffect(() => {
    if (hit === undefined) {
      clearFindHighlight()
      return
    }
    const { anchors: known, revealTurn: bring } = ports.current
    const turn = hit.seq === null ? null : ThreadFindModel.turnOf(known, hit.seq)
    const prefer = ThreadFindModel.rowKindOf(hit.type)
    if (turn !== null) bring(turn)
    return revealFindHit(
      {
        list: () => ports.current.list(),
        turn,
        row: () => (hit.seq === null ? (hit.nodeKey ?? null) : turn === null ? null : ports.current.rowFor(turn, hit.seq, hit.type)),
        terms,
        ...(hit.occurrence === undefined ? {} : { occurrence: hit.occurrence }),
        ...(prefer === undefined ? {} : { prefer }),
      },
      () => {},
    )
  }, [hit, terms])
  useEffect(() => () => clearFindHighlight(), [])

  useLayoutEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  const step = (direction: 'older' | 'newer'): void => {
    if (hits === null || hits.length === 0) return
    setCurrent(index => ThreadFindModel.step(index, hits.length, direction))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    step(event.shiftKey ? 'newer' : 'older')
  }

  const count = hits === null ? 0 : hits.length
  const label =
    answer.kind === 'searching'
      ? t('chat.find.searching')
      : answer.kind === 'hits'
        ? count === 0
          ? t('chat.find.none')
          : ThreadFindModel.label(current, count, answer.total)
        : ''
  return (
    <div className={css.bar} data-thread-find="" role="search" aria-label={t('chat.find.label')}>
      <div className={css.row}>
        <SearchIcon className={css.icon} size={14} strokeWidth={1.5} aria-hidden="true" />
        <input
          ref={inputRef}
          className={css.input}
          type="search"
          value={text}
          placeholder={t('chat.find.placeholder')}
          aria-label={t('chat.find.label')}
          aria-describedby={`${sessionId}-find-status`}
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
          onChange={event => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span id={`${sessionId}-find-status`} className={css.count} data-thread-find-count="" aria-live="polite">
          {label}
        </span>
        <button type="button" className={css.button} aria-label={t('chat.find.older')} disabled={count === 0} onClick={() => step('older')}>
          <ChevronUpIcon size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button type="button" className={css.button} aria-label={t('chat.find.newer')} disabled={count === 0} onClick={() => step('newer')}>
          <ChevronDownIcon size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button type="button" className={css.button} aria-label={t('chat.find.close')} onClick={onClose}>
          <XIcon size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      {answer.kind === 'error' && (
        <div className={css.status} role="alert" data-tone="danger">
          <span className={css.statusText}>{t('chat.find.failed', { message: answer.message })}</span>
          <button type="button" className={css.retry} onClick={() => void search.refetch()}>
            {t('chat.find.retry')}
          </button>
        </div>
      )}
      {answer.kind === 'hits' && answer.note !== null && (
        <div className={css.status} role="status">
          <span className={css.statusText}>{answer.note}</span>
          {!unavailable && (
            <button type="button" className={css.retry} onClick={() => void search.refetch()}>
              {t('chat.find.retry')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** The find bar with its own query client; it mounts only while open, so a closed bar costs nothing. */
export function ThreadFindBar(props: ThreadFindBarProps) {
  return (
    <div className={css.slot}>
      <PluginQueryProvider>
        <FindBar {...props} />
      </PluginQueryProvider>
    </div>
  )
}
