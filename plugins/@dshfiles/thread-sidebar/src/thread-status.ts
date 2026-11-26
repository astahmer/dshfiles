/**
 * One status per thread row, in the ADE vocabulary (plan `docs/ade-ux` §4.7), and the groups the default thread list
 * shows: Pinned on top, then Needs you · Working · Ready · Idle · Done. An unsent draft is not a thread in any of those
 * states yet: it is listed in its own Drafts group after Idle, so the Idle count is threads only.
 *
 * "Needs you" and "Failed" are a projection of the inbox (§4.8): an open inbox item about the thread (subject kind
 * `session`) with blocking or failed severity, plus the thread states this sidebar already classifies (a pending
 * question or approval, a usage-limit stop, an interrupted turn). A parent rolls up its subagents, so it never looks
 * finished while a child failed or waits. A thread whose last finished turn failed stays Failed after it is read (the
 * inbox item resolves on reading; the Host's failed-turn record does not), until a later turn runs or the thread is done.
 * Pure: the client passes every input, so tests cover the whole mapping.
 */
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { ThreadAttentionLabel } from './attention-presentation.js'

export const THREAD_STATUS_GROUPS = ['pinned', 'needs-you', 'working', 'ready', 'idle', 'draft', 'done'] as const
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
/** A row's verb: a provider's, or Review, which a failed turn without one offers and which opens it (council round 4 B4). */
export type RowInlineVerb = InlineVerb | 'Review'

/** The inbox source of this sidebar's own items: a finished turn the user has not opened yet. */
export const FINISHED_TURN_SOURCE = 'thread-sidebar.finished-turn'

/** What the inbox says about one thread: its most urgent open item. */
export interface InboxThreadSignal {
  readonly itemId: string
  /** The provider that published the item. */
  readonly source?: string
  readonly severity: 'blocking' | 'failed' | 'ready'
  readonly reason: string
  /** The first provider verb the item offers, if any. */
  readonly verb: InlineVerb | undefined
  /** When the item last became open: the moment the thread "came back to you". */
  readonly openedAt: number
  /** The question it asks, when it carries one; a peek shows it with its choices. */
  readonly detail?: string
  /** Answer choices, for an item the user answers in place (1–9 in a peek). */
  readonly choices?: readonly { readonly id: string; readonly label: string; readonly recommended?: boolean }[]
}

/** The Host's record that the thread's last finished turn failed. */
export interface FailedTurnSignal {
  readonly at: number
  readonly reason: 'error' | 'max-tokens'
}

/**
 * The row's detail is the thing itself (round five B4): the question's start, the command. The glyph and the verb
 * already say that it asks or wants an approval, so the Inbox's `Approve: ` and `Asks: ` lead-ins are dropped.
 */
const VERB_LEAD_IN = /^(?:Approve|Asks):\s*/u
const subjectOf = (reason: string | undefined): string | undefined => {
  if (reason === undefined) return undefined
  const subject = reason.replace(VERB_LEAD_IN, '')
  return subject.length === 0 ? reason : subject
}

/** Why the last turn failed, for the row's detail line. */
const FAILED_TURN_DETAIL = { error: 'Turn failed', 'max-tokens': 'Stopped at the output limit' } as const satisfies Record<FailedTurnSignal['reason'], string>

export interface ThreadStatusInput {
  readonly running: boolean
  readonly pinned: boolean
  readonly archived: boolean
  readonly settled: boolean
  /** Nothing was sent yet: the composer's open draft, or one with text waiting. Listed under Drafts, not Idle. */
  readonly draft?: boolean | undefined
  /** The Host still holds an unacknowledged finish (or a hand unread mark). */
  readonly unread: boolean
  /** The sidebar's own attention labels for this thread (not its children). */
  readonly labels: readonly ThreadAttentionLabel[]
  readonly inbox: InboxThreadSignal | undefined
  /** What the thread waits on, when the list knows it and no inbox item says it (`git push --force…`). */
  readonly waitingDetail?: string | undefined
  /** Set while the thread's last finished turn is a failed one, read or not. */
  readonly failedTurn?: FailedTurnSignal | undefined
  /**
   * Set while the unacknowledged finish is a turn the user stopped (`aborted`) or a gate refused before any step ran
   * (`blocked`): it is not Ready, since nothing in it is the user's to collect.
   */
  readonly stoppedTurn?: 'aborted' | 'blocked' | undefined
  /** Revisions in the thread's own workspace that have not landed; 0 or undefined for none or no workspace. */
  readonly unlanded?: number | undefined
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
  readonly verb: RowInlineVerb | undefined
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
      detail: subjectOf(fromInbox ? inbox.reason : input.waitingDetail),
      verb: (fromInbox ? inbox.verb : undefined) ?? (needsLabel === undefined ? undefined : LABEL_VERB[needsLabel]),
      itemId: fromInbox ? inbox.itemId : undefined,
      since: fromInbox ? inbox.openedAt : input.activityAt,
    }
  }
  const failedLabel = labelFor(FAILED_LABELS)
  if (inbox?.severity === 'failed' || failedLabel !== undefined) {
    const fromInbox = inbox?.severity === 'failed'
    // The finished-turn item's headline leads with the thread title, which the row already shows: say why instead.
    const ownFailure =
      fromInbox && inbox.source === FINISHED_TURN_SOURCE && input.failedTurn !== undefined ? FAILED_TURN_DETAIL[input.failedTurn.reason] : undefined
    return {
      status: 'failed',
      detail: ownFailure ?? (fromInbox ? inbox.reason : undefined),
      // A failed row always offers a verb, like a Needs-you row (council round 4 B4): its provider's, else Review.
      verb: (fromInbox ? inbox.verb : undefined) ?? (failedLabel === undefined ? undefined : LABEL_VERB[failedLabel]) ?? 'Review',
      itemId: fromInbox ? inbox.itemId : undefined,
      since: fromInbox ? inbox.openedAt : input.activityAt,
    }
  }
  if (input.running) return { status: 'working', detail: undefined, verb: undefined, itemId: undefined, since: input.activityAt }
  // Reading a failed thread resolves its inbox item; the failure itself stays until a later turn finishes without failing.
  if (input.failedTurn !== undefined) {
    return { status: 'failed', detail: FAILED_TURN_DETAIL[input.failedTurn.reason], verb: 'Review', itemId: undefined, since: input.failedTurn.at }
  }
  // A stopped finish leaves only its own finished-turn signals (an older Host still publishes that item as ready); another
  // provider's ready item, such as work to land, still counts.
  const otherReady = inbox?.severity === 'ready' && inbox.source !== FINISHED_TURN_SOURCE
  const stoppedOnly = input.stoppedTurn !== undefined && !otherReady
  if (!stoppedOnly && (input.unread || input.labels.includes('threadSidebarTurnFinished') || inbox?.severity === 'ready')) {
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
  // Finished, read, and its work still sits in its own workspace: Ready until it lands (§4.7), whatever its age. The
  // Land verb comes from the inbox item above when a provider publishes one.
  if ((input.unlanded ?? 0) > 0) return { status: 'ready', detail: undefined, verb: undefined, itemId: undefined, since: input.activityAt }
  if (input.now - input.activityAt >= DONE_AFTER_IDLE_MS) {
    return { status: 'done', detail: undefined, verb: undefined, itemId: undefined, since: input.activityAt + DONE_AFTER_IDLE_MS }
  }
  return { status: 'idle', detail: undefined, verb: undefined, itemId: undefined, since: input.activityAt }
}

/** The roll-up's detail lines, from the plugin's locale table (plural keys); this file stays pure and wordless. */
export interface ThreadStatusCopy {
  readonly subagentsNeedYou: (count: number) => string
  readonly subagentsFailed: (count: number) => string
  readonly waitingOnSubagents: (count: number) => string
  readonly subagentsWorking: (count: number) => string
}

/** A row with no children never asks for a roll-up line. */
const NO_ROLLUP: ThreadStatusCopy = {
  subagentsNeedYou: () => '',
  subagentsFailed: () => '',
  waitingOnSubagents: () => '',
  subagentsWorking: () => '',
}

/**
 * The row status of a thread with its subagents rolled up: a child that needs you or failed lifts the parent into
 * Needs you (with detail text naming how many), and a running child keeps an otherwise finished parent Working
 * ("Waiting on 2 subagents").
 */
const statusOf = (input: ThreadStatusInput, children: readonly Omit<ThreadStatus, 'group'>[] = [], copy: ThreadStatusCopy = NO_ROLLUP): ThreadStatus => {
  const own = ownStatus(input)
  const waiting = children.filter(child => child.status === 'needs-you')
  const failed = children.filter(child => child.status === 'failed')
  const working = children.filter(child => child.status === 'working')
  let rolled = own
  if (own.status !== 'needs-you' && own.status !== 'done' && waiting.length > 0) {
    rolled = {
      status: 'needs-you',
      detail: copy.subagentsNeedYou(waiting.length),
      verb: waiting[0]?.verb,
      itemId: waiting[0]?.itemId,
      since: Math.max(...waiting.map(child => child.since)),
    }
  } else if (own.status !== 'needs-you' && own.status !== 'failed' && own.status !== 'done' && failed.length > 0) {
    rolled = {
      status: 'failed',
      detail: copy.subagentsFailed(failed.length),
      verb: failed[0]?.verb,
      itemId: failed[0]?.itemId,
      since: Math.max(...failed.map(child => child.since)),
    }
  } else if ((own.status === 'idle' || own.status === 'ready') && working.length > 0) {
    rolled = {
      status: 'working',
      detail: copy.waitingOnSubagents(working.length),
      verb: undefined,
      itemId: undefined,
      since: own.since,
    }
  } else if (own.status === 'working' && working.length > 0 && own.detail === undefined) {
    rolled = { ...own, detail: copy.subagentsWorking(working.length) }
  }
  return { ...rolled, group: input.draft === true && !input.pinned ? 'draft' : groupOf(rolled.status, input.pinned) }
}

/**
 * A subagent's two statuses (round 21 D4). Its own row reads Failed while its last turn failed (the Host's failed-turn
 * record), so a child whose provider refused it no longer reads Ready or Idle. Its parent's roll-up leaves that failure
 * out: a subagent's failed turn is its parent's tool result, which the parent's own turn answers.
 */
const childStatusOf = (input: ThreadStatusInput): { readonly row: ThreadStatus; readonly rollup: ThreadStatus } => {
  const rollup = statusOf({ ...input, failedTurn: undefined })
  return { row: input.failedTurn === undefined ? rollup : statusOf(input), rollup }
}

/** Pinned threads keep their glyph but sit above every group; Failed shares the Needs you group (§4.8). */
const groupOf = (status: WorkStatus, pinned: boolean): Exclude<ThreadStatusGroup, 'draft'> => {
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

/** How long a row's new group must hold before the row moves there. */
export const GROUP_SETTLE_MS = 600

/**
 * A row moves to another group only once its new group held for {@link GROUP_SETTLE_MS}: at a turn's end the status
 * flips Working, Idle, Working, Ready within a few hundred milliseconds (five group changes in 800 ms measured, F3), and
 * each flip moved the row under the pointer. A row seen for the first time takes its group at once; its glyph never
 * waits, only its seat in the list.
 */
const createGroupSettler = (settleMs: number = GROUP_SETTLE_MS, clock: () => number = Date.now) => {
  const rows = new Map<string, { readonly shown: ThreadStatusGroup; readonly pending: ThreadStatusGroup | undefined; readonly since: number }>()
  return {
    /** The group the row shows now, given the group its status asks for. */
    groupOf(sessionId: string, live: ThreadStatusGroup): ThreadStatusGroup {
      const now = clock()
      const row = rows.get(sessionId)
      if (row === undefined || row.shown === live) {
        rows.set(sessionId, { shown: live, pending: undefined, since: now })
        return live
      }
      if (row.pending !== live) {
        rows.set(sessionId, { shown: row.shown, pending: live, since: now })
        return row.shown
      }
      if (now - row.since >= settleMs) {
        rows.set(sessionId, { shown: live, pending: undefined, since: now })
        return live
      }
      return row.shown
    },
    /** When the earliest waiting move settles, so the list can look again; undefined when none waits. */
    wakeAt(): number | undefined {
      let earliest: number | undefined
      for (const row of rows.values()) {
        if (row.pending === undefined) continue
        const at = row.since + settleMs
        if (earliest === undefined || at < earliest) earliest = at
      }
      return earliest
    },
  }
}

/** The stopped finish a thread's attention record holds, unless the user marked it unread by hand. */
const stoppedTurnOf = (
  record: { readonly finishedReason: string | null; readonly manuallyUnread: boolean } | undefined,
): ThreadStatusInput['stoppedTurn'] => {
  if (record === undefined || record.manuallyUnread) return undefined
  return record.finishedReason === 'aborted' || record.finishedReason === 'blocked' ? record.finishedReason : undefined
}

export class ThreadStatusModel {
  static readonly stoppedTurnOf = stoppedTurnOf
  static readonly statusOf = statusOf
  static readonly childStatusOf = childStatusOf
  static readonly ownStatus = ownStatus
  static readonly groupOf = groupOf
  static readonly groupEntries = groupEntries
  static readonly isCollapsed = isCollapsed
  static readonly toggle = toggle
  static readonly createTransitionClock = createTransitionClock
  static readonly createGroupSettler = createGroupSettler
  static readonly isInlineVerb = (value: string): value is InlineVerb => INLINE_VERBS.some(verb => verb === value)
}
