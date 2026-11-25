import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { ChevronRightIcon } from '@dshfiles/plugin-ui/icons'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

/**
 * Live work on a phone (unslop round five, C1). Below 28rem the dock's running jobs and working subagents fold into one
 * 44px "Live work · 1 job · 1 subagent" disclosure that opens to their full-width rows. Side by side, two cards each
 * kept about 170px and truncated everything, and a clipped elapsed time read as a stray "^".
 *
 * The rows stay their owners' (background-jobs, thread-sidebar): this only counts them, from the markers their docks
 * already carry (`data-dshfiles-live-preview-dock`, one `data-dshfiles-live-preview` per row, a fold row when several
 * run), and ConversationRoot.module.css hides them while the summary is closed.
 */
export interface LiveWorkCounts {
  readonly jobs: number
  readonly subagents: number
}

const NONE: LiveWorkCounts = { jobs: 0, subagents: 0 }

/** The viewport the summary serves; ConversationRoot.module.css uses the same bound. */
export const LIVE_WORK_QUERY = '(max-width: 27.99rem)'

/** Rows of one dock kind, or the count its fold row states while it is closed. */
const countOf = (dock: ParentNode, kind: 'jobs' | 'subagents', row: 'job' | 'agent'): number => {
  const region = dock.querySelector(`[data-dshfiles-live-preview-dock='${kind}']`)
  if (region === null) return 0
  const rows = region.querySelectorAll(`[data-dshfiles-live-preview='${row}']`).length
  const fold = region.querySelector(`[data-dshfiles-live-preview-fold='${kind}'] > span`)
  const folded = Number.parseInt(/\d+/u.exec(fold?.textContent ?? '')?.[0] ?? '', 10)
  return Math.max(rows, Number.isFinite(folded) ? folded : 0)
}

export const LiveWork = {
  /**
   * Count the live work a dock outlet holds.
   * @param dock - the `conversation.input.dock` outlet.
   * @returns running jobs and working subagents.
   */
  count(dock: ParentNode): LiveWorkCounts {
    return { jobs: countOf(dock, 'jobs', 'job'), subagents: countOf(dock, 'subagents', 'agent') }
  },
  same(a: LiveWorkCounts, b: LiveWorkCounts): boolean {
    return a.jobs === b.jobs && a.subagents === b.subagents
  },
  /**
   * "1 job · 2 subagents": the parts that are not zero.
   * @param counts - what the dock holds.
   * @param t - the conversation table (`liveWork.*`).
   */
  detail(counts: LiveWorkCounts, t: (key: LiveWorkKey, params: { readonly count: number }) => string): string {
    return [
      counts.jobs === 0 ? undefined : t(counts.jobs === 1 ? 'liveWork.job' : 'liveWork.jobs', { count: counts.jobs }),
      counts.subagents === 0 ? undefined : t(counts.subagents === 1 ? 'liveWork.subagent' : 'liveWork.subagents', { count: counts.subagents }),
    ].filter(part => part !== undefined).join(' · ')
  },
}

export type LiveWorkKey = 'liveWork.job' | 'liveWork.jobs' | 'liveWork.subagent' | 'liveWork.subagents'

/** A window without `matchMedia` (a test DOM, an embedded view) never counts as narrow. */
const query = (): MediaQueryList | undefined => (typeof window.matchMedia === 'function' ? window.matchMedia(LIVE_WORK_QUERY) : undefined)
const subscribeQuery = (notify: () => void): (() => void) => {
  const list = query()
  list?.addEventListener('change', notify)
  return () => list?.removeEventListener('change', notify)
}
const readQuery = (): boolean => query()?.matches ?? false
const readQueryOnServer = (): boolean => false

/**
 * The live work in the composer stack's dock, counted only while the viewport is narrow enough for the summary. The
 * stack is watched for the outlet arriving (child list only, so draft keystrokes cost nothing) and the outlet's subtree
 * for rows coming and going.
 * @param stack - the composer stack that holds the dock outlet.
 * @returns the counts; zero while the viewport is wider.
 */
export function useLiveWorkCounts(stack: RefObject<HTMLElement | null>): LiveWorkCounts {
  const narrow = useSyncExternalStore(subscribeQuery, readQuery, readQueryOnServer)
  const [counts, setCounts] = useState<LiveWorkCounts>(NONE)
  useEffect(() => {
    const root = stack.current
    if (!narrow || root === null) {
      setCounts(NONE)
      return
    }
    let outlet: Element | null = null
    const read = (): void => {
      const next = outlet === null ? NONE : LiveWork.count(outlet)
      setCounts(current => (LiveWork.same(current, next) ? current : next))
    }
    const inner = new MutationObserver(read)
    const attach = (): void => {
      const found = root.querySelector(":scope > [data-slot='conversation.input.dock']")
      if (found === outlet) return
      inner.disconnect()
      outlet = found
      if (outlet !== null) inner.observe(outlet, { subtree: true, childList: true, characterData: true })
      read()
    }
    const outer = new MutationObserver(attach)
    outer.observe(root, { childList: true })
    attach()
    return () => {
      outer.disconnect()
      inner.disconnect()
    }
  }, [narrow, stack])
  return counts
}

/**
 * The closed phone dock's one row: `› ○ Live work  1 job · 1 subagent`, 44px, the composer card's width.
 * @param props.open - whether the live rows show under it.
 */
export function LiveWorkSummary(props: {
  readonly counts: LiveWorkCounts
  readonly open: boolean
  readonly onToggle: () => void
  readonly label: string
  readonly detail: string
  readonly className?: string | undefined
}): JSX.Element | null {
  if (props.counts.jobs + props.counts.subagents === 0) return null
  return (
    <button
      type="button"
      aria-expanded={props.open}
      className={cn(
        'dshx-root dshx:flex dshx:h-11 dshx:w-full dshx:min-w-0 dshx:flex-none dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover dshx:px-3 dshx:text-left dshx:text-sm dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/60',
        props.className,
      )}
      data-live-work-summary=""
      onClick={props.onToggle}
    >
      <ChevronRightIcon aria-hidden className={cn('dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground', props.open && 'dshx:rotate-90')} />
      <StatusGlyph status="working" decorative />
      <span className="dshx:shrink-0 dshx:font-medium dshx:text-foreground">{props.label}</span>
      <span aria-hidden className="dshx:text-muted-foreground">
        ·
      </span>
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-muted-foreground" data-live-work-detail="">
        {props.detail}
      </span>
    </button>
  )
}
