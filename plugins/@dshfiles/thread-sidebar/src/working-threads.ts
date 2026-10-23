export interface WorkingThreadInput {
  readonly session: { readonly id: string; readonly running: boolean }
}

/**
 * The threads whose own turn is running. A parent that only waits on a running subagent stays out: its row says
 * Turn finished or Inactive, so listing it under Working would contradict the row.
 */
export const workingThreadIds = (threads: readonly WorkingThreadInput[]): ReadonlySet<string> =>
  new Set(threads.filter(thread => thread.session.running).map(thread => thread.session.id))
