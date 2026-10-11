export interface WorkingThreadInput {
  readonly id: string
  readonly running: boolean
}

export const workingThreadIds = (threads: readonly WorkingThreadInput[]): ReadonlySet<string> =>
  new Set(threads.filter(thread => thread.running).map(thread => thread.id))
