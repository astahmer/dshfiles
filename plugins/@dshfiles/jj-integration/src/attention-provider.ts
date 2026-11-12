import { attentionApi, type AttentionActOutcome, type AttentionActRequest, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { JjViewReads } from '@dshfiles/jj-cli'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Clock, Context, Effect, Layer, Queue, Ref, Stream } from 'effect'
import type { RepositoryView, ThreadView } from './api.js'
import { SessionReads } from './host-edges-promise.js'
import { Landing, LandingMessages } from './landing.js'
import { RepositoryViews } from './repository-views.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import { handleAttentionActs } from './attention-act-promise.js'

/** Thread workspaces whose revisions conflict, or whose queued land stopped: Land is blocked. */
export const LAND_BLOCKED_SOURCE = 'jj-integration.land-blocked'
/** Thread workspaces with described revisions not yet on the bookmark: one item per workspace, updated in place. */
export const READY_TO_LAND_SOURCE = 'jj-integration.ready-to-land'

const RECONCILE_DEBOUNCE = '500 millis'
/** Session events arrive in bursts while a turn streams; a finished turn can make a workspace ready. */
const SESSION_SETTLE = '5 seconds'
/**
 * A repository scan costs jj processes per thread, so the safety pass is slow; the views cache answers in between and
 * scans again at most once per minute.
 */
const RECONCILE_SAFETY_INTERVAL = '2 minutes'

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)
const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/** A queued land that stopped for another reason than a busy thread; in memory, so a restart forgets it. */
export interface QueuedLandFailure {
  readonly path: string
  readonly message: string
  readonly at: number
}

/**
 * A workspace is named by its thread (b:212a); with no thread title it reads "Untitled thread in <project>", never by
 * its folder name or the registered "<project> · <folder>" title.
 */
const projectOf = (thread: ThreadView): string => {
  const prefix = thread.workspaceTitle?.split(' · ')[0]?.trim()
  if (prefix !== undefined && prefix !== '') return prefix
  const parent = thread.path.replace(/\/+$/u, '').split('/').slice(0, -1).at(-1) ?? ''
  return parent.endsWith('-threads') ? parent.slice(0, -'-threads'.length) : parent
}
const titleOf = (thread: ThreadView, threadTitle?: string): string => threadTitle ?? `Untitled thread in ${projectOf(thread)}`

/** The thread's newest conversation, so Open lands on it; a workspace nobody opened is named by its title. */
const subjectOf = (thread: ThreadView): AttentionDraft['subject'] => {
  const sessionId = thread.sessionIds.at(-1)
  return sessionId === undefined ? { kind: 'workspace', id: clamp(thread.path, 512), label: clamp(titleOf(thread), 200) } : { kind: 'session', id: sessionId }
}

/** What a workspace's unlanded revisions change, from `jj diff --stat` over them. */
export interface DiffStat {
  readonly files: number
  readonly added: number
  readonly removed: number
}

/** What a ready item names besides the workspace: the thread's title, and the diff stat when jj could compute it. */
export interface ReadyFacts {
  readonly threadTitle?: string | undefined
  readonly stat?: DiffStat | undefined
}

/** The last line of `jj diff --stat`: `3 files changed, 120 insertions(+), 14 deletions(-)`. */
const parseDiffStat = (output: string): DiffStat | undefined => {
  const summary = output
    .trim()
    .split('\n')
    .at(-1)
    ?.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/u)
  if (summary === undefined || summary === null) return undefined
  return { files: Number(summary[1]), added: Number(summary[2] ?? 0), removed: Number(summary[3] ?? 0) }
}

/** One line of what landing brings: `3 files, +120 −14 · feat(auth): add login · 2 more revisions`. */
const changedLine = (thread: ThreadView, stat: DiffStat | undefined): string => {
  // jj lists unlanded work newest first; the oldest revision is where the thread's change starts.
  const first = thread.unlanded.at(-1)?.description.split('\n')[0]?.trim() ?? ''
  const more = thread.unlanded.length - 1
  return [
    stat === undefined ? plural(thread.unlanded.length, 'revision') : `${plural(stat.files, 'file')}, +${String(stat.added)} −${String(stat.removed)}`,
    first === '' ? undefined : first,
    stat === undefined || more === 0 ? undefined : `${String(more)} more ${more === 1 ? 'revision' : 'revisions'}`,
  ]
    .filter(part => part !== undefined)
    .join(' · ')
}

/**
 * The one Ready item of a workspace with described work to land. Its key is the workspace, so a later state updates the
 * same item in place. The headline only names the thread; what changed is the detail, which the inbox updates without
 * reopening an item the user marked Done (plan E2: a ready-to-land item never re-fires).
 */
const readyDraftOf = (thread: ThreadView, facts: ReadyFacts = {}): AttentionDraft => {
  const title = titleOf(thread, facts.threadTitle)
  return {
    dedupeKey: `${thread.path}:ready`,
    subject: subjectOf(thread),
    reason: clamp(`“${title}” is ready to land.`, 500),
    detail: clamp(changedLine(thread, facts.stat), 2000),
    severity: 'ready',
    verbs: ['Land', 'Open', 'Done', 'Snooze', 'MuteSource'],
  }
}

/** What happens to a workspace's ready item this pass: publish it, resolve it, or leave it as it is. */
export type ReadyFate = 'publish' | 'resolve' | 'keep'

/**
 * A ready item resolves only when there is nothing left to land (landed, emptied, workspace gone) or Land is blocked
 * (the Failed item takes over). A thread that is merely busy, asking, still describing its revisions, unverified or
 * queued keeps its item untouched, so a workspace that flips between busy and idle shows one item, not one per idle.
 */
const readyFateOf = (thread: ThreadView): ReadyFate => {
  if (thread.missing || thread.unlanded.length === 0) return 'resolve'
  const assessment = ThreadIntegrationModel.assess({ thread, running: false, waitingForInput: false, integrationAllowed: thread.canRebase })
  if (assessment.category === 'conflicts') return 'resolve'
  if (assessment.category === 'ready' && thread.integrationQueuedAt === undefined) return 'publish'
  return 'keep'
}

/**
 * The Failed items one thread workspace states, from the same assessment the integration dashboard uses: conflicts
 * block Land, and so does a queued land that stopped. Ready work is stated separately (`readyDraftOf`).
 */
const blockedDraftsOfThread = (thread: ThreadView, failure: QueuedLandFailure | undefined, threadTitle?: string): readonly AttentionDraft[] => {
  if (thread.missing) return []
  const assessment = ThreadIntegrationModel.assess({ thread, running: false, waitingForInput: false, integrationAllowed: thread.canRebase })
  const title = titleOf(thread, threadTitle)
  const subject = subjectOf(thread)
  if (assessment.category === 'conflicts') {
    const conflicted = thread.unlanded.filter(revision => revision.conflict).map(revision => revision.changeId.slice(0, 12))
    return [
      {
        dedupeKey: `${thread.path}:conflict`,
        subject,
        reason: clamp(`“${title}” has ${plural(assessment.conflictedRevisions, 'conflicted revision')}; Land is blocked.`, 500),
        detail: clamp(
          `Conflicted: ${conflicted.join(', ')}. Resolve them in the thread (ask its agent, or run jj resolve in the workspace), then Retry.`,
          2000,
        ),
        severity: 'failed',
        verbs: ['Retry', 'Open', 'Done', 'Snooze', 'MuteSource'],
      },
    ]
  }
  if (failure !== undefined && thread.unlanded.length > 0) {
    return [
      {
        dedupeKey: `${thread.path}:queued-land`,
        subject,
        reason: clamp(`The queued land of “${title}” stopped before rebasing.`, 500),
        detail: clamp(`${failure.message} Fix the cause, then Retry.`, 2000),
        severity: 'failed',
        verbs: ['Retry', 'Open', 'Done', 'Snooze', 'MuteSource'],
      },
    ]
  }
  return []
}

/** Every Failed item to reconcile, and the fate of every workspace's ready item. */
const draftsOf = (
  repositories: readonly RepositoryView[],
  failures: ReadonlyMap<string, QueuedLandFailure>,
  facts: ReadonlyMap<string, ReadyFacts> = new Map(),
) => {
  const blocked: AttentionDraft[] = []
  const ready: AttentionDraft[] = []
  const resolve: string[] = []
  for (const repository of repositories)
    for (const thread of repository.threads) {
      blocked.push(...blockedDraftsOfThread(thread, failures.get(thread.path), facts.get(thread.path)?.threadTitle))
      const fate = failures.has(thread.path) && thread.unlanded.length > 0 ? 'resolve' : readyFateOf(thread)
      if (fate === 'publish') ready.push(readyDraftOf(thread, facts.get(thread.path)))
      else if (fate === 'resolve') resolve.push(`${thread.path}:ready`)
    }
  return { blocked, ready, resolve }
}

const refused = (message: string): AttentionActOutcome => ({ ok: false, message })

const pathOf = (request: AttentionActRequest): string => request.item.dedupeKey.replace(/:(?:conflict|queued-land|ready)$/u, '')

/** The workspaces' revisions as one revset of their commits, for a diff over everything landing would bring. */
const unlandedRevset = (thread: ThreadView): string => thread.unlanded.map(revision => revision.commitId).join(' | ')

const make = Effect.gen(function* () {
  const views = yield* RepositoryViews
  const landing = yield* Landing
  const sessions = yield* SessionReads
  const jj = yield* JjViewReads
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)
  const failures = yield* Ref.make<ReadonlyMap<string, QueuedLandFailure>>(new Map())
  const pokes = yield* Queue.sliding<void>(1)
  /** Ready keys this process published; a workspace that left the list resolves through it. */
  const stated = yield* Ref.make<ReadonlySet<string>>(new Set())
  /** The first pass also resolves ready items stored before a restart whose workspace is gone. */
  const firstPass = yield* Ref.make(true)

  /** One diff stat per workspace; a repeat over the same commit ids is answered from the view-read cache at any operation head. */
  const statOf = (thread: ThreadView) =>
    jj.read({ args: ['--ignore-working-copy', 'diff', '--stat', '-r', unlandedRevset(thread)], cwd: thread.path }).pipe(
      Effect.map(output => (output.exitCode === 0 ? parseDiffStat(output.stdout) : undefined)),
      Effect.orElseSucceed(() => undefined),
    )

  const factsOf = Effect.fnUntraced(function* (threads: readonly ThreadView[], titledOnly: readonly ThreadView[] = []) {
    const sessionIds = [...threads, ...titledOnly].flatMap(thread => thread.sessionIds.slice(-1))
    const activity = sessionIds.length === 0 ? new Map() : yield* sessions.listActivity(sessionIds).pipe(Effect.orElseSucceed(() => new Map()))
    const facts = new Map<string, ReadyFacts>()
    // One workspace after another: each new stat is a jj process; unchanged unlanded work is answered from the cache.
    const stats = yield* Effect.forEach(threads, statOf)
    for (const [index, thread] of threads.entries()) {
      const sessionId = thread.sessionIds.at(-1)
      const title = sessionId === undefined ? undefined : activity.get(sessionId)?.title
      facts.set(thread.path, { threadTitle: typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined, stat: stats[index] })
    }
    for (const thread of titledOnly) {
      const sessionId = thread.sessionIds.at(-1)
      const title = sessionId === undefined ? undefined : activity.get(sessionId)?.title
      facts.set(thread.path, { threadTitle: typeof title === 'string' && title.trim() !== '' ? title.trim() : undefined })
    }
    return facts
  })

  /** Ready keys of this source still open in the inbox (any open view), for the first pass after a restart. */
  const storedReadyKeys = Effect.gen(function* () {
    const views = yield* Effect.forEach(['other', 'snoozed', 'muted'] as const, view => inbox.list({ view, limit: 200 }))
    return views.flatMap(list => list.items.filter(item => item.source === READY_TO_LAND_SOURCE).map(item => item.dedupeKey))
  })

  /**
   * State every blocked workspace, and publish or resolve each workspace's one ready item; a stale view is read fresh
   * first, so a fixed conflict leaves the inbox.
   */
  const reconcile = Effect.fn('jj-integration attention reconcile')(function* () {
    if (!(yield* apis.isServed(attentionApi))) return
    const snapshot = yield* views.snapshot
    if (snapshot.refreshFailed) return
    const repositories = snapshot.refreshing ? yield* views.list : snapshot.repositories
    const threads = repositories.flatMap(repository => repository.threads)
    const currentFailures = yield* Ref.get(failures)
    const readyThreads = threads.filter(thread => readyFateOf(thread) === 'publish' && !currentFailures.has(thread.path))
    // Blocked items name their thread too; only ready ones need the diff stat.
    const blockedThreads = threads.filter(
      thread => !thread.missing && (currentFailures.has(thread.path) || thread.unlanded.some(revision => revision.conflict)) && !readyThreads.includes(thread),
    )
    const { blocked, ready, resolve } = draftsOf(repositories, currentFailures, yield* factsOf(readyThreads, blockedThreads))
    const present = new Set(threads.map(thread => `${thread.path}:ready`))
    const previously = yield* Ref.get(stated)
    const first = yield* Ref.getAndSet(firstPass, false)
    const before = first ? yield* storedReadyKeys.pipe(Effect.orElseSucceed(() => [])) : []
    const known = new Set([...previously, ...before])
    const vanished = [...known].filter(key => !present.has(key))
    // Only keys that can hold an item: every landed workspace on every pass would be one call per workspace per event.
    const resolveNow = first ? resolve : resolve.filter(key => known.has(key))
    yield* Effect.annotateCurrentSpan({
      'attention.blocked': blocked.length,
      'attention.ready': ready.length,
      'attention.resolved': resolveNow.length + vanished.length,
    })
    yield* inbox.reconcile({ source: LAND_BLOCKED_SOURCE, items: blocked })
    yield* Effect.forEach(ready, draft => inbox.publish({ source: READY_TO_LAND_SOURCE, ...draft }), { discard: true })
    yield* Effect.forEach([...new Set([...resolveNow, ...vanished])], dedupeKey => inbox.resolve({ source: READY_TO_LAND_SOURCE, dedupeKey }), {
      discard: true,
    })
    const resolved = new Set(resolve)
    const kept = [...known].filter(key => present.has(key) && !resolved.has(key))
    yield* Ref.set(stated, new Set([...kept, ...ready.map(draft => draft.dedupeKey)]))
  })

  /** Land and Retry run the same guarded land the dashboard's button runs, only because the user chose it. */
  const act = Effect.fn('jj-integration attention act')(function* (request: AttentionActRequest) {
    if (request.verb !== 'Land' && request.verb !== 'Retry') return refused('Workspace items take Land or Retry here; open the thread for anything else.')
    const path = pathOf(request)
    const outcome = yield* landing.land({ path, sessionId: undefined, fromAgent: false }).pipe(Effect.result)
    yield* Ref.update(failures, current => {
      const next = new Map(current)
      next.delete(path)
      return next
    })
    yield* Queue.offer(pokes, undefined)
    if (outcome._tag === 'Failure') {
      if (outcome.failure._tag === 'IntegrationQueued') return { ok: true, message: 'Queued: it lands as soon as every thread in the workspace is idle.' }
      return refused(outcome.failure.message)
    }
    const result = outcome.success
    if (result.status === 'landed') return { ok: true, message: `Landed ${plural(result.revisions.length, 'revision')} on ${result.bookmark}.` }
    return refused(LandingMessages.forResult(result) ?? `Nothing landed (${result.status}).`)
  })

  const owns = (source: string): boolean => source === LAND_BLOCKED_SOURCE || source === READY_TO_LAND_SOURCE
  yield* handleAttentionActs(request =>
    owns(request.item.source)
      ? act(request).pipe(Effect.catchCause(() => Effect.succeed(refused('Landing failed on the Host. Open the Land view and try there.'))))
      : Effect.succeed(undefined),
  )

  yield* Stream.mergeAll(
    [
      Stream.succeed(undefined),
      Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined),
      Stream.map(HostEvents.stream('session/event').pipe(Stream.debounce(SESSION_SETTLE)), () => undefined),
      Stream.fromQueue(pokes),
      Stream.map(Stream.tick(RECONCILE_SAFETY_INTERVAL), () => undefined),
    ],
    { concurrency: 'unbounded' },
  ).pipe(
    Stream.debounce(RECONCILE_DEBOUNCE),
    Stream.runForEach(() => reconcile().pipe(Effect.catchCause(cause => Effect.logWarning('jj-integration: inbox reconcile failed', cause)))),
    DshxPlugin.detached,
    Effect.forkScoped,
  )

  return {
    /** Re-read the workspaces now, e.g. after a land from the Changes facet or the Land view, so a landed item resolves at once. */
    refresh: Queue.offer(pokes, undefined).pipe(Effect.asVoid),
    /** A queued land stopped: say so in the inbox until a land of that workspace is tried again. */
    queuedLandFailed: (path: string, message: string) =>
      Effect.flatMap(Clock.currentTimeMillis, at =>
        Ref.update(failures, current => new Map([...current, [path, { path, message, at }]])).pipe(Effect.andThen(Queue.offer(pokes, undefined))),
      ),
    queuedLandSucceeded: (path: string) =>
      Ref.update(failures, current => {
        if (!current.has(path)) return current
        const next = new Map(current)
        next.delete(path)
        return next
      }).pipe(Effect.andThen(Queue.offer(pokes, undefined))),
  }
})

/** jj-integration as an inbox provider: conflicted or stopped lands are Failed, idle described work is Ready to land. */
export class LandAttention extends Context.Service<LandAttention, Effect.Success<typeof make>>()('@dshfiles/jj-integration/LandAttention') {
  static readonly layer = Layer.effect(LandAttention, make)
  static readonly draftsOf = draftsOf
  static readonly readyDraftOf = readyDraftOf
  static readonly readyFateOf = readyFateOf
  static readonly parseDiffStat = parseDiffStat
}
