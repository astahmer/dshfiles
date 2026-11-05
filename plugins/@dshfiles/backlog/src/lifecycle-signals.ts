import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/types'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { Jj } from '@dshfiles/jj-cli'
import { Cause, Clock, Effect, Layer, Option, Ref, Schedule } from 'effect'
import { BacklogSettingsTag } from './backlog-settings.js'
import { HostSessions } from './host-edge-promise.js'
import { BacklogQuestionReply } from './question-reply.js'
import { BacklogSignals } from './signals.js'
import { BacklogStore } from './store.js'
import { ThreadLifecycle } from './thread-lifecycle.js'
import { Triage } from './triage-service.js'

const MAX_REPOSITORIES = 10
const NUDGE_EVERY_MS = 60 * 60_000

/** A loop that must outlive one failed tick: the failure is logged and the next minute tries again. */
const everyMinute = <E, R>(name: string, tick: Effect.Effect<void, E, R>) =>
  Effect.sleep('1 minute').pipe(
    Effect.andThen(
      Effect.repeat(
        tick.pipe(Effect.catchCause(cause => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logWarning(`${name} failed`, cause)))),
        Schedule.spaced('1 minute'),
      ),
    ),
  )

/**
 * The backlog's outside signals: a thread naming `b:12` links and starts it, a finished or stopped turn flags or
 * clears its items, an idle thread nudges its items, and a revision on main that says `Closes b:12` finishes it.
 */
export const LifecycleSignals = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* BacklogStore
    const settings = yield* BacklogSettingsTag
    const triage = yield* Triage
    const jj = yield* Jj
    const sessions = yield* HostSessions
    const seenMain = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
    const lastPoll = yield* Ref.make(0)
    const lastNudge = yield* Ref.make(0)

    const readJj = (cwd: string, args: readonly string[]) =>
      jj.exec({ cwd, args: ['--ignore-working-copy', ...args], timeout: '20 seconds', maxStdoutBytes: 400_000 }).pipe(Effect.map(output => output.stdout))

    /** Finish items that a revision on main closes (`Closes b:12`), in every repository an open item names. */
    const pollRevisions = Effect.fn('backlog revision poll')(function* () {
      const current = yield* settings.get
      const open = (yield* store.list({ freshness: 'all', statuses: ['inbox', 'todo', 'doing'], limit: 500 })).items
      const repositories = [...new Set([...current.revisionRepositories, ...open.flatMap(item => (item.project === null ? [] : [item.project]))])].slice(
        0,
        MAX_REPOSITORIES,
      )
      yield* Effect.annotateCurrentSpan({ 'dshx.backlog.repositories': repositories.length })
      // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each repository advances its own seen-main map, so the polls stay in a stable order.
      for (const repository of repositories) {
        const head = yield* Effect.option(readJj(repository, ['log', '--no-graph', '-r', 'main', '-T', 'commit_id']))
        if (Option.isNone(head) || (yield* Ref.get(seenMain)).get(repository) === head.value) continue
        yield* Ref.update(seenMain, seen => new Map(seen).set(repository, head.value))
        const log = yield* readJj(repository, ['log', '--no-graph', '-r', 'ancestors(main, 50) ~ root()', '-T', BacklogSignals.logTemplate]).pipe(
          Effect.orElseSucceed(() => ''),
        )
        for (const revision of BacklogSignals.parseLog(log))
          for (const ref of BacklogSignals.closedBy(revision.description)) {
            const id = yield* store.resolve(ref)
            if (id !== undefined)
              yield* store.applySignal({
                id,
                status: 'done',
                link: { type: 'revision', target: revision.changeId },
                reason: `closed by jj:${revision.changeId}`,
              })
          }
      }
    })

    /** A thread that stopped flags the items it works on; its next finished turn clears only that same flag. */
    const nudgeIdleThreads = Effect.fn('backlog idle thread nudge')(function* (idleDays: number) {
      const summaries = (yield* store.list({ freshness: 'all', statuses: ['doing'], limit: 2_000 })).items
      const details = yield* Effect.forEach(summaries, summary => store.get(summary.id))
      const items = details.flatMap(detail => (detail.ok ? [detail.value.item] : []))
      if (items.length === 0) return
      const listed = yield* sessions.list
      const now = yield* Clock.currentTimeMillis
      for (const nudge of ThreadLifecycle.idleThreadNudges({ items, sessions: listed.items, now, idleDays }))
        yield* store.applyThreadAttention({
          id: nudge.id,
          threadId: nudge.threadId,
          attention: 'waiting',
          reason: `Thread idle nudge: linked thread ${nudge.threadId} has been idle for at least ${idleDays} days. Is this item still active?`,
        })
    })

    const revisionTick = Effect.gen(function* () {
      const current = yield* settings.get
      const now = yield* Clock.currentTimeMillis
      if (!current.lifecycleSignals || now - (yield* Ref.get(lastPoll)) < current.revisionPollMinutes * 60_000) return
      yield* Ref.set(lastPoll, now)
      yield* pollRevisions()
    })

    const nudgeTick = Effect.gen(function* () {
      const current = yield* settings.get
      const now = yield* Clock.currentTimeMillis
      if (!current.lifecycleSignals || current.idleThreadNudgeDays === 0 || now - (yield* Ref.get(lastNudge)) < NUDGE_EVERY_MS) return
      yield* Ref.set(lastNudge, now)
      yield* nudgeIdleThreads(current.idleThreadNudgeDays)
    })

    const onTurnEnd = Effect.fn('backlog thread turn signal')(function* (session: Session, reason: TurnEndReason) {
      const outcome = ThreadLifecycle.outcome(reason)
      if (outcome === null) return
      for (const item of yield* store.referencing({ type: 'thread', target: session.id }))
        yield* store.applyThreadAttention({ id: item.id, threadId: session.id, attention: outcome.stalled ? 'blocked' : 'none', reason: outcome.reason })
      const current = yield* settings.get
      if (outcome.stalled || current.threadResolution !== 'propose' || !current.jevEnabled) return
      yield* triage.resolveThread({ sessionId: session.id, reply: ThreadLifecycle.replyText(session.deriveMessages()) })
    })

    /** The user, or another Agent answering for them, decided what a thread asked: its items stop waiting on the user. */
    const onQuestionAnswered = Effect.fn('backlog question answer signal')(function* (session: Session) {
      for (const item of yield* store.referencing({ type: 'thread', target: session.id }))
        yield* store.settleAnsweredQuestion({ id: item.id, threadId: session.id, reason: 'the thread’s question was answered' })
    })

    /** A user naming `b:k3f9` (or a legacy `b:12`) in a thread is working on it: link the thread and start the item. */
    const onSessionEvent = (session: Session, event: SessionEvent) =>
      Effect.gen(function* () {
        if (!(yield* settings.get).lifecycleSignals) return
        if (event.type === 'turn/end') return yield* onTurnEnd(session, event.data.reason)
        if (event.type !== 'user/message') return
        if (BacklogQuestionReply.isAnswer(event.data.source)) return yield* onQuestionAnswered(session)
        if (event.data.source.kind !== 'user') return
        const refs = BacklogSignals.mentionsIn(event.data.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n'))
        yield* Effect.forEach(
          refs,
          ref =>
            Effect.flatMap(store.resolve(ref), id =>
              id === undefined
                ? Effect.void
                : Effect.asVoid(store.applySignal({ id, status: 'doing', link: { type: 'thread', target: session.id }, reason: 'mentioned in a thread' })),
            ),
          { concurrency: 'unbounded', discard: true },
        )
      }).pipe(Effect.catch(error => Effect.logWarning('backlog: a thread signal failed', error)))

    yield* HostEvents.on('session/event', onSessionEvent)
    yield* DshxPlugin.worker(everyMinute('backlog revision signals', revisionTick))
    yield* DshxPlugin.worker(everyMinute('backlog idle thread nudges', nudgeTick))
  }),
)
