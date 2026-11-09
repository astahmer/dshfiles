/**
 * One status per thread row, in the ADE vocabulary (plan `docs/ade-ux` §4.7), and the groups the default thread list
 * shows: Pinned on top, then Needs you · Working · Ready · Idle · Done.
 *
 * "Needs you" and "Failed" are a projection of the inbox (§4.8): an open inbox item about the thread (subject kind
 * `session`) with blocking or failed severity, plus the thread states this sidebar already classifies (a pending
 * question or approval, a usage-limit stop, an interrupted turn). A parent rolls up its subagents, so it never looks
 * finished while a child failed or waits. Pure: the client passes every input, so tests cover the whole mapping.
 */
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { ThreadAttentionLabel } from './attention-presentation.js'

export const THREAD_STATUS_GROUPS = ['pinned', 'needs-you', 'working', 'ready', 'idle', 'done'] as const
export type ThreadStatusGroup = (typeof THREAD_STATUS_GROUPS)[number]

/** A thread nobody touched for this long folds into Done on its own, unless it is pinned (§4.3). */
export const DONE_AFTER_IDLE_MS = 72 * 60 * 60 * 1000

/** The group key Done starts folded under; opening it stores this marker instead (collapsed groups hold closed keys). */
export const STATUS_GROUP_KEY_PREFIX = 'state:'
export const DONE_GROUP_KEY = `${STATUS_GROUP_KEY_PREFIX}done`
export const DONE_GROUP_OPEN_KEY = `${DONE_GROUP_KEY}:open`

/** Provider verbs a row may offer inline; the first one an item names wins. */
export const INLINE_VERBS = ['Answer', 'Approve', 'Retry', 'Resume', 'Land'] as const
export type InlineVerb = (typeof INLINE_VERBS)[number]

/** What the inbox says about one thread: its most urgent open item. */
export interface InboxThreadSignal {
  readonly itemId: string
  readonly severity: 'blocking' | 'failed' | 'ready'
  readonly reason: string
  /** The first provider verb the item offers, if any. */
  readonly verb: InlineVerb | undefined
  /** When the item last became open: the moment the thread "came back to you". */
  readonly openedAt: number
}

export interface ThreadStatusInput {
  readonly running: boolean
  readonly pinned: boolean
  readonly archived: boolean
  readonly settled: boolean
  /** The Host still holds an unacknowledged finish (or a hand unread mark). */
  readonly unread: boolean
  /** The sidebar's own attention labels for this thread (not its children). */
  readonly labels: readonly ThreadAttentionLabel[]
  readonly inbox: InboxThreadSignal | undefined
  /** Last activity: the newest of its update, finish or mute time. */
  readonly activityAt: number
  /** When it was settled, when known. */
  readonly settledAt: number | undefined
  readonly now: number
}

export interface ThreadStatus {
  readonly status: WorkStatus
  readonly group: ThreadStatusGroup
  /** Short detail beside the title: why it needs you, or what the subagents are doing. */
  readonly detail: string | undefined
  /** The one inline verb the row offers, when it needs you. */
  readonly verb: InlineVerb | undefined
  /** The inbox item the verb acts on, when the verb came from the inbox. */
  readonly itemId: string | undefined
  /** When the thread entered its current state, as far as the inputs tell: the within-group sort key. */
  readonly since: number
}

const NEEDS_YOU_LABELS: readonly ThreadAttentionLabel[] = ['threadSidebarApprovalNeeded', 'threadSidebarInputNeeded', 'threadSidebarNeedsResume']
const FAILED_LABELS: readonly ThreadAttentionLabel[] = ['threadSidebarInterrupted']

const LABEL_VERB: Partial<Record<ThreadAttentionLabel, InlineVerb>> = {
  threadSidebarApprovalNeeded: 'Approve',
  threadSidebarInputNeeded: 'Answer',
  threadSidebarNeedsResume: 'Resume',
  threadSidebarInterrupted: 'Resume',
}

/** The thread's own state, before any subagent roll-up. */
const ownStatus = (input: ThreadStatusInput): Omit<ThreadStatus, 'group'> => {
  const inbox = input.inbox
  const labelFor = (labels: readonly ThreadAttentionLabel[]) => input.labels.find(label => labels.includes(label))
  // Archived and settled threads are stored away: they are Done whatever their last turn said.
  if (input.archived || input.settled)
    return { status: 'done', detail: undefined, verb: undefined, itemId: undefined, since: input.settledAt ?? input.activityAt }
  const needsLabel = labelFor(NEEDS_YOU_LABELS)
  if (inbox?.severity === 'blocking' || needsLabel !== undefined) {
    const fromInbox = inbox?.severity === 'blocking'
    return {
      status: 'needs-you',
      detail: fromInbox ? inbox.reason : undefined,
      verb: (fromInbox ? inbox.verb : undefined) ?? (needsLabel === undefined ? undefined : LABEL_VERB[needsLabel]),
      itemId: fromInbox ? inbox.itemId : undefined,
      since: fromInbox ? inbox.openedAt : input.activityAt,
    }
  }
  const failedLabel = labelFor(FAILED_LABELS)
  if (inbox?.severity === 'failed' || failedLabel !== undefined) {
    const fromInbox = inbox?.severity === 'failed'
    return {
      status: 'failed',
      detail: fromInbox ? inbox.reason : undefined,
      verb: (fromInbox ? inbox.verb : undefined) ?? (failedLabel === undefined ? undefined : LABEL_VERB[failedLabel]),
      itemId: fromInbox ? inbox.itemId : undefined,
      since: fromInbox ? inbox.openedAt : input.activityAt,
    }
  }
  if (input.running) return { status: 'working', detail: undefined, verb: undefined, itemId: undefined, since: input.activityAt }
  if (input.unread || input.labels.includes('threadSidebarTurnFinished') || inbox?.severity === 'ready') {
    const fromInbox = inbox?.severity === 'ready'
    return {
      status: 'ready',
      detail: undefined,
      // Only a provider verb (Land) earns an inline button on a Ready row; a plain finished turn just opens.
      verb: fromInbox ? inbox.verb : undefined,
      itemId: fromInbox ? inbox.itemId : undefined,
      since: fromInbox ? Math.max(inbox.openedAt, input.activityAt) : input.activityAt,
    }
  }
  if (input.now - input.activityAt >= DONE_AFTER_IDLE_MS) {
    return { status: 'done', detail: undefined, verb: undefined, itemId: undefined, since: input.activityAt + DONE_AFTER_IDLE_MS }
  }
  return { status: 'idle', detail: undefined, verb: undefined, itemId: undefined, since: input.activityAt }
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/**
 * The row status of a thread with its subagents rolled up: a child that needs you or failed lifts the parent into
 * Needs you (with detail text naming how many), and a running child keeps an otherwise finished parent Working
 * ("waiting on 2 subagents").
 */
const statusOf = (input: ThreadStatusInput, children: readonly Omit<ThreadStatus, 'group'>[] = []): ThreadStatus => {
  const own = ownStatus(input)
  const waiting = children.filter(child => child.status === 'needs-you')
  const failed = children.filter(child => child.status === 'failed')
  const working = children.filter(child => child.status === 'working')
  let rolled = own
  if (own.status !== 'needs-you' && own.status !== 'done' && waiting.length > 0) {
    rolled = {
      status: 'needs-you',
      detail: `${plural(waiting.length, 'subagent needs', 'subagents need')} you`,
      verb: waiting[0]?.verb,
      itemId: waiting[0]?.itemId,
      since: Math.max(...waiting.map(child => child.since)),
    }
  } else if (own.status !== 'needs-you' && own.status !== 'failed' && own.status !== 'done' && failed.length > 0) {
    rolled = {
      status: 'failed',
      detail: `${plural(failed.length, 'subagent', 'subagents')} failed`,
      verb: failed[0]?.verb,
      itemId: failed[0]?.itemId,
      since: Math.max(...failed.map(child => child.since)),
    }
  } else if ((own.status === 'idle' || own.status === 'ready') && working.length > 0) {
    rolled = {
      status: 'working',
      detail: `waiting on ${plural(working.length, 'subagent', 'subagents')}`,
      verb: undefined,
      itemId: undefined,
      since: own.since,
    }
  } else if (own.status === 'working' && working.length > 0 && own.detail === undefined) {
    rolled = { ...own, detail: `${plural(working.length, 'subagent', 'subagents')} working` }
  }
  return { ...rolled, group: groupOf(rolled.status, input.pinned) }
}

/** Pinned threads keep their glyph but sit above every group; Failed shares the Needs you group (§4.8). */
const groupOf = (status: WorkStatus, pinned: boolean): ThreadStatusGroup => {
  if (pinned) return 'pinned'
  if (status === 'failed') return 'needs-you'
  return status
}

export interface StatusGroupEntry<Thread> {
  readonly thread: Thread
  readonly status: ThreadStatus
  /** Live "came back to you" time: when this browser saw it enter its group, or the derived `status.since`. */
  readonly cameBackAt: number
  /** Manual order for Pinned (lower first); undefined sorts after. */
  readonly pinnedIndex?: number
}

export interface StatusGroup<Thread> {
  readonly group: ThreadStatusGroup
  readonly key: string
  readonly threads: readonly Thread[]
}

/** Every non-empty group in shell order; Pinned keeps the user's pin order, the rest the newest return first. */
const groupEntries = <Thread>(entries: readonly StatusGroupEntry<Thread>[]): readonly StatusGroup<Thread>[] =>
  THREAD_STATUS_GROUPS.flatMap(group => {
    const members = entries.filter(entry => entry.status.group === group)
    if (members.length === 0) return []
    const sorted = [...members].sort((left, right) =>
      group === 'pinned' ? (left.pinnedIndex ?? Number.MAX_SAFE_INTEGER) - (right.pinnedIndex ?? Number.MAX_SAFE_INTEGER) : right.cameBackAt - left.cameBackAt,
    )
    return [{ group, key: `${STATUS_GROUP_KEY_PREFIX}${group}`, threads: sorted.map(entry => entry.thread) }]
  })

/** Done starts folded: it is open only while the user's collapsed list holds its open marker. */
const isCollapsed = (key: string, collapsedGroups: readonly string[]): boolean =>
  key === DONE_GROUP_KEY ? !collapsedGroups.includes(DONE_GROUP_OPEN_KEY) : collapsedGroups.includes(key)

/** The collapsed list after the user toggles one status group header. */
const toggle = (key: string, collapsedGroups: readonly string[]): readonly string[] => {
  const marker = key === DONE_GROUP_KEY ? DONE_GROUP_OPEN_KEY : key
  return collapsedGroups.includes(marker) ? collapsedGroups.filter(entry => entry !== marker) : [...collapsedGroups, marker]
}

/**
 * Remembers when each thread entered its current group, so rows sort by "came back to you" rather than by their last
 * write. A thread first seen takes its derived `since`; a later move into another group takes the moment it moved.
 */
const createTransitionClock = (): ((sessionId: string, group: ThreadStatusGroup, derivedSince: number, now: number) => number) => {
  const seen = new Map<string, { readonly group: ThreadStatusGroup; readonly at: number }>()
  return (sessionId, group, derivedSince, now) => {
    const previous = seen.get(sessionId)
    if (previous !== undefined && previous.group === group) return Math.max(previous.at, derivedSince)
    const at = previous === undefined ? derivedSince : Math.max(derivedSince, now)
    seen.set(sessionId, { group, at })
    return at
  }
}

export class ThreadStatusModel {
  static readonly statusOf = statusOf
  static readonly ownStatus = ownStatus
  static readonly groupOf = groupOf
  static readonly groupEntries = groupEntries
  static readonly isCollapsed = isCollapsed
  static readonly toggle = toggle
  static readonly createTransitionClock = createTransitionClock
  static readonly isInlineVerb = (value: string): value is InlineVerb => INLINE_VERBS.some(verb => verb === value)
}
