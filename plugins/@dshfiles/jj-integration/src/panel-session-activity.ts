/** One pass over the session store, so a workspace row never rescans every session to learn its cwd's activity. */

export interface IndexedSessionActivity {
  readonly cwd: string | null | undefined
  readonly running: boolean
  readonly waitingForInput: boolean
}

export interface SessionActivity {
  readonly running: boolean
  readonly waitingForInput: boolean
}

export interface SessionActivityIndex {
  /** Activity of every session sharing this cwd, including sessions the workspace does not list itself. */
  activityAt(cwd: string | null | undefined): SessionActivity
}

const IDLE: SessionActivity = { running: false, waitingForInput: false }

export const indexSessionActivity = (sessions: Iterable<IndexedSessionActivity>): SessionActivityIndex => {
  const byCwd = new Map<string, { running: boolean; waitingForInput: boolean }>()
  for (const session of sessions) {
    if (session.cwd === null || session.cwd === undefined) continue
    const current = byCwd.get(session.cwd)
    if (current === undefined) {
      byCwd.set(session.cwd, { running: session.running, waitingForInput: session.waitingForInput })
      continue
    }
    current.running = current.running || session.running
    current.waitingForInput = current.waitingForInput || session.waitingForInput
  }
  return { activityAt: cwd => (cwd === null || cwd === undefined ? IDLE : (byCwd.get(cwd) ?? IDLE)) }
}
