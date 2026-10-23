export interface WorkingThreadInput {
  readonly session: { readonly id: string; readonly running: boolean }
  /** A root's activity also runs while one of its subagents does. */
  readonly activity: { readonly running: boolean }
}

/**
 * The threads with work in flight: a turn of their own, or a running subagent. A parent waiting on its subagent is
 * still working; its row shows the running child under it, so Working lists both together.
 */
export const workingThreadIds = (threads: readonly WorkingThreadInput[]): ReadonlySet<string> =>
  new Set(threads.filter(thread => thread.session.running || thread.activity.running).map(thread => thread.session.id))
