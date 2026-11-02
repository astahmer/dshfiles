import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import { HostContext } from '@dshfiles/dshx/effect'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { ParentQuestions, type ParentQuestionAgent } from './parent-questions.js'
import { QuestionStore } from './question-store.js'
import { parentQuestionDomain, parentQuestionRecordSchema, type ParentQuestionRecord } from './store.js'
import { AgentQuestionsTesting } from './test-support.js'

const parent: ParentQuestionAgent = { id: 'root-session' }
const child: ParentQuestionAgent = { id: 'child-session' }
const world = () => AgentQuestionsTesting.makeWorld({ agents: [parent, child], parents: [[child.id, parent.id]] })

const legacyDomain = (version: 1 | 2) =>
  StorageDomainPlugin.defineDomain({
    name: parentQuestionDomain.name,
    version,
    ...(version === 2 && { compatibleVersions: [1] }),
    layout: 'per-record',
    tables: { questions: { valueSchema: parentQuestionRecordSchema, __key: 'questions' } },
  })

/** Write one row with an older storage-domain version, as an earlier release of the plugin did. */
const seedLegacyRow = (input: { readonly root: string; readonly version: 1 | 2; readonly key: string; readonly record: ParentQuestionRecord }) =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const domain = yield* Effect.acquireRelease(
      Effect.promise(() => host.ctx.storageDomain.open(legacyDomain(input.version))),
      opened => Effect.promise(() => opened.close()),
    )
    yield* Effect.promise(() => domain.table('questions').put(input.key, input.record))
  }).pipe(Effect.scoped, Effect.provide(AgentQuestionsTesting.jsonStorageHost(input.root)))

const legacyRecord = (questionId: string): ParentQuestionRecord => ({
  questionId,
  parentSessionId: parent.id,
  childSessionId: child.id,
  operationId: 'legacy-operation',
  question: 'Continue the older request?',
  options: [
    { id: 'continue', label: 'Continue' },
    { id: 'stop', label: 'Stop' },
  ],
  status: 'pending',
  createdAt: 1_000,
  expiresAt: 2_000,
  updatedAt: 1_000,
})

describe('parent question JSON storage', () => {
  it.effect('opens v1 pending rows and keeps their no-default expiry semantics', () =>
    Effect.gen(function* () {
      const root = yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-v1-')
      const questionId = '00000000-0000-4000-8000-000000000001'
      yield* seedLegacyRow({ root, version: 1, key: 'legacy-question', record: legacyRecord(questionId) })
      yield* TestClock.setTime(2_000)
      yield* Effect.gen(function* () {
        expect(yield* ParentQuestions.use(questions => questions.wait({ agent: child, questionId }))).toEqual({ kind: 'expired', questionId })
        const statuses = yield* QuestionStore.use(store => Effect.map(store.questions.entries, rows => rows.map(([, row]) => row.status)))
        expect(statuses).toEqual(['expired'])
      }).pipe(Effect.provide(AgentQuestionsTesting.questionServices({ root, world: world() })))
    }),
  )

  it.effect('opens version 2 question storage with the new feedback table', () =>
    Effect.gen(function* () {
      const root = yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-v2-')
      const questionId = '00000000-0000-4000-8000-000000000002'
      yield* seedLegacyRow({ root, version: 2, key: 'version-two-question', record: legacyRecord(questionId) })
      yield* Effect.gen(function* () {
        const store = yield* QuestionStore
        expect(yield* store.feedback.size).toBe(0)
        expect(yield* store.questions.entries).toMatchObject([['version-two-question', { questionId, status: 'pending' }]])
      }).pipe(Effect.provide(AgentQuestionsTesting.questionServices({ root, world: world() })))
    }),
  )

  it.effect('reattaches to a deferred outcome and file path after a Host restart', () =>
    Effect.gen(function* () {
      const root = yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-deferred-')
      const agents = world()
      yield* TestClock.setTime(10_000)
      const attached = yield* Effect.gen(function* () {
        const questions = yield* ParentQuestions
        const receipt = yield* questions.request({
          agent: child,
          operationId: 'deferred-question-call',
          question: 'Which release plan should I use?',
          options: [
            { id: 'staged', label: 'Release in stages' },
            { id: 'single', label: 'Release in one step' },
          ],
          recommendedOptionId: 'staged',
          expiryBehavior: 'defer',
          timeoutMs: 1_000,
        })
        const waiting = yield* Effect.forkChild(questions.wait({ agent: child, questionId: receipt.questionId }))
        yield* TestClock.adjust(1_000)
        expect((yield* Fiber.join(waiting)).kind).toBe('deferred')
        return yield* questions.recordDeferredFile({
          agent: child,
          questionId: receipt.questionId,
          filePath: 'questions/2026-10-06T10-00-00-000Z_release-plan.md',
        })
      }).pipe(Effect.provide(AgentQuestionsTesting.questionServices({ root, world: agents })))
      expect(attached).toMatchObject({ kind: 'deferred', filePath: 'questions/2026-10-06T10-00-00-000Z_release-plan.md' })
      const recovered = yield* ParentQuestions.use(questions => questions.wait({ agent: child, questionId: attached.questionId })).pipe(
        Effect.provide(AgentQuestionsTesting.questionServices({ root, world: agents })),
      )
      expect(recovered).toEqual(attached)
    }),
  )
})
