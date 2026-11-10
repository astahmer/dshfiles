import { defaultRangeExtractor, useVirtualizer, type Range } from '@dshfiles/plugin-ui/virtual'
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from 'react'
import { ThreadListNavigationModel } from './thread-list-navigation.js'

/** Below this many rows a section mounts every row: a short list gains nothing from windowing. */
const VIRTUALIZE_FROM = 40
const OVERSCAN = 8
/** Rows kept mounted on each side of a pinned row, so arrow keys from an off-screen focused row reach its neighbours. */
const PINNED_NEIGHBOURS = 2

interface VirtualThreadRowsProps<Entry> {
  readonly entries: readonly Entry[]
  /** React and measurement key; stays the same while the row moves. */
  readonly keyOf: (entry: Entry) => string
  /** The Session id a row's main button navigates to; undefined for a row keyboard navigation skips (remote). */
  readonly threadIdOf: (entry: Entry) => string | undefined
  readonly render: (entry: Entry) => JSX.Element
  readonly scrollElement: RefObject<HTMLElement | null>
  /** Thread ids that stay mounted off screen: a native drag is cancelled when its source node unmounts. */
  readonly pinnedThreadIds: readonly (string | undefined)[]
  /** Scrolled into view when it changes, for a row no DOM lookup can find while it is not mounted. */
  readonly revealThreadId: string | undefined
  readonly estimateSize: number
  readonly enabled: boolean
}

/**
 * One section's rows. A long section mounts only the rows near the shared scroll viewport; every section measures its
 * own offset inside that viewport, so sticky headers and section order stay plain DOM.
 */
export const VirtualThreadRows = <Entry,>(props: VirtualThreadRowsProps<Entry>): JSX.Element => {
  const listRef = useRef<HTMLDivElement>(null)
  const focusedThreadId = useRef<string | undefined>(undefined)
  const virtual = props.enabled && props.entries.length >= VIRTUALIZE_FROM
  const [scrollMargin, setScrollMargin] = useState(0)
  // The scroll container is an ancestor, so its ref is attached only after this list's first layout effects ran.
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setScrollElement(props.scrollElement.current)
  }, [props.scrollElement])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null) return
    if (!virtual) {
      ThreadListNavigationModel.virtualThreadIds.delete(list)
      return
    }
    ThreadListNavigationModel.virtualThreadIds.set(
      list,
      props.entries.flatMap(entry => props.threadIdOf(entry) ?? []),
    )
  })

  useLayoutEffect(() => {
    const list = listRef.current
    if (!virtual || list === null || scrollElement === null) return
    const measure = (): void => {
      const next = list.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop
      setScrollMargin(current => (Math.abs(current - next) < 1 ? current : next))
    }
    measure()
    if (globalThis.ResizeObserver === undefined) return
    // Anything above this list (another section's rows being measured, a hoisted group appearing) moves its offset.
    const observer = new ResizeObserver(measure)
    for (const child of Array.from(scrollElement.children)) observer.observe(child)
    return () => observer.disconnect()
  })

  const rangeExtractor = (range: Range): number[] => {
    const indexes = defaultRangeExtractor(range)
    const pinned = [...props.pinnedThreadIds, focusedThreadId.current].filter(threadId => threadId !== undefined)
    if (pinned.length === 0) return indexes
    const extra = new Set(indexes)
    props.entries.forEach((entry, index) => {
      const threadId = props.threadIdOf(entry)
      if (threadId === undefined || !pinned.includes(threadId)) return
      for (let near = Math.max(0, index - PINNED_NEIGHBOURS); near <= Math.min(range.count - 1, index + PINNED_NEIGHBOURS); near += 1) extra.add(near)
    })
    return [...extra].sort((left, right) => left - right)
  }

  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: props.entries.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => props.estimateSize,
    getItemKey: index => {
      const entry = props.entries[index]
      return entry === undefined ? index : props.keyOf(entry)
    },
    overscan: OVERSCAN,
    scrollMargin,
    enabled: virtual,
    rangeExtractor,
  })

  // Only a new reveal request scrolls; a re-render with the same target must not pull the list back.
  const revealedThreadId = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (props.revealThreadId === revealedThreadId.current) return
    revealedThreadId.current = props.revealThreadId
    if (!virtual || props.revealThreadId === undefined) return
    const index = props.entries.findIndex(entry => props.threadIdOf(entry) === props.revealThreadId)
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
  })

  const onFocus = (event: FocusEvent<HTMLDivElement>): void => {
    const row = event.target.closest<HTMLElement>('[data-virtual-row]')
    focusedThreadId.current = row?.dataset.virtualRow
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    focusedThreadId.current = undefined
  }

  if (!virtual) {
    return (
      <div ref={listRef} role="list">
        {props.entries.map((entry, index) => (
          <div key={props.keyOf(entry)} role="listitem" aria-posinset={index + 1} aria-setsize={props.entries.length}>
            {props.render(entry)}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div
      ref={listRef}
      role="list"
      data-virtual-thread-rows=""
      style={{ position: 'relative', height: virtualizer.getTotalSize() }}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {virtualizer.getVirtualItems().map(item => {
        const entry = props.entries[item.index]
        if (entry === undefined) return null
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            role="listitem"
            data-index={item.index}
            data-virtual-row={props.threadIdOf(entry)}
            aria-posinset={item.index + 1}
            aria-setsize={props.entries.length}
            style={{ position: 'absolute', top: item.start - scrollMargin, left: 0, width: '100%' }}
          >
            {props.render(entry)}
          </div>
        )
      })}
    </div>
  )
}
