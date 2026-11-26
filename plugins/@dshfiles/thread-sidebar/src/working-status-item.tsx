import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { plural } from '@dshfiles/dshx/client'
import type { StatusItemProps } from '@dshfiles/frame-layout/status-strip'
import { SHOW_DESTINATION_EVENT } from './destination-shell.js'
import { useSyncExternalStore } from 'react'
import { useWorkingTabTitle } from './header-live-activity.js'
import type { ThreadSidebarLocaleKey } from './locales.js'
import { WorkingThreadsProjection } from './working-threads.js'

/**
 * Where "N working" sits in the global strip: after the accounts chip (order 20) and the other steady items, just before
 * Restart (90). It comes and goes with every turn, so no steady item may sit after it: mounted first, it moved the
 * accounts chip 72 px each time it appeared (F14).
 */
export const WORKING_STATUS_ORDER = 85

/** Selects the Working view of the thread list (client.tsx listens). */
export const SHOW_WORKING_THREADS_EVENT = 'dshfiles:thread-sidebar-show-working'

/** The item's full page: the Threads destination on its Working view. */
const openWorkingThreads = (): void => {
  window.dispatchEvent(new CustomEvent(SHOW_DESTINATION_EVENT, { detail: 'threads' }))
  window.dispatchEvent(new CustomEvent(SHOW_WORKING_THREADS_EVENT))
}

/**
 * Top-level threads with a running turn that asks no question; subagents roll up into their parent, as in the list.
 * Only the fallback while no thread list is mounted (a collapsed sidebar): the list's own projection also knows the
 * approvals and the inbox items that make a running thread Needs you.
 */
const workingCount = (state: {
  readonly ids: readonly string[]
  readonly byId: Readonly<
    Record<
      string,
      | {
          readonly running: boolean
          readonly blank: boolean
          readonly parentId?: string | undefined
          readonly projectionValues?: { readonly userQuestions?: { readonly active: readonly unknown[] } | undefined } | undefined
        }
      | undefined
    >
  >
}): number => {
  let count = 0
  for (const id of state.ids) {
    const session = state.byId[id]
    if (session === undefined || !session.running || session.blank || session.parentId !== undefined) continue
    // A thread that asks a question still runs its turn, but it is Needs you, not Working.
    if ((session.projectionValues?.userQuestions?.active.length ?? 0) > 0) continue
    count += 1
  }
  return count
}

/**
 * The status strip's "N working" item (plan §4.1 R5): global, text only, colourless (dark cockpit). It hides while
 * nothing runs, so an idle strip stays quiet. The number is the thread list's Working projection, the same one its
 * "Working (N)" group and the Working preset show.
 */
export const WorkingStatusItem = (props: StatusItemProps & { readonly label: (count: number) => string }): JSX.Element | null => {
  const running = props.useSessions(workingCount)
  const projected = useSyncExternalStore(WorkingThreadsProjection.subscribe, WorkingThreadsProjection.count, WorkingThreadsProjection.count)
  const count = projected ?? running
  // The strip is mounted on every layout and phone screen, so it also keeps the tab title's "⟳ N ·" (polish pass b:r4et).
  useWorkingTabTitle(count, true)
  if (count === 0) return null
  return (
    <span className="dshx-root" data-testid="status-item-working">
      {props.label(count)}
    </span>
  )
}

/**
 * The item's words: it counts threads, so it says so, "1 thread working" (council round 23, item 10); a bare "1 working"
 * read as the subagent count every other surface prints.
 */
const label =
  (translate: Translate<ThreadSidebarLocaleKey>) =>
  (count: number): string =>
    plural(translate, 'threadSidebarThreadsWorking', count)

export class WorkingStatusModel {
  static readonly workingCount = workingCount
  static readonly label = label
  static readonly open = openWorkingThreads
}
