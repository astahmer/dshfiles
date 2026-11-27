import type { ApiCaller } from '@dshfiles/dshx/api'
import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Ref } from 'effect'
import { ThreadHostCallFailed } from './sidebar-errors.js'
import { watchThread } from './subscription-actions.js'
import { notifySubscribers, type DeliveryOutcome, type FinishedTurn, type SubscriptionNoticeDeps } from './subscription-notices.js'
import { jsonStorageDomain } from './storage.test-support.js'
import { ThreadSubscriptions } from './subscriptions-store.js'
import { createThreadActions, type ThreadActionDeps } from './thread-actions.js'

const unused = () => Effect.die('not used when starting a thread')

const turnEnd = (input: { readonly endSeq: number; readonly lastText: string | undefined }): FinishedTurn => ({
  finish: 'completed',
  endSeq: input.endSeq,
  observed: { startSeq: input.endSeq - 5, startedAt: 1, sawCompaction: false, sawAssistant: input.lastText !== undefined, lastText: input.lastText },
})

/**
 * Real thread actions and the real subscription store on a temporary root; the Host's create starts `child`, and
 * its prompt records whether the creator was already subscribed when the first turn was handed over.
 */
const withCreatedThreads = <A, E>(
  body: (input: {
    readonly actions: ReturnType<typeof createThreadActions>
    readonly store: ThreadSubscriptions['Service']
    readonly subscribedAtPrompt: Ref.Ref<ReadonlyArray<boolean>>
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'thread-creator-notices-' })
    return yield* Effect.gen(function* () {
      const store = yield* ThreadSubscriptions
      const subscribedAtPrompt = yield* Ref.make<ReadonlyArray<boolean>>([])
      const deps: ThreadActionDeps = {
        listSessions: unused,
        sessionExists: unused,
        readTitles: unused,
        listThreadRelations: unused,
        searchThreadContent: unused,
        projects: () => [],
        threadDirectories: unused,
        archivedSessionIds: () => [],
        pinnedSessionIds: () => [],
        settledSessionIds: () => [],
        setSettled: unused,
        archive: unused,
        unarchive: unused,
        pin: unused,
        unpin: unused,
        rename: (_sessionId, title) => Effect.succeed({ title }),
        fork: unused,
        continueIn: unused,
        create: () => Effect.succeed({ sessionId: 'child' }),
        prompt: input => store.edgesFor(input.sessionId).pipe(Effect.flatMap(edges => Ref.update(subscribedAtPrompt, seen => [...seen, edges.length > 0]))),
        watch: input =>
          watchThread(input).pipe(
            Effect.provideService(ThreadSubscriptions, store),
            Effect.mapError(cause => new ThreadHostCallFailed({ cause })),
          ),
        ownWorkspaceFor: unused,
        stop: unused,
        selectModel: unused,
        inspectProject: unused,
        registerProject: unused,
        renameProject: unused,
        deleteProject: unused,
        reorderProject: unused,
        moveSession: unused,
      }
      return yield* body({ actions: createThreadActions(deps), store, subscribedAtPrompt })
    }).pipe(Effect.provide(ThreadSubscriptions.layer.pipe(Layer.provide(jsonStorageDomain(root)))))
  }).pipe(Effect.provide(NodeFileSystem.layer))

/** Every Host read answers that both threads are open and idle; each notice is recorded instead of queued. */
const recordedNotices = Effect.gen(function* () {
  const delivered = yield* Ref.make<ReadonlyArray<{ readonly sessionId: string; readonly text: string }>>([])
  const notices: SubscriptionNoticeDeps = {
    stateOf: sessionIds =>
      Effect.succeed(new Map(sessionIds.map(id => [id, { archived: false, pendingQuestions: 0, title: id === 'child' ? 'Fix the parser' : undefined }]))),
    deliver: request =>
      Ref.update(delivered, sent => [...sent, { sessionId: request.sessionId, text: request.text }]).pipe(Effect.as<DeliveryOutcome>({ delivered: true })),
    messagesOf: () => Effect.succeed([]),
    landedSince: () => Effect.succeed(false),
    defaultLevel: Effect.succeed('all'),
    deliveryMode: Effect.succeed('steer'),
  }
  return { notices, delivered }
})

const lead: ApiCaller = { kind: 'agent', sessionId: 'lead' }

describe('threads an Agent starts report back to it', () => {
  it.effect('each turn end of a created thread sends its creator exactly one notice', () =>
    withCreatedThreads(({ actions, store, subscribedAtPrompt }) =>
      Effect.gen(function* () {
        const created = yield* actions.create({ input: { cwd: '/work', title: 'Fix the parser', text: 'fix it' }, caller: lead })
        expect(created).toMatchObject({ sessionId: 'child', prompt: 'accepted', notify: 'subscribed' })
        expect(yield* Ref.get(subscribedAtPrompt)).toEqual([true])

        const { notices, delivered } = yield* recordedNotices
        yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'child', turn: turnEnd({ endSeq: 10, lastText: 'Which branch?' }) })
        yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'child', turn: turnEnd({ endSeq: 20, lastText: undefined }) })

        const sent = yield* Ref.get(delivered)
        expect(sent.map(notice => notice.sessionId)).toEqual(['lead', 'lead'])
        expect(sent[0]?.text).toContain('“Fix the parser” (child) ended a turn.')
        expect(sent[0]?.text).toContain('answer preview: Which branch?')
        expect(sent[1]?.text).toContain('answer preview: none — it ended without an answer text.')
      }),
    ),
  )

  it.effect('notifyCreator: false starts the thread silently', () =>
    withCreatedThreads(({ actions, store }) =>
      Effect.gen(function* () {
        const created = yield* actions.create({ input: { cwd: '/work', text: 'fix it', notifyCreator: false }, caller: lead })
        expect(created.notify).toBeUndefined()
        const { notices, delivered } = yield* recordedNotices
        yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'child', turn: turnEnd({ endSeq: 10, lastText: 'done' }) })
        expect(yield* Ref.get(delivered)).toEqual([])
      }),
    ),
  )

  it.effect('a thread a person starts notifies nobody', () =>
    withCreatedThreads(({ actions, store }) =>
      Effect.gen(function* () {
        const created = yield* actions.create({ input: { cwd: '/work', text: 'fix it' }, caller: { kind: 'client' } })
        expect(created.notify).toBeUndefined()
        expect((yield* store.snapshot).subscriptions).toEqual([])
        const { notices, delivered } = yield* recordedNotices
        yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'child', turn: turnEnd({ endSeq: 10, lastText: 'done' }) })
        expect(yield* Ref.get(delivered)).toEqual([])
      }),
    ),
  )

  it.effect('thread_prompt with watch subscribes the caller to a thread it did not create, before the turn starts', () =>
    withCreatedThreads(({ actions, store, subscribedAtPrompt }) =>
      Effect.gen(function* () {
        const plain = yield* actions.prompt({ input: { sessionId: 'other', text: 'status?' }, caller: lead })
        expect(plain.notify).toBeUndefined()
        const watched = yield* actions.prompt({ input: { sessionId: 'other', text: 'status?', watch: true }, caller: lead })
        expect(watched.notify).toBe('subscribed')
        expect(yield* Ref.get(subscribedAtPrompt)).toEqual([false, true])
        expect((yield* store.snapshot).subscriptions.map(row => [row.subscriberSessionId, row.targetSessionId])).toEqual([['lead', 'other']])
      }),
    ),
  )

  it.effect('a refused pair still returns the created thread and says why it will not report back', () =>
    withCreatedThreads(({ actions, store }) =>
      Effect.gen(function* () {
        yield* store.subscribe({ subscriberSessionId: 'child', targetSessionId: 'lead' })
        const created = yield* actions.create({ input: { cwd: '/work' }, caller: lead })
        expect(created).toMatchObject({ sessionId: 'child', notify: 'failed' })
        expect(created.notifyError).toBeDefined()
      }),
    ),
  )
})
