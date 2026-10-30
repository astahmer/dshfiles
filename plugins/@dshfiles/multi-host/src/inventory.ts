import type { RemoteThreadSummary, RuntimeStatus } from './api.js'

/** One runtime's last status answer, with the host name the directory gave it. */
export type InventoryStatus = {
  readonly runtimeId: string
  readonly hostName: string
  readonly status: RuntimeStatus
}

/** One row of the remote threads list: either started here, or found on a host. */
export type InventoryRow = {
  readonly runtimeId: string
  readonly sessionId: string
  readonly hostName: string
  readonly title?: string
  readonly cwd?: string
  readonly running: boolean
  readonly updatedAt: number
  readonly startedHere: boolean
}

type OptionalRowFields = { title?: string; cwd?: string }

const rowKey = (runtimeId: string, sessionId: string): string => `${runtimeId}\u0000${sessionId}`

/**
 * Merge the threads this DSH started (its own thread list) with every host's `session.list`: a thread started here
 * keeps its stored title, a thread started on the host itself appears for the first time. Blank Sessions never got a
 * message, so they stay out of the list.
 */
export const mergeInventory = (input: {
  readonly startedHere: readonly RemoteThreadSummary[]
  readonly statuses: readonly InventoryStatus[]
}): readonly InventoryRow[] => {
  const rows = new Map<string, InventoryRow>()
  const live = new Map<string, { readonly running: boolean; readonly updatedAt: number }>()
  const blank = new Set<string>()
  for (const source of input.statuses) {
    if (!source.status.ok) continue
    for (const session of source.status.sessions) {
      const key = rowKey(session.runtimeId, session.sessionId)
      if (session.blank) {
        blank.add(key)
        continue
      }
      live.set(key, { running: session.running, updatedAt: session.updatedAt })
    }
  }
  for (const thread of input.startedHere) {
    const key = rowKey(thread.runtimeId, thread.sessionId)
    if (blank.has(key)) continue
    const status = live.get(key)
    const updatedAt = status?.updatedAt ?? Date.parse(thread.createdAt)
    rows.set(rowKey(thread.runtimeId, thread.sessionId), {
      runtimeId: thread.runtimeId,
      sessionId: thread.sessionId,
      hostName: thread.hostName,
      title: thread.title,
      cwd: thread.cwd,
      running: status?.running ?? false,
      updatedAt: Number.isNaN(updatedAt) ? 0 : updatedAt,
      startedHere: true,
    })
  }
  for (const source of input.statuses) {
    if (!source.status.ok) continue
    for (const session of source.status.sessions) {
      if (session.blank) continue
      const key = rowKey(session.runtimeId, session.sessionId)
      if (rows.has(key)) continue
      const optional: OptionalRowFields = {}
      if (session.title !== undefined && session.title !== '') optional.title = session.title
      if (session.cwd !== undefined) optional.cwd = session.cwd
      rows.set(key, {
        runtimeId: session.runtimeId,
        sessionId: session.sessionId,
        hostName: source.hostName,
        ...optional,
        running: session.running,
        updatedAt: session.updatedAt,
        startedHere: false,
      })
    }
  }
  return [...rows.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}
