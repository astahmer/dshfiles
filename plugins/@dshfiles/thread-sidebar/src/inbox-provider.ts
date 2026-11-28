import { attentionApi, type AttentionDraft, type AttentionItem } from '@dshfiles/activity-timeline/attention-api'
import { Api, DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Effect, Layer, Stream } from 'effect'
import { threadSidebarAttentionApi, type FailedTurn, type ThreadAttentionView } from './attention-api.js'
import { ThreadAttention } from './attention-store.js'
import { FailedTurns } from './failed-turns.js'
import { PendingApprovals, type PendingApproval } from './pending-approvals.js'
import { SessionLineage } from './session-lineage.js'
import { FINISHED_TURN_SOURCE } from './thread-status.js'

export { FINISHED_TURN_SOURCE }

/** The inbox source of this sidebar's tool approvals: one blocking item per pending ask, resolved when it settles. */
export const APPROVAL_SOURCE = 'thread-sidebar.approval'

const RECONCILE_DEBOUNCE = '250 millis'

/**
 * The headline leads with the thread's title (“Fix auth callback” finished · ready to review), so a list of finished
 * turns reads as a list of threads; without a title it falls back to the generic sentence.
 */
const FINISH_COPY = {
  completed: { reason: 'Turn finished; ready to review.', titled: 'finished · ready to review', severity: 'ready' },
  // Stopped by the user, or refused by a gate before any step ran: nothing to collect, so an info item rather than Ready.
  // A gate the user must clear (a usage limit) publishes its own blocking item.
  aborted: { reason: 'Turn stopped before it finished.', titled: 'stopped before it finished', severity: 'info' },
  blocked: { reason: 'Turn ended without running a step.', titled: 'ended without running a step', severity: 'info' },
  error: { reason: 'Turn failed.', titled: 'failed', severity: 'failed' },
  'max-tokens': { reason: 'Turn stopped at the output token limit.', titled: 'stopped at the output token limit', severity: 'failed' },
} as const satisfies Record<
  NonNullable<ThreadAttentionView['finishedReason']>,
  { readonly reason: string; readonly titled: string; readonly severity: 'ready' | 'failed' | 'info' }
>

/** Inbox reasons cap at 500 characters; a long title is cut so the state words always show. */
const MAX_TITLE_IN_REASON = 160

const headline = (title: string | undefined, sentence: string, titled: string): string => {
  if (title === undefined) return sentence
  const shown = title.length > MAX_TITLE_IN_REASON ? `${title.slice(0, MAX_TITLE_IN_REASON - 1).trimEnd()}…` : title
  return `“${shown}” ${titled}`
}

const FAILED_REASONS: ReadonlySet<ThreadAttentionView['finishedReason']> = new Set(['error', 'max-tokens'])

/** Session id → the thread the user acts on (itself, or a subagent's top-level ancestor). */
export type RootOf = ReadonlyMap<string, string>

const rootIn = (roots: RootOf, sessionId: string): string => roots.get(sessionId) ?? sessionId

/**
 * The subagent turns that roll up into a parent's finished turn: those that finished no later than it, so a child
 * finishing after the parent's turn shows with the parent's next turn instead of reopening an item already marked Done.
 */
const childLine = (parent: ThreadAttentionView, children: readonly ThreadAttentionView[]): string | undefined => {
  const parentFinishedAt = parent.finishedAt
  if (parentFinishedAt === null) return undefined
  const finished = children.filter(child => child.finishedAt !== null && child.finishedAt <= parentFinishedAt)
  if (finished.length === 0) return undefined
  const failed = finished.filter(child => FAILED_REASONS.has(child.finishedReason)).length
  const turns = `${String(finished.length)} subagent ${finished.length === 1 ? 'turn' : 'turns'} finished`
  return failed === 0 ? `${turns}.` : `${turns}; ${String(failed)} failed.`
}

/**
 * One unacknowledged thread as an inbox item. Each finished turn is its own occurrence (keyed by the turn's sequence),
 * so a later turn shows again even after the user marked an earlier one done; a hand-made unread mark is one item.
 */
const draftOf = (view: ThreadAttentionView, children: readonly ThreadAttentionView[] = [], title?: string): AttentionDraft | null => {
  if (view.finishedAt !== null && view.finishedReason !== null) {
    const copy = FINISH_COPY[view.finishedReason]
    const detail = childLine(view, children)
    const draft: AttentionDraft = {
      dedupeKey: `${view.sessionId}:turn:${String(view.finishedSeq ?? view.finishedAt)}`,
      subject: { kind: 'session', id: view.sessionId },
      reason: headline(title, copy.reason, copy.titled),
      severity: copy.severity,
      verbs: ['Open', 'Done', 'Snooze', 'MuteSource'],
    }
    return detail === undefined ? draft : { ...draft, detail }
  }
  if (view.manuallyUnread) {
    return {
      dedupeKey: `${view.sessionId}:unread`,
      subject: { kind: 'session', id: view.sessionId },
      reason: headline(title, 'Marked unread.', 'marked unread'),
      severity: 'ready',
      verbs: ['Open', 'Done', 'Snooze', 'MuteSource'],
    }
  }
  return null
}

/**
 * The thread record an inbox item was drawn from, when that item is still this thread's current draft: Done on an older
 * turn's item must not clear a newer finish.
 */
const viewForDoneItem = (
  item: Pick<AttentionItem, 'source' | 'dedupeKey' | 'subject'>,
  views: Iterable<ThreadAttentionView>,
): ThreadAttentionView | undefined => {
  if (item.source !== FINISHED_TURN_SOURCE || item.subject.kind !== 'session') return undefined
  for (const view of views) {
    if (view.sessionId !== item.subject.id) continue
    return draftOf(view)?.dedupeKey === item.dedupeKey ? view : undefined
  }
  return undefined
}

/**
 * Inbox items for the threads a user acts on (plan E1): a subagent Session publishes nothing of its own; its finished
 * turns roll up into its parent thread's item as one line. Without a known root a Session counts as its own thread.
 */
const draftsOf = (
  views: Iterable<ThreadAttentionView>,
  roots: RootOf = new Map(),
  titles: ReadonlyMap<string, string> = new Map(),
  /** Threads whose failure {@link failedDraftsOf} publishes; their finished-turn item would resolve on opening. */
  failedSessionIds: ReadonlySet<string> = new Set(),
): readonly AttentionDraft[] => {
  const all = [...views]
  const childrenOf = new Map<string, ThreadAttentionView[]>()
  for (const view of all) {
    const root = rootIn(roots, view.sessionId)
    if (root === view.sessionId) continue
    childrenOf.set(root, [...(childrenOf.get(root) ?? []), view])
  }
  return all.flatMap(view => {
    if (rootIn(roots, view.sessionId) !== view.sessionId) return []
    // One item per thread: while its failure is kept, that item stands for it (an unread mark included).
    if (failedSessionIds.has(view.sessionId)) return []
    const draft = draftOf(view, childrenOf.get(view.sessionId), titles.get(view.sessionId))
    return draft === null ? [] : [draft]
  })
}

const FAILED_KEY = ':failed:'

/**
 * A failed turn of a top-level thread as an inbox item, drawn from the durable failed record rather than the unread one:
 * opening the thread does not resolve it; a later turn that does not fail, or Done, does (DESIGN.md: a failed turn stays
 * in Needs you, in the list and in the Inbox, until it is retried or marked Done).
 */
const failedDraftsOf = (failed: readonly FailedTurn[], roots: RootOf = new Map(), titles: ReadonlyMap<string, string> = new Map()): readonly AttentionDraft[] =>
  failed.flatMap(turn => {
    if (rootIn(roots, turn.sessionId) !== turn.sessionId) return []
    const copy = FINISH_COPY[turn.reason]
    return [
      {
        dedupeKey: `${turn.sessionId}${FAILED_KEY}${String(turn.failedAt)}`,
        subject: { kind: 'session', id: turn.sessionId },
        reason: headline(titles.get(turn.sessionId), copy.reason, copy.titled),
        severity: copy.severity,
        verbs: ['Open', 'Done', 'Snooze', 'MuteSource'],
      } satisfies AttentionDraft,
    ]
  })

/** The thread whose failure an inbox item stands for, when it is one of {@link failedDraftsOf}'s items. */
const failedSessionOfItem = (item: Pick<AttentionItem, 'source' | 'dedupeKey' | 'subject'>): string | undefined =>
  item.source === FINISHED_TURN_SOURCE && item.subject.kind === 'session' && item.dedupeKey.startsWith(`${item.subject.id}${FAILED_KEY}`)
    ? item.subject.id
    : undefined

/** Inbox reasons and details cap at 500 and 2000 characters. */
const cap = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text)

/**
 * One blocking item per pending approval (D4): the reason names what it asks (`Approve: Clear the cache and force-push
 * main`), the detail holds the whole command, and its only action opens the thread at the approval card, where it is
 * decided; the Inbox labels it Review. It resolves when the approval settles or the turn ends.
 */
const approvalDraftsOf = (approvals: readonly PendingApproval[]): readonly AttentionDraft[] =>
  approvals.map(approval => {
    const subject = approval.description ?? approval.command ?? approval.reason ?? approval.toolName
    const draft: AttentionDraft = {
      dedupeKey: cap(`${approval.sessionId}:approval:${approval.id}`, 256),
      subject: { kind: 'session', id: approval.sessionId },
      reason: cap(`Approve: ${subject.replace(/\s+/g, ' ').trim()}`, 500),
      severity: 'blocking',
      verbs: ['Open', 'Snooze', 'MuteSource'],
    }
    return approval.command === undefined || approval.command.trim() === '' ? draft : { ...draft, detail: cap(approval.command, 2000) }
  })

/**
 * Subagent records to clear because their parent thread was read: the parent had a record at the previous reconcile
 * (`'all'` on the first one, which also clears the records stored before this roll-up existed) and has none now. A
 * child that finished while its parent is still running stays, to roll up when the parent's turn finishes.
 */
const staleChildren = (
  views: Iterable<ThreadAttentionView>,
  roots: RootOf,
  previousRoots: ReadonlySet<string> | 'all',
): ReadonlyArray<{ readonly sessionId: string; readonly version: number }> => {
  const all = [...views]
  const present = new Set(all.filter(view => rootIn(roots, view.sessionId) === view.sessionId).map(view => view.sessionId))
  return all.flatMap(view => {
    const root = rootIn(roots, view.sessionId)
    if (root === view.sessionId || present.has(root)) return []
    if (previousRoots !== 'all' && !previousRoots.has(root)) return []
    return [{ sessionId: view.sessionId, version: view.version }]
  })
}

const rootSessionIds = (views: Iterable<ThreadAttentionView>, roots: RootOf): ReadonlySet<string> =>
  new Set([...views].filter(view => rootIn(roots, view.sessionId) === view.sessionId).map(view => view.sessionId))

const make = Effect.gen(function* () {
  const attention = yield* ThreadAttention
  const failedTurns = yield* FailedTurns
  const approvals = yield* PendingApprovals
  const lineage = yield* SessionLineage
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)
  let previousRoots: ReadonlySet<string> | 'all' = 'all'

  /**
   * Opening a thread acknowledges it here, so its item resolves in the inbox on the next reconcile. A subagent's item
   * published before the roll-up is no longer listed, so this same reconcile resolves it into Closed once.
   */
  const reconcile = Effect.fn('thread-sidebar attention reconcile')(function* () {
    const views = (yield* attention.snapshot).sessions
    const roots = new Map<string, string>(
      yield* Effect.forEach(views, view => lineage.rootOf(view.sessionId).pipe(Effect.map(root => [view.sessionId, root] as const))),
    )
    const stale = staleChildren(views, roots, previousRoots)
    previousRoots = rootSessionIds(views, roots)
    if (stale.length > 0) yield* attention.clearUnreadMany(stale)
    yield* Effect.annotateCurrentSpan({ 'attention.records': views.length, 'attention.children_cleared': stale.length })
    if (!(yield* apis.isServed(attentionApi))) return
    const failed = yield* failedTurns.list
    const failedRoots = new Map<string, string>(
      yield* Effect.forEach(failed, turn => lineage.rootOf(turn.sessionId).pipe(Effect.map(root => [turn.sessionId, root] as const))),
    )
    const failedIds = new Set(failed.filter(turn => rootIn(failedRoots, turn.sessionId) === turn.sessionId).map(turn => turn.sessionId))
    const titles = yield* lineage.titles([...new Set([...rootSessionIds(views, roots), ...failedIds])])
    const items = [...draftsOf(views, roots, titles, failedIds), ...failedDraftsOf(failed, failedRoots, titles)]
    yield* Effect.annotateCurrentSpan({ 'attention.items': items.length })
    yield* inbox.reconcile({ source: FINISHED_TURN_SOURCE, items: [...items] })
  })

  const reconcileApprovals = Effect.fn('thread-sidebar approval reconcile')(function* () {
    if (!(yield* apis.isServed(attentionApi))) return
    const items = approvalDraftsOf(yield* approvals.list)
    yield* Effect.annotateCurrentSpan({ 'attention.items': items.length })
    yield* inbox.reconcile({ source: APPROVAL_SOURCE, items: [...items] })
  })

  /**
   * Done in the inbox is read here too (plan §4.8, both ways): the thread's records clear, its row loses the unread dot,
   * and the next reconcile resolves the item.
   */
  const acknowledgeDone = Effect.fn('thread-sidebar attention done')(function* (item: AttentionItem) {
    const failedSessionId = failedSessionOfItem(item)
    if (failedSessionId !== undefined) {
      // Done on a failure clears it in the list too; the unread record of the same thread goes with it.
      const cleared = yield* failedTurns.clear(failedSessionId)
      const view = (yield* attention.snapshot).sessions.find(candidate => candidate.sessionId === failedSessionId)
      if (view !== undefined) yield* attention.clearUnread({ sessionId: view.sessionId, version: view.version })
      yield* Effect.annotateCurrentSpan({ 'attention.matched': cleared })
      yield* Api.publish({ contract: threadSidebarAttentionApi, event: 'changed', payload: { revision: (yield* attention.snapshot).revision } }).pipe(
        Effect.catchTag('PublishEventError', error => Effect.logWarning('thread-sidebar: attention change event refused', error.message)),
      )
      yield* reconcile()
      return
    }
    const view = viewForDoneItem(item, (yield* attention.snapshot).sessions)
    yield* Effect.annotateCurrentSpan({ 'attention.matched': view !== undefined })
    if (view === undefined) return
    // Done means read: a hand unread mark on the same thread goes too, or it would come back as a new item at once.
    yield* attention.clearUnread({ sessionId: view.sessionId, version: view.version })
  })
  yield* HostEvents.stream('dshfiles/attention/done').pipe(
    Stream.runForEach(([payload]) =>
      acknowledgeDone(payload.item).pipe(Effect.catchCause(cause => Effect.logWarning('thread-sidebar: inbox done not applied', cause))),
    ),
    DshxPlugin.detached,
    Effect.forkScoped,
  )

  // Every page's row dots re-read at once, so a thread read in one place (an Inbox Done, another tab) clears everywhere.
  yield* attention.changes.pipe(
    Stream.runForEach(() =>
      attention.snapshot.pipe(
        Effect.flatMap(snapshot => Api.publish({ contract: threadSidebarAttentionApi, event: 'changed', payload: { revision: snapshot.revision } })),
        Effect.catchTag('PublishEventError', error => Effect.logWarning('thread-sidebar: attention change event refused', error.message)),
      ),
    ),
    DshxPlugin.detached,
    Effect.forkScoped,
  )

  yield* Stream.mergeAll([Stream.succeed(undefined), Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined), attention.changes], {
    concurrency: 'unbounded',
  }).pipe(
    Stream.debounce(RECONCILE_DEBOUNCE),
    Stream.runForEach(() => reconcile().pipe(Effect.catchCause(cause => Effect.logWarning('thread-sidebar: inbox reconcile failed', cause)))),
    DshxPlugin.detached,
    Effect.forkScoped,
  )

  yield* Stream.mergeAll([Stream.succeed(undefined), Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined), approvals.changes], {
    concurrency: 'unbounded',
  }).pipe(
    Stream.debounce(RECONCILE_DEBOUNCE),
    Stream.runForEach(() =>
      reconcileApprovals().pipe(Effect.catchCause(cause => Effect.logWarning('thread-sidebar: approval reconcile failed', cause))),
    ),
    DshxPlugin.detached,
    Effect.forkScoped,
  )
})

/**
 * thread-sidebar as an inbox provider: unacknowledged finished turns of top-level threads are Ready items, failed turns
 * Failed items until retried or Done, and pending tool approvals blocking items.
 */
export class FinishedTurnAttention {
  static readonly layer = Layer.effectDiscard(make)
  static readonly draftsOf = draftsOf
  static readonly failedDraftsOf = failedDraftsOf
  static readonly failedSessionOfItem = failedSessionOfItem
  static readonly approvalDraftsOf = approvalDraftsOf
  static readonly staleChildren = staleChildren
  static readonly viewForDoneItem = viewForDoneItem
}
