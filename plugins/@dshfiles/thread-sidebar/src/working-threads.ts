import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'

export interface WorkingThreadInput {
  readonly session: { readonly id: string; readonly running: boolean }
  /** A root's activity also runs while one of its subagents does. */
  readonly activity: { readonly running: boolean }
}

/**
 * The threads with work in flight: a turn of their own, or a running subagent. A parent waiting on its subagent is
 * still working; its row shows the running child under it, so Working lists both together. This is what the status
 * filters mean by "running"; the number shown as "N working" is {@link WorkingThreadsProjection}.
 */
export const workingThreadIds = (threads: readonly WorkingThreadInput[]): ReadonlySet<string> =>
  new Set(threads.filter(thread => thread.session.running || thread.activity.running).map(thread => thread.session.id))

/**
 * Working in the status vocabulary (DESIGN.md): progressing without you. A thread that waits for your answer or
 * approval still runs a turn, but its row is Needs you, so it is not counted. With row statuses the row's own status
 * decides; without them (manual arrangement) a running thread counts unless it is known to wait for you.
 */
const projectedIds = (
  threads: readonly WorkingThreadInput[],
  options: { readonly statusOf: (sessionId: string) => WorkStatus | undefined; readonly waiting: ReadonlySet<string> },
): ReadonlySet<string> =>
  new Set(
    threads
      .filter(thread => {
        const status = options.statusOf(thread.session.id)
        if (status !== undefined) return status === 'working'
        return (thread.session.running || thread.activity.running) && !options.waiting.has(thread.session.id)
      })
      .map(thread => thread.session.id),
  )

let published: number | null = null
const listeners = new Set<() => void>()

/**
 * The one count of working threads: the thread list publishes it, and the "Working (N)" group, the status strip's
 * "N working", the tab title and the Working preset's count all read it, so they cannot disagree. Null while no thread
 * list is mounted to publish it.
 */
export class WorkingThreadsProjection {
  static readonly ids = projectedIds

  static publish(count: number | null): void {
    if (published === count) return
    published = count
    for (const listener of listeners) listener()
  }

  static count(this: void): number | null {
    return published
  }

  static subscribe(this: void, listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}
