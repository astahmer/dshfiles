import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { sessionSearchApi } from '@dshfiles/session-search/search-api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { ChevronDownIcon, ChevronUpIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { ChatFocusModel } from './chat-focus.ts'
import { CHAT_FOCUS_ATTRIBUTE } from './chat-focus-reveal.ts'
import { TranscriptFind } from './transcript-find.ts'

/** Matches one find asks for: enough to step through a long thread, bounded so the bar stays cheap. */
const FIND_LIMIT = 500
/** How long the mark waits for the jump to land before it marks whatever rows of the Turn are mounted. */
const MARK_WAIT_MS = 4_000

interface TranscriptFindBarProps {
  readonly sessionId: string
  readonly listRef: RefObject<HTMLDivElement>
  readonly turnStarts: readonly { readonly turn: number; readonly seq: number }[]
  /** Bumped by every `Find in thread` request, so a second press selects the text again. */
  readonly focusRequest: number
  readonly onClose: () => void
}

export const TranscriptFindBar = (props: TranscriptFindBarProps) => (
  <PluginQueryProvider>
    <FindBar {...props} />
  </PluginQueryProvider>
)

/** The page's highlight registry, absent in a browser without the CSS Custom Highlight API. */
const highlightRegistry = (): HighlightRegistry | undefined => ('CSS' in globalThis && 'highlights' in CSS && 'Highlight' in globalThis ? CSS.highlights : undefined)

const clearMarks = (): void => {
  highlightRegistry()?.delete(TranscriptFind.highlightName)
}

/** Mark the words in the Turn's mounted rows once the jump landed, and bring the first one into view. */
const markTurn = (input: { readonly list: HTMLElement; readonly turn: number; readonly words: readonly string[] }): (() => void) => {
  const registry = highlightRegistry()
  if (registry === undefined) return () => {}
  const deadline = performance.now() + MARK_WAIT_MS
  let frame = 0
  const tick = (): void => {
    const rows = [...input.list.querySelectorAll(`[data-chat-turn="${String(input.turn)}"]`)]
    const landed = rows.some(row => row.hasAttribute(CHAT_FOCUS_ATTRIBUTE) || row.querySelector(`[${CHAT_FOCUS_ATTRIBUTE}]`) !== null)
    if (!landed && performance.now() < deadline) {
      frame = requestAnimationFrame(tick)
      return
    }
    const ranges = TranscriptFind.wordRanges(rows, input.words)
    registry.set(TranscriptFind.highlightName, new Highlight(...ranges))
    ranges[0]?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
  }
  frame = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frame)
}

const FindBar = ({ sessionId, listRef, turnStarts, focusRequest, onClose }: TranscriptFindBarProps) => {
  const api = useApi(sessionSearchApi)
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const query = useDebouncedValue({ value: text.trim(), delayMs: 200 })
  const [current, setCurrent] = useState<number | null>(null)
  const found = useQuery({
    queryKey: ['chat', 'find-in-thread', sessionId, query],
    queryFn: ({ signal }) => api.findInThread({ sessionId, text: query, limit: FIND_LIMIT }, { signal }),
    enabled: query.length > 0,
    retry: false,
    staleTime: 0,
  })
  const matches = found.data?.matches ?? []
  // The newest match is nearest to where a reader of the thread already is.
  const index = current === null ? matches.length - 1 : Math.min(current, matches.length - 1)
  const match = index >= 0 ? matches[index] : undefined
  const turn = match === undefined ? undefined : TranscriptFind.turnOf(turnStarts, match.seq)
  const words = useMemo(() => TranscriptFind.findWords(query), [query])

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusRequest])
  useEffect(() => {
    setCurrent(null)
  }, [found.data])
  useEffect(() => clearMarks, [])
  useEffect(() => {
    clearMarks()
    const list = listRef.current
    if (turn === undefined || list === null) return
    ChatFocusModel.request({ sessionId, focus: { turn } })
    return markTurn({ list, turn, words })
  }, [sessionId, listRef, turn, match, words])

  const move = (direction: 1 | -1): void => {
    if (matches.length === 0) return
    setCurrent(TranscriptFind.step({ index: Math.max(index, 0), count: matches.length, direction }))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    move(event.shiftKey ? -1 : 1)
  }

  const missing = found.isError && isApiOwnerMissing(found.error)
  const notServed = found.data?.ownsService === false
  const count =
    query.length === 0 || found.data === undefined
      ? ''
      : matches.length === 0
        ? '0/0'
        : `${String(index + 1)}/${String(matches.length)}${found.data.hasMore ? '+' : ''}`

  return (
    <div
      role="search"
      aria-label="Find in thread"
      data-chat-find=""
      className="dshx-root dshx:sticky dshx:top-2 dshx:z-20 dshx:mr-4 dshx:-mb-2 dshx:flex dshx:w-96 dshx:max-w-[calc(100%-2rem)] dshx:flex-col dshx:gap-1 dshx:self-end dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:p-1.5 dshx:shadow-md"
    >
      <div className="dshx:flex dshx:items-center dshx:gap-1">
        <SearchInput
          ref={input}
          className="dshx:h-8 dshx:min-w-0 dshx:flex-1"
          value={text}
          placeholder="Find in thread"
          aria-label="Find in thread"
          onChange={event => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span
          aria-live="polite"
          data-chat-find-count=""
          className="dshx:min-w-10 dshx:shrink-0 dshx:text-right dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground"
        >
          {found.isFetching && matches.length === 0 ? '…' : count}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Previous match" disabled={matches.length === 0} onClick={() => move(-1)}>
          <ChevronUpIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next match" disabled={matches.length === 0} onClick={() => move(1)}>
          <ChevronDownIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close find" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      {match !== undefined && (
        <p data-chat-find-snippet="" className="dshx:m-0 dshx:line-clamp-2 dshx:px-1 dshx:text-xs dshx:text-muted-foreground">
          <span className="dshx:font-medium dshx:text-foreground">{TranscriptFind.matchLabel(match.type)}</span> {match.snippet}
        </p>
      )}
      {missing && (
        <p role="alert" className="dshx:m-0 dshx:px-1 dshx:text-xs dshx:text-destructive">
          Find needs the @dshfiles/session-search plugin: add it to the profile, then restart DSH.
        </p>
      )}
      {notServed && (
        <p role="alert" className="dshx:m-0 dshx:px-1 dshx:text-xs dshx:text-destructive">
          Another search backend owns this profile: disable the stock session-query row as the session-search README says, then restart DSH.
        </p>
      )}
      {found.isError && !missing && (
        <p role="alert" className="dshx:m-0 dshx:px-1 dshx:text-xs dshx:text-destructive">
          Find failed. Edit the text to try again.
        </p>
      )}
    </div>
  )
}
