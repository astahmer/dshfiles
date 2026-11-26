import { useCallback, useId, useLayoutEffect, useSyncExternalStore, type RefObject } from 'react'

/** The widest a shared title column grows; a longer title truncates inside it. */
export const TITLE_COLUMN_CAP_PX = 320
/** Rows a run needs before its titles share a column; two rows line up by eye. */
export const TITLE_COLUMN_MINIMUM_ROWS = 3
/** The custom property a row's root carries; the row's disclosure header sizes its title area from it. */
export const TITLE_COLUMN_PROPERTY = '--dshfiles-subagent-title-column'

/**
 * Each run's rows report their title's natural width; the column is the widest, capped (council round 23, item 1: "in a
 * group of 3+ rows, titles share a column (cap ~320 px) so model marks start on one x, as in the dock"). A run's rows
 * sit in separate transcript seats, so the width is shared through this store, keyed by the run Chat names on the seat.
 */
const widths = new Map<string, Map<string, number>>()
const listeners = new Map<string, Set<() => void>>()

const columnOf = (runKey: string): number | undefined => {
  const run = widths.get(runKey)
  if (run === undefined || run.size === 0) return undefined
  return Math.min(TITLE_COLUMN_CAP_PX, Math.max(...run.values()))
}

const notify = (runKey: string): void => {
  for (const listener of listeners.get(runKey) ?? []) listener()
}

const report = (runKey: string, rowId: string, width: number): void => {
  const run = widths.get(runKey) ?? new Map<string, number>()
  const before = columnOf(runKey)
  // A hidden row (its run collapsed) measures 0: it holds no width until it shows again.
  if (width > 0) run.set(rowId, Math.ceil(width))
  else run.delete(rowId)
  if (run.size === 0) widths.delete(runKey)
  else widths.set(runKey, run)
  if (columnOf(runKey) !== before) notify(runKey)
}

const remove = (runKey: string, rowId: string): void => {
  report(runKey, rowId, 0)
}

const subscribe = (runKey: string, listener: () => void): (() => void) => {
  const set = listeners.get(runKey) ?? new Set()
  set.add(listener)
  listeners.set(runKey, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(runKey)
  }
}

export const SubagentTitleColumns = { columnOf, report, remove } as const

/**
 * The native disclosure row's title text: the row's text area (its last child), whose content box holds the title first.
 * Undefined when the native markup changes, so the row simply keeps its own width.
 */
const titleOf = (root: HTMLElement | null): HTMLElement | undefined => {
  const title = root?.querySelector('[data-disclosure-row]')?.lastElementChild?.firstElementChild?.firstElementChild
  return title instanceof HTMLElement ? title : undefined
}

/**
 * A title's natural width in fractional px: its text's laid-out width (kept while the title truncates), else its
 * `scrollWidth`, which rounds: a 210.375 px title in a 210 px column ended "against tota…".
 */
const naturalWidthOf = (title: HTMLElement): number => {
  const range = document.createRange()
  range.selectNodeContents(title)
  const text = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect().width : 0
  return Math.max(title.scrollWidth, text)
}

/**
 * The shared title column of the run this row sits in, in px; undefined outside a run of {@link TITLE_COLUMN_MINIMUM_ROWS}
 * or more rows, or before any row measured. Reports this row's natural title width (its `scrollWidth`, which a truncated
 * title keeps) while mounted, again when the title resizes, when the run's column changes and when web fonts finish
 * loading: a title truncated in the column keeps its box while its text widens, so no resize says so.
 */
export const useSubagentTitleColumn = (input: {
  readonly rootRef: RefObject<HTMLElement | null>
  readonly runKey: string | undefined
  readonly size: number
  /** The title text; a new title is measured again. */
  readonly title: string
}): number | undefined => {
  const rowId = useId()
  const runKey = input.size >= TITLE_COLUMN_MINIMUM_ROWS ? input.runKey : undefined
  const { rootRef, title } = input
  useLayoutEffect(() => {
    void title
    if (runKey === undefined) return undefined
    const element = titleOf(rootRef.current)
    if (element === undefined) return undefined
    const measure = (): void => {
      report(runKey, rowId, naturalWidthOf(element))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    // A report notifies only when the column changes, so measuring again on a change settles.
    const unsubscribe = subscribe(runKey, measure)
    const fonts = typeof document === 'undefined' ? undefined : document.fonts
    fonts?.addEventListener('loadingdone', measure)
    let live = true
    void fonts?.ready.then(() => {
      if (live) measure()
    })
    return () => {
      live = false
      observer?.disconnect()
      unsubscribe()
      fonts?.removeEventListener('loadingdone', measure)
      remove(runKey, rowId)
    }
  }, [rootRef, runKey, rowId, title])
  const subscribeRun = useCallback((listener: () => void) => (runKey === undefined ? () => undefined : subscribe(runKey, listener)), [runKey])
  return useSyncExternalStore(subscribeRun, () => (runKey === undefined ? undefined : columnOf(runKey)))
}
