import { createHash } from 'node:crypto'
import type {
  AttentionCounts,
  AttentionDraft,
  AttentionItem,
  AttentionPublish,
  AttentionSeverity,
  AttentionView,
} from './attention-api.js'

/** Closed items (done or resolved) stay listed this long so the user can see and reopen them. */
export const CLOSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** Stored items at most; the oldest closed items leave first, then the oldest open ones. */
export const MAX_ITEMS = 2000

const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32)

/** One item per source and dedupe key. */
const itemIdOf = (source: string, dedupeKey: string): string => digest(`${source}\u0000${dedupeKey}`)

/** Everything a provider states; an unchanged repeat has the same fingerprint. */
const fingerprintOf = (draft: AttentionDraft): string =>
  digest(
    JSON.stringify([
      draft.severity,
      draft.reason,
      draft.detail ?? null,
      draft.verbs,
      draft.choices ?? [],
      draft.subject.kind,
      draft.subject.id,
      draft.subject.label ?? null,
    ]),
  )

const stated = (input: AttentionPublish) => ({
  subject: input.subject,
  reason: input.reason,
  detail: input.detail ?? null,
  severity: input.severity,
  verbs: input.verbs,
  choices: input.choices ?? [],
  fingerprint: fingerprintOf(input),
})

export interface PublishOutcome {
  readonly item: AttentionItem
  /** False for an unchanged repeat: nothing to write and nothing to announce. */
  readonly changed: boolean
}

/**
 * Merge one publish into the stored item of its dedupe key.
 * - New key: a fresh open item.
 * - Resolved item: a new occurrence; it reopens with every user state cleared.
 * - Same fingerprint: unchanged, so Done and snooze-until-change hold.
 * - Changed fingerprint: the item updates, and a Done or a snooze-until-change lifts (a timed snooze holds).
 */
const publish = (existing: AttentionItem | undefined, input: AttentionPublish, now: number): PublishOutcome => {
  const next = stated(input)
  if (existing === undefined) {
    return {
      changed: true,
      item: {
        id: itemIdOf(input.source, input.dedupeKey),
        source: input.source,
        dedupeKey: input.dedupeKey,
        ...next,
        createdAt: now,
        openedAt: now,
        updatedAt: now,
        occurrences: 1,
        resolvedAt: null,
        doneAt: null,
        snoozedUntil: null,
        snoozeUntilChange: false,
      },
    }
  }
  if (existing.resolvedAt !== null) {
    return {
      changed: true,
      item: {
        ...existing,
        ...next,
        openedAt: now,
        updatedAt: now,
        occurrences: existing.occurrences + 1,
        resolvedAt: null,
        doneAt: null,
        snoozedUntil: null,
        snoozeUntilChange: false,
      },
    }
  }
  if (existing.fingerprint === next.fingerprint) return { changed: false, item: existing }
  return {
    changed: true,
    item: { ...existing, ...next, updatedAt: now, doneAt: null, snoozeUntilChange: false },
  }
}

/** The provider closed the item; resolving twice is a no-op. */
const resolve = (existing: AttentionItem, now: number): PublishOutcome =>
  existing.resolvedAt !== null ? { changed: false, item: existing } : { changed: true, item: { ...existing, resolvedAt: now, updatedAt: now } }

export type UserTransitionRefusal = 'resolved' | 'snooze-in-past' | 'snooze-target-missing'

export type UserTransition = { readonly ok: true; readonly item: AttentionItem; readonly changed: boolean } | { readonly ok: false; readonly refusal: UserTransitionRefusal }

const done = (existing: AttentionItem, now: number): UserTransition => {
  if (existing.resolvedAt !== null) return { ok: false, refusal: 'resolved' }
  if (existing.doneAt !== null) return { ok: true, item: existing, changed: false }
  return { ok: true, changed: true, item: { ...existing, doneAt: now, updatedAt: now } }
}

const snooze = (existing: AttentionItem, target: { readonly until?: number; readonly untilChange?: boolean }, now: number): UserTransition => {
  if (existing.resolvedAt !== null) return { ok: false, refusal: 'resolved' }
  if (target.untilChange === true) {
    return { ok: true, changed: true, item: { ...existing, doneAt: null, snoozedUntil: null, snoozeUntilChange: true, updatedAt: now } }
  }
  if (target.until === undefined) return { ok: false, refusal: 'snooze-target-missing' }
  if (target.until <= now) return { ok: false, refusal: 'snooze-in-past' }
  return { ok: true, changed: true, item: { ...existing, doneAt: null, snoozedUntil: target.until, snoozeUntilChange: false, updatedAt: now } }
}

/** Undo Done and any snooze. A resolved item belongs to its provider and only a new publish reopens it. */
const reopen = (existing: AttentionItem, now: number): UserTransition => {
  if (existing.resolvedAt !== null) return { ok: false, refusal: 'resolved' }
  if (existing.doneAt === null && existing.snoozedUntil === null && !existing.snoozeUntilChange) return { ok: true, item: existing, changed: false }
  return { ok: true, changed: true, item: { ...existing, doneAt: null, snoozedUntil: null, snoozeUntilChange: false, updatedAt: now } }
}

const isSnoozed = (item: AttentionItem, now: number): boolean => item.snoozeUntilChange || (item.snoozedUntil !== null && item.snoozedUntil > now)

/** Where one item shows; `null` for info items, which never reach the inbox. */
const viewOf = (item: AttentionItem, mutedSources: ReadonlySet<string>, now: number): AttentionView | null => {
  if (item.severity === 'info') return null
  if (item.resolvedAt !== null || item.doneAt !== null) return 'closed'
  if (mutedSources.has(item.source)) return 'muted'
  if (isSnoozed(item, now)) return 'snoozed'
  return item.severity === 'ready' ? 'other' : 'needs-you'
}

const severityRank = { blocking: 0, failed: 1, ready: 2, info: 3 } as const satisfies Record<AttentionSeverity, number>

const closedAt = (item: AttentionItem): number => Math.max(item.resolvedAt ?? 0, item.doneAt ?? 0)

/** Blocking before failed, then the item that came back to you most recently. Closed items: most recently closed first. */
const compareIn = (view: AttentionView) => (left: AttentionItem, right: AttentionItem): number => {
  if (view === 'closed') return closedAt(right) - closedAt(left) || left.id.localeCompare(right.id)
  return severityRank[left.severity] - severityRank[right.severity] || right.openedAt - left.openedAt || left.id.localeCompare(right.id)
}

const countsOf = (items: Iterable<AttentionItem>, mutedSources: ReadonlySet<string>, now: number): AttentionCounts => {
  const counts = { needsYou: 0, blocking: 0, other: 0, snoozed: 0, closed: 0, muted: 0 }
  for (const item of items) {
    const view = viewOf(item, mutedSources, now)
    if (view === 'needs-you') {
      counts.needsYou += 1
      if (item.severity === 'blocking') counts.blocking += 1
    } else if (view === 'other') counts.other += 1
    else if (view === 'snoozed') counts.snoozed += 1
    else if (view === 'closed') counts.closed += 1
    else if (view === 'muted') counts.muted += 1
  }
  return counts
}

const listView = (input: {
  readonly items: Iterable<AttentionItem>
  readonly mutedSources: ReadonlySet<string>
  readonly view: AttentionView
  readonly limit: number
  readonly now: number
}): readonly AttentionItem[] =>
  [...input.items]
    .filter(item => viewOf(item, input.mutedSources, input.now) === input.view)
    .sort(compareIn(input.view))
    .slice(0, input.limit)

/** Ids to delete: closed items past retention, then the oldest items beyond the bound (closed first). */
const pruneIds = (items: readonly AttentionItem[], now: number, maxItems = MAX_ITEMS): readonly string[] => {
  const expired = items.filter(item => item.severity === 'info' || (closedAt(item) > 0 && closedAt(item) < now - CLOSED_RETENTION_MS))
  const expiredIds = new Set(expired.map(item => item.id))
  const remaining = items.filter(item => !expiredIds.has(item.id))
  const overflow = Math.max(0, remaining.length - maxItems)
  const evicted = [...remaining]
    .sort((left, right) => Number(closedAt(right) > 0) - Number(closedAt(left) > 0) || left.updatedAt - right.updatedAt)
    .slice(0, overflow)
  return [...expiredIds, ...evicted.map(item => item.id)]
}

/** Pure inbox transitions; the store applies them durably and the tests pin them. */
export class AttentionModel {
  static readonly itemIdOf = itemIdOf
  static readonly fingerprintOf = fingerprintOf
  static readonly publish = publish
  static readonly resolve = resolve
  static readonly done = done
  static readonly snooze = snooze
  static readonly reopen = reopen
  static readonly isSnoozed = isSnoozed
  static readonly viewOf = viewOf
  static readonly countsOf = countsOf
  static readonly listView = listView
  static readonly pruneIds = pruneIds
}
