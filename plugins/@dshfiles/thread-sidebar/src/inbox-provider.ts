import { attentionApi, type AttentionDraft, type AttentionItem } from '@dshfiles/activity-timeline/attention-api'
import { Api, DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Effect, Layer, Stream } from 'effect'
import { threadSidebarAttentionApi, type ThreadAttentionView } from './attention-api.js'
import { ThreadAttention } from './attention-store.js'
import { SessionLineage } from './session-lineage.js'

/** The inbox source of finished turns the user has not opened yet. */
export const FINISHED_TURN_SOURCE = 'thread-sidebar.finished-turn'

const RECONCILE_DEBOUNCE = '250 millis'

/**
 * The headline leads with the thread's title (“Fix auth callback” finished · ready to review), so a list of finished
 * turns reads as a list of threads; without a title it falls back to the generic sentence.
 */
const FINISH_COPY = {
  completed: { reason: 'Turn finished; ready to review.', titled: 'finished · ready to review', severity: 'ready' },
  aborted: { reason: 'Turn stopped before it finished.', titled: 'stopped before it finished', severity: 'ready' },
  blocked: { reason: 'Turn ended without running a step.', titled: 'ended without running a step', severity: 'ready' },
  error: { reason: 'Turn failed.', titled: 'failed', severity: 'failed' },
  'max-tokens': { reason: 'Turn stopped at the output token limit.', titled: 'stopped at the output token limit', severity: 'failed' },
} as const satisfies Record<
  NonNullable<ThreadAttentionView['finishedReason']>,
  { readonly reason: string; readonly titled: string; readonly severity: 'ready' | 'failed' }
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
    const draft = draftOf(view, childrenOf.get(view.sessionId), titles.get(view.sessionId))
    return draft === null ? [] : [draft]
  })
}

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
    const titles = yield* lineage.titles([...rootSessionIds(views, roots)])
    const items = draftsOf(views, roots, titles)
    yield* Effect.annotateCurrentSpan({ 'attention.items': items.length })
    yield* inbox.reconcile({ source: FINISHED_TURN_SOURCE, items: [...items] })
  })

  /**
   * Done in the inbox is read here too (plan §4.8, both ways): the thread's records clear, its row loses the unread dot,
   * and the next reconcile resolves the item.
   */
  const acknowledgeDone = Effect.fn('thread-sidebar attention done')(function* (item: AttentionItem) {
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
})

/** thread-sidebar as an inbox provider: unacknowledged finished turns of top-level threads are Ready (or Failed) items. */
export class FinishedTurnAttention {
  static readonly layer = Layer.effectDiscard(make)
  static readonly draftsOf = draftsOf
  static readonly staleChildren = staleChildren
  static readonly viewForDoneItem = viewForDoneItem
}
