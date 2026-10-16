import type { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import type { ApiClientOutput } from '@dshfiles/dshx/api'

/** One durable provider-blocked turn, exactly as the AI Accounts contract publishes it. */
export type QuotaContinuation = ApiClientOutput<(typeof aiAccountsApi.methods)['quotaContinuations']>['continuations'][number]

export interface UsageLimitRow<Session> {
  readonly continuation: QuotaContinuation
  readonly session: Session
}

/** How a stored recovery reads right now; the section owns the wording. */
export type UsageLimitTiming =
  | { readonly kind: 'queued' }
  | { readonly kind: 'snoozed'; readonly until: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'waiting'; readonly resetAt: number }

export const usageLimitTiming = (continuation: QuotaContinuation, now: number): UsageLimitTiming => {
  if (continuation.state === 'queued') return { kind: 'queued' }
  if (continuation.snoozedUntil !== null && continuation.snoozedUntil > now) return { kind: 'snoozed', until: continuation.snoozedUntil }
  if (continuation.ready) return { kind: 'ready' }
  return continuation.resetAt === null ? { kind: 'unknown' } : { kind: 'waiting', resetAt: continuation.resetAt }
}

/**
 * "2h 30m" until a reset a future timestamp names. The shared `relativeTime`
 * helper clamps a future timestamp to "now", so a countdown needs its own.
 */
export const formatRemaining = (at: number, now: number): string => {
  const minutes = Math.max(0, Math.round((at - now) / 60_000))
  if (minutes < 60) return `${String(minutes)}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`
  }
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours === 0 ? `${String(days)}d` : `${String(days)}d ${String(restHours)}h`
}

type UsageLimitSession = {
  readonly id: string
  readonly blank: boolean
  readonly running: boolean
}

/**
 * Threads the sidebar shows as provider-blocked: a stored recovery no run has
 * picked up yet, on a Session that is still idle in the current view. A recovery
 * already queued, a Session running again, and anything muted or archived stay
 * out. Resets that have already passed come first, so the actionable rows lead.
 */
export const selectUsageLimitRows = <Session extends UsageLimitSession>(options: {
  readonly sessions: readonly Session[]
  readonly continuations: readonly QuotaContinuation[]
  readonly mutedSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly matchesWorkspace: (session: Session) => boolean
  readonly matchesSource: (session: Session) => boolean
}): UsageLimitRow<Session>[] => {
  const byId = new Map(options.sessions.map(session => [session.id, session]))
  const rows: UsageLimitRow<Session>[] = []
  for (const continuation of options.continuations) {
    if (continuation.state !== 'waiting') continue
    const session = byId.get(continuation.sessionId)
    if (session === undefined || session.blank || session.running) continue
    if (options.mutedSessionIds.has(session.id) || options.archivedSessionIds.has(session.id)) continue
    if (!options.matchesWorkspace(session) || !options.matchesSource(session)) continue
    rows.push({ continuation, session })
  }
  return rows.sort((left, right) => {
    const ready = Number(right.continuation.ready) - Number(left.continuation.ready)
    return ready === 0 ? right.continuation.failedAt - left.continuation.failedAt : ready
  })
}
