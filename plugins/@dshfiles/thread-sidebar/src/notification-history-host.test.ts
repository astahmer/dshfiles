import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import ApprovalService, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { HostContext, tracerLayer } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, FileSystem, Layer, Queue, type Scope, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { randomUUID } from 'node:crypto'
import { NotificationHistory } from './notification-history.js'
import { notificationHistoryRecorder } from './notification-history-host.js'
import { SessionEvents } from './session-events.js'
import { jsonStorageDomain } from './storage.test-support.js'

const fixture = (root: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const host = await createTestHost()
      await host.ctx.plugin(SessionStore)
      await host.ctx.plugin(SessionProjectionRegistry)
      await host.ctx.plugin(LlmRuntime)
      await host.ctx.plugin(AgentRegistry)
      await host.ctx.plugin(AgentLoop)
      await host.ctx.plugin(Storage)
      await host.ctx.plugin(StorageJson, { root })
      await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
      await host.ctx.plugin(ApprovalService)
      await host.ctx.plugin(UserQuestionService)
      const handle = await host.ctx.agents.create({ sessionId: SessionId(randomUUID()) })
      handle.agent.session.append('turn/start', { turn: 1 })
      const answer = { answers: [{ id: 'question', selected: ['Continue'] }] }
      host.ctx.on('approval/request', () => Promise.resolve('allowed-once'))
      host.ctx.on('user-questions/request', () => Promise.resolve(answer))
      return { host, handle, answer, root }
    }),
    value => Effect.promise(() => value.host.dispose()),
  )

const withRecorder = <A, E>(
  body: (input: {
    readonly fixture: Effect.Success<ReturnType<typeof fixture>>
    readonly history: NotificationHistory['Service']
  }) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(10_000)
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'notification-history-host-' })
    const created = yield* fixture(root)
    const layer = notificationHistoryRecorder.pipe(
      Layer.provideMerge(NotificationHistory.layer),
      Layer.provideMerge(SessionEvents.layer),
      Layer.provideMerge(StorageDomain.layer),
      Layer.provide(Layer.succeed(HostContext, HostContext.of({ ctx: created.host.ctx, packageId: '@dshfiles/thread-sidebar' }))),
    )
    return yield* NotificationHistory.use(history => body({ fixture: created, history })).pipe(Effect.provide(layer))
  }).pipe(Effect.provide(NodeFileSystem.layer))

const historyWrites = (input: { readonly fixture: Effect.Success<ReturnType<typeof fixture>>; readonly count: number }) =>
  Stream.callback<void>(queue =>
    Effect.acquireRelease(
      Effect.sync(() =>
        input.fixture.host.ctx.on('domain/changed', change => {
          if (change.domain === 'thread_notification_history') Queue.offerUnsafe(queue, undefined)
        }),
      ),
      dispose => Effect.sync(dispose),
    ),
  ).pipe(Stream.take(input.count), Stream.runDrain, Effect.forkScoped)

describe('notification history Host collection', () => {
  it.effect('records real request waterfalls before earlier consuming answerers without changing their answers', () =>
    withRecorder(({ fixture: created, history }) =>
      Effect.gen(function* () {
        const agent = created.handle.agent
        const outcome = yield* Effect.promise(() => created.host.ctx.approval.request({ agent, toolName: 'private-tool', reason: 'private reason' }))
        expect(outcome).toBe('allowed-once')
        const answer = yield* Effect.promise(() =>
          created.host.ctx.userQuestions.ask({
            agent,
            questions: [{ id: 'question', question: 'Private question text?', options: [{ label: 'Continue' }] }],
            wait: { callId: ToolCallId('question-call') },
          }),
        )
        expect(answer).toBe(created.answer)
        const review = yield* Effect.promise(() =>
          created.host.ctx.userQuestions.ask({
            agent,
            questions: [
              {
                id: 'question',
                question: 'Private plan question?',
                detail: 'private plan content',
                options: [{ label: 'Continue' }],
                intent: { kind: 'plan-review', approve: 'Continue', callId: ToolCallId('plan-call') },
              },
            ],
            wait: { callId: ToolCallId('plan-call') },
          }),
        )
        expect(review).toBe(created.answer)
        const snapshot = yield* history.snapshot
        expect(snapshot.entries).toHaveLength(3)
        expect(snapshot.entries.map(entry => entry.category).sort()).toEqual(['approval-needed', 'approval-needed', 'input-needed'])
        expect(snapshot.entries.every(entry => entry.at === 10_000 && !entry.read && !entry.dismissed)).toBe(true)
        expect(JSON.stringify(snapshot)).not.toContain('private')
        expect(JSON.stringify(snapshot)).not.toContain('question-call')
        expect(snapshot.entries.every(entry => Object.keys(entry).sort().join(',') === 'at,category,dismissed,id,read,sessionId')).toBe(true)
      }),
    ),
  )

  it.effect('deduplicates the same question request identity and skips requests without a Session', () =>
    withRecorder(({ fixture: created, history }) =>
      Effect.gen(function* () {
        const request = { agent: created.handle.agent, questions: [{ id: 'question', question: 'Private?' }], wait: { callId: ToolCallId('same-call') } }
        yield* Effect.promise(() => created.host.ctx.userQuestions.ask(request))
        yield* history.setRead({ ids: (yield* history.snapshot).entries.map(entry => entry.id), read: true })
        yield* Effect.promise(() => created.host.ctx.userQuestions.ask(request))
        yield* Effect.promise(() => created.host.ctx.userQuestions.ask({ questions: [{ id: 'question', question: 'Without Session?' }] }))
        expect((yield* history.snapshot).entries).toHaveLength(1)
        expect((yield* history.snapshot).entries[0]?.read).toBe(true)
      }),
    ),
  )

  it.effect('retains distinct concurrent approvals and unkeyed questions from the same Session', () =>
    withRecorder(({ fixture: created, history }) =>
      Effect.gen(function* () {
        const agent = created.handle.agent
        const approvals = yield* Effect.promise(() =>
          Promise.all([
            created.host.ctx.approval.request({ agent, toolName: 'first-tool' }),
            created.host.ctx.approval.request({ agent, toolName: 'second-tool' }),
          ]),
        )
        expect(approvals).toEqual(['allowed-once', 'allowed-once'])
        expect((yield* history.snapshot).entries.filter(entry => entry.category === 'approval-needed')).toHaveLength(2)
        const answers = yield* Effect.promise(() =>
          Promise.all([
            created.host.ctx.userQuestions.ask({ agent, questions: [{ id: 'question', question: 'First?' }] }),
            created.host.ctx.userQuestions.ask({ agent, questions: [{ id: 'question', question: 'Second?' }] }),
          ]),
        )
        expect(answers).toEqual([created.answer, created.answer])
        const snapshot = yield* history.snapshot
        expect(snapshot.entries.filter(entry => entry.category === 'input-needed')).toHaveLength(2)
        expect(new Set(snapshot.entries.map(entry => entry.id)).size).toBe(4)
      }),
    ),
  )

  it.effect('does not mistake automatic approval rejection or tool invocation for a pending human request', () =>
    withRecorder(({ fixture: created, history }) =>
      Effect.gen(function* () {
        const agent = created.handle.agent
        setApprovalPolicy(agent.session, 'never')
        expect(yield* Effect.promise(() => created.host.ctx.approval.request({ agent, toolName: 'private-tool' }))).toBe('rejected')
        agent.session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('not-a-request'), name: 'ask_user_question', arguments: 'private arguments' })
        agent.session.append('step/end', { turn: 1, step: 1 })
        expect(yield* history.snapshot).toEqual({ entries: [] })
      }),
    ),
  )

  it.effect('records eligible finishes from the Host event bus and leaves shutdown or bookkeeping ends out', () =>
    withRecorder(({ fixture: created, history }) =>
      Effect.gen(function* () {
        const committed = yield* historyWrites({ fixture: created, count: 3 })
        yield* Effect.yieldNow
        const session = created.handle.agent.session
        session.append('turn/end', { turn: 1, reason: { kind: 'forked' } })
        session.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
        session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
        session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'PRIVATE_CODE', message: 'private error message' } } })
        yield* Fiber.join(committed)
        const snapshot = yield* history.snapshot
        expect(snapshot.entries.map(entry => entry.category).sort()).toEqual(['failed', 'stopped', 'turn-finished'])
        expect(JSON.stringify(snapshot)).not.toContain('private')
      }),
    ),
  )

  it.effect('delegates unchanged even after the real storage handle becomes unavailable', () =>
    withRecorder(({ fixture: created, history }) =>
      Effect.gen(function* () {
        yield* history.record({ id: 'retained', sessionId: String(created.handle.agent.id), at: 1, category: 'turn-finished' })
        yield* Effect.promise(() => created.host.ctx.storageDomain.closeAll())
        const outcome = yield* Effect.promise(() => created.host.ctx.approval.request({ agent: created.handle.agent, toolName: 'private-tool' }))
        expect(outcome).toBe('allowed-once')
        expect(
          yield* Effect.promise(() =>
            created.host.ctx.userQuestions.ask({ agent: created.handle.agent, questions: [{ id: 'question', question: 'Private?' }] }),
          ),
        ).toBe(created.answer)
        const reopened = yield* NotificationHistory.use(store => store.snapshot).pipe(
          Effect.provide(Layer.fresh(NotificationHistory.layer.pipe(Layer.provide(jsonStorageDomain(created.root))))),
        )
        expect(reopened.entries).toEqual([
          { id: 'retained', sessionId: String(created.handle.agent.id), at: 1, category: 'turn-finished', read: false, dismissed: false },
        ])
      }),
    ),
  )

  it.effect('records a tracing span without adding request content', () =>
    withRecorder(({ history }) =>
      Effect.gen(function* () {
        using recorder = recordSpans()
        yield* history.record({ id: 'span-test', sessionId: 'thread', at: 1, category: 'turn-finished' }).pipe(Effect.provide(tracerLayer))
        expect(recorder.spans.some(span => span.name === 'notification history record')).toBe(true)
      }),
    ),
  )
})
