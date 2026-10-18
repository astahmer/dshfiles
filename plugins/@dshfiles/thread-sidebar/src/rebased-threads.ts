import type { RebasedThreadSettleDelay } from './organization.js'

export interface RebasedThread {
  readonly sessionIds: readonly string[]
  readonly rebasedAt?: number | undefined
  readonly unlanded: readonly { readonly commitId: string }[]
}

export interface RebasedSessionState {
  readonly id: string
  readonly running: boolean
  readonly pendingInteraction: boolean | undefined
  readonly updatedAt: number
}

export const rebasedThreadSettleDelayMs = (delay: RebasedThreadSettleDelay): number => {
  if (delay === 'immediately') return 0
  if (delay === 'after-1-hour') return 60 * 60_000
  if (delay === 'after-1-day') return 24 * 60 * 60_000
  if (delay === 'after-1-week') return 7 * 24 * 60 * 60_000
  return Number.POSITIVE_INFINITY
}

export interface RebasedThreadSessionIndex {
  readonly rebasedAtBySessionId: ReadonlyMap<string, number>
  readonly dueSessionIds: readonly string[]
}

export const indexRebasedThreadSessions = (input: {
  readonly threads: readonly RebasedThread[]
  readonly sessions: ReadonlyMap<string, RebasedSessionState>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
  readonly now: number
  readonly delayMs: number
}): RebasedThreadSessionIndex => {
  const rebasedAtBySessionId = new Map<string, number>()
  const dueSessionIds = new Set<string>()

  for (const thread of input.threads) {
    const rebasedAt = thread.rebasedAt
    if (rebasedAt === undefined || thread.unlanded.length > 0) continue
    for (const sessionId of thread.sessionIds) rebasedAtBySessionId.set(sessionId, rebasedAt)
    if (input.now < rebasedAt + input.delayMs || thread.sessionIds.length === 0) continue

    const sessions = thread.sessionIds.map(sessionId => input.sessions.get(sessionId))
    if (
      sessions.some(
        session =>
          session === undefined ||
          session.running ||
          session.pendingInteraction !== false ||
          session.updatedAt > rebasedAt ||
          input.pinnedSessionIds.has(session.id),
      )
    )
      continue

    for (const sessionId of thread.sessionIds)
      if (!input.archivedSessionIds.has(sessionId) && !input.settledSessionIds.has(sessionId)) dueSessionIds.add(sessionId)
  }

  return { rebasedAtBySessionId, dueSessionIds: [...dueSessionIds] }
}
