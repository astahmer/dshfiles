import type { RenderEntry } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { chatRenderKey } from './native/chat/render-entry.ts'

/**
 * Which transcript rows a thread mounts. The Host already opens a thread on a window of its latest Turns, but on agent
 * threads that window holds hundreds of messages and tool results, and mounting all of them is what made a sidebar
 * click block the main thread for seconds. The view mounts the newest rows and the rows above them as the reader
 * scrolls up; rows it has not mounted count as more history, so paging and Turn jumps widen this window before they ask
 * the Host for older pages.
 */
export class TranscriptWindow {
  /** Rows a thread opens with: more than a tall viewport holds, so the first paint already fills it. */
  static readonly openingRows = 24
  /** Rows one step up the transcript mounts. */
  static readonly growthRows = 24
  /** Steps an open may take on its own while its rows do not fill the view; scrolling up takes the rest. */
  static readonly openingFillSteps = 3

  /** Index of the first mounted row when a thread opens, keeping a restored reading position mounted. */
  static openingStart(input: { readonly count: number; readonly anchorIndex: number | null }): number {
    const tail = Math.max(0, input.count - TranscriptWindow.openingRows)
    return input.anchorIndex === null ? tail : Math.min(tail, Math.max(0, input.anchorIndex - TranscriptWindow.growthRows))
  }

  /** Index of the first mounted row after one step up. */
  static grownStart(start: number): number {
    return Math.max(0, start - TranscriptWindow.growthRows)
  }

  /**
   * Index of the first mounted row that covers `seq`, or null when no loaded row starts at or before it.
   * @param seqs - each row's first sequence, in transcript order; undefined when unknown.
   */
  static startCovering(input: { readonly seqs: readonly (number | undefined)[]; readonly seq: number; readonly start: number }): number | null {
    for (let index = Math.min(input.start, input.seqs.length - 1); index >= 0; index--) {
      const rowSeq = input.seqs[index]
      if (rowSeq !== undefined && rowSeq <= input.seq) return Math.max(0, index - 1)
    }
    return null
  }

  /** Whether a saved reading anchor (`data-chat-anchor-key`) belongs to this row. */
  static holdsAnchor(entry: RenderEntry, anchorKey: string, members: (groupKey: string) => readonly string[]): boolean {
    if (entry.kind === 'group')
      return anchorKey === `group:${entry.key}` || members(entry.key).some(key => anchorKey === key || anchorKey.startsWith(`[${JSON.stringify(key)},`))
    return anchorKey === entry.key || anchorKey.startsWith(`[${JSON.stringify(entry.key)},`)
  }
}

interface WindowInput {
  /** History is open. */
  readonly ready: boolean
  /** Whether the reader follows the newest row; the window slides with the tail until they leave it. */
  readonly following: () => boolean
  readonly entries: readonly RenderEntry[]
  /** First Session sequence a row shows; undefined while its Node is not loaded. */
  readonly seqOf: (entry: RenderEntry) => number | undefined
  readonly members: (groupKey: string) => readonly string[]
  readonly savedAnchor: () => string | null
  readonly hasMore: boolean
  readonly loadOlder: () => void
  readonly loadThrough: (seq: SessionSeq) => Promise<void>
}

/**
 * Mount a thread's newest rows and widen toward older ones on demand.
 * @returns the mounted rows and history operations that treat unmounted rows as more history.
 */
export const useTranscriptWindow = (input: WindowInput) => {
  const { ready, following, entries, seqOf, members, savedAnchor, hasMore, loadOlder, loadThrough } = input
  // The first mounted row, by identity, so rows appended while the reader is up the transcript never unmount the rows
  // they read; null mounts every row. Undefined while the window slides with the tail: history and grouping arrive in
  // several commits, and a reader at the newest row loses nothing when older rows leave.
  const [startKey, setStartKey] = useState<string | null | undefined>(undefined)
  const lastStart = useRef(0)

  let start: number
  if (startKey === null) start = 0
  else if (startKey === undefined) {
    const anchor = savedAnchor()
    const anchorIndex = anchor === null ? -1 : entries.findIndex(entry => TranscriptWindow.holdsAnchor(entry, anchor, members))
    start = TranscriptWindow.openingStart({ count: entries.length, anchorIndex: anchorIndex === -1 ? null : anchorIndex })
  } else {
    const index = entries.findIndex(entry => chatRenderKey(entry) === startKey)
    // A regrouping can retire the start row's identity; keep the same position instead of collapsing the window.
    start = index === -1 ? Math.min(lastStart.current, Math.max(0, entries.length - 1)) : index
  }
  lastStart.current = start

  const startRow = entries[start]
  const openingKey = startKey === undefined && ready && startRow !== undefined && !following() ? chatRenderKey(startRow) : undefined
  useLayoutEffect(() => {
    if (openingKey !== undefined) setStartKey(openingKey)
  }, [openingKey])

  const mounted = useMemo(() => (start === 0 ? entries : entries.slice(start)), [entries, start])
  const startEntry = mounted[0]
  const firstSeq = startEntry === undefined ? null : (seqOf(startEntry) ?? null)

  const widenTo = useCallback(
    (index: number) => {
      const entry = entries[index]
      setStartKey(index <= 0 || entry === undefined ? null : chatRenderKey(entry))
    },
    [entries],
  )

  const loadOlderRows = useCallback(() => {
    if (start > 0) {
      widenTo(TranscriptWindow.grownStart(start))
      return
    }
    setStartKey(null)
    loadOlder()
  }, [start, widenTo, loadOlder])

  const loadThroughRows = useCallback(
    (seq: SessionSeq): Promise<void> => {
      const covering = TranscriptWindow.startCovering({ seqs: entries.map(seqOf), seq, start })
      if (covering !== null) {
        if (covering < start) widenTo(covering)
        return Promise.resolve()
      }
      setStartKey(null)
      return loadThrough(seq)
    },
    [entries, seqOf, start, widenTo, loadThrough],
  )

  return {
    entries: mounted,
    hidden: start,
    hasMore: hasMore || start > 0,
    firstSeq,
    loadOlder: loadOlderRows,
    loadThrough: loadThroughRows,
  }
}
