import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Exit, Fiber } from 'effect'
import { TestClock } from 'effect/testing'
import { ParentQuestions, type ParentQuestionAgent, type ParentQuestionRequest } from './parent-questions.js'
import { QuestionStore } from './question-store.js'
import { AgentQuestionsTesting, type AgentWorld } from './test-support.js'
import type { ParentQuestionExpiryBehavior } from './store.js'

const root: ParentQuestionAgent = { id: 'root-session' }
const firstChild: ParentQuestionAgent = { id: 'child-session-a' }
const secondChild: ParentQuestionAgent = { id: 'child-session-b' }
const unrelatedAgent: ParentQuestionAgent = { id: 'unrelated-session' }

const newWorld = () =>
  AgentQuestionsTesting.makeWorld({
    agents: [root, firstChild, secondChild, unrelatedAgent],
    parents: [
      [firstChild.id, root.id],
      [secondChild.id, root.id],
    ],
  })

const requestInput = (input: {
  readonly agent?: ParentQuestionAgent
  readonly operationId?: string
  readonly question?: string
  readonly recommendedOptionId?: string
  readonly expiryBehavior?: ParentQuestionExpiryBehavior
  readonly timeoutMs?: number
}): ParentQuestionRequest => ({
  agent: input.agent ?? firstChild,
  operationId: input.operationId ?? 'call-1',
  question: input.question ?? 'Which migration strategy should I use?',
  context: 'The migration needs to preserve existing account data.',
  options: [
    { id: 'expand-contract', label: 'Expand and contract' },
    { id: 'direct', label: 'Replace in one migration' },
  ],
  recommendedOptionId: input.recommendedOptionId ?? 'expand-contract',
  expiryBehavior: input.expiryBehavior ?? 'recommended',
  timeoutMs: input.timeoutMs ?? 30_000,
})

/** Run `body` against fresh question services over JSON storage in `root`; closing them is a Host shutdown. */
const withQuestions =
  (root: string, world: AgentWorld) =>
  <A, E>(body: Effect.Effect<A, E, ParentQuestions | QuestionStore>) =>
    body.pipe(Effect.provide(AgentQuestionsTesting.questionServices({ root, world })))

const storedStatuses = QuestionStore.use(store => Effect.map(store.questions.entries, rows => rows.map(([, record]) => record.status)))

describe('parent questions', () => {
  it.effect('returns a stable question id for a duplicate operation and delivers one notice', () =>
    Effect.gen(function* () {
      const world = newWorld()
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        world,
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const first = yield* questions.request(requestInput({}))
          const duplicate = yield* questions.request(requestInput({}))
          expect(duplicate).toEqual(first)
          expect(yield* storedStatuses).toEqual(['pending'])
          expect(world.parentNotices).toHaveLength(1)
          expect(world.parentNotices[0]).toContain(`Parent question ${first.questionId} from direct child Session ${firstChild.id}.`)
        }),
      )
    }),
  )

  it.effect('rejects a missing recommendation and a changed expiry policy on an idempotent dispatch', () =>
    Effect.gen(function* () {
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        newWorld(),
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const invalid = yield* Effect.flip(questions.request({ ...requestInput({}), recommendedOptionId: 'unknown' }))
          expect(invalid._tag).toBe('RequestInputInvalid')
          expect(invalid.message).toContain('The recommended option must exist in the question options.')
          yield* questions.request(requestInput({}))
          const reused = yield* Effect.flip(questions.request(requestInput({ expiryBehavior: 'defer' })))
          expect(reused.message).toBe('Question operation id was reused with different input.')
        }),
      )
    }),
  )

  it.effect('stores optional option descriptions and honors a shorter expiry delay', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        newWorld(),
      )(
        Effect.gen(function* () {
          yield* ParentQuestions.use(questions =>
            questions.request({
              ...requestInput({}),
              options: [
                { id: 'expand-contract', label: 'Expand and contract', description: 'Preserve old and new data paths during rollout.' },
                { id: 'direct', label: 'Replace directly' },
              ],
              timeoutMs: 20_000,
            }),
          )
          const [record] = yield* QuestionStore.use(store => Effect.map(store.questions.entries, rows => rows.map(([, row]) => row)))
          expect(record?.expiresAt).toBe(21_000)
          expect(record?.options[0]?.description).toBe('Preserve old and new data paths during rollout.')
        }),
      )
    }),
  )

  it.effect('lists pending questions by direct parent with exact deadline and child filter', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        newWorld(),
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const first = yield* questions.request(requestInput({ timeoutMs: 30_000 }))
          const second = yield* questions.request(
            requestInput({ agent: secondChild, operationId: 'call-b', question: 'Which validation should I run?', timeoutMs: 10_000 }),
          )
          yield* TestClock.setTime(4_000)
          const all = yield* questions.listForParent({ agent: root })
          expect(all.find(question => question.questionId === first.questionId)).toMatchObject({
            childSessionId: firstChild.id,
            recommendedOptionId: 'expand-contract',
            expiryBehavior: 'recommended',
            expiresAt: 31_000,
            remainingMs: 27_000,
            expired: false,
          })
          expect(yield* questions.listForParent({ agent: root, childSessionId: secondChild.id })).toMatchObject([
            { questionId: second.questionId, childSessionId: secondChild.id },
          ])
          expect(yield* questions.listForParent({ agent: unrelatedAgent })).toEqual([])
          yield* questions.answer({ agent: root, questionId: first.questionId, answer: 'Use expand and contract.' })
          expect((yield* questions.listForParent({ agent: root })).map(question => question.questionId)).toEqual([second.questionId])
        }),
      )
    }),
  )

  it.effect('isolates concurrent child waits by question id', () =>
    Effect.gen(function* () {
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        newWorld(),
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const first = yield* questions.request(requestInput({ operationId: 'call-a' }))
          const second = yield* questions.request(requestInput({ agent: secondChild, operationId: 'call-b', question: 'Which validation should I run?' }))
          const firstWait = yield* Effect.forkChild(questions.wait({ agent: firstChild, questionId: first.questionId }))
          const secondWait = yield* Effect.forkChild(questions.wait({ agent: secondChild, questionId: second.questionId }))
          yield* Effect.yieldNow

          const firstAnswer = yield* questions.answer({ agent: root, questionId: first.questionId, answer: 'Use expand and contract.' })
          expect(firstAnswer).toEqual({ kind: 'answered', questionId: first.questionId, answer: 'Use expand and contract.' })
          expect(yield* Fiber.join(firstWait)).toEqual(firstAnswer)
          yield* Effect.yieldNow
          expect(secondWait.pollUnsafe()).toBeUndefined()

          yield* questions.answer({ agent: root, questionId: second.questionId, answer: 'Run focused tests.' })
          expect(yield* Fiber.join(secondWait)).toEqual({ kind: 'answered', questionId: second.questionId, answer: 'Run focused tests.' })
        }),
      )
    }),
  )

  it.effect('rejects an answer from any Agent except the recorded direct parent, and a competing answer', () =>
    Effect.gen(function* () {
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        newWorld(),
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const request = yield* questions.request(requestInput({}))
          const forbidden = yield* Effect.flip(questions.answer({ agent: unrelatedAgent, questionId: request.questionId, answer: 'Unauthorized answer.' }))
          expect(forbidden.message).toBe('Only the direct parent can answer this question.')

          const attempts = yield* Effect.all(
            [
              Effect.exit(questions.answer({ agent: root, questionId: request.questionId, answer: 'First answer.' })),
              Effect.exit(questions.answer({ agent: root, questionId: request.questionId, answer: 'Second answer.' })),
            ],
            { concurrency: 'unbounded' },
          )
          expect(attempts.filter(Exit.isSuccess)).toHaveLength(1)
          expect(attempts.filter(Exit.isFailure).map(exit => Cause.squash(exit.cause))).toMatchObject([
            { message: 'Parent question already has a different answer.' },
          ])
        }),
      )
    }),
  )

  it.effect('persists pending and answered records across Host restarts and interrupts waiters on shutdown', () =>
    Effect.gen(function* () {
      const storageRoot = yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-')
      const world = newWorld()
      const { request, waiting } = yield* withQuestions(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const request = yield* questions.request(requestInput({}))
          const waiting = yield* Effect.forkDetach(questions.wait({ agent: firstChild, questionId: request.questionId }))
          yield* Effect.yieldNow
          return { request, waiting }
        }),
      )
      expect(yield* Fiber.join(waiting)).toEqual({ kind: 'interrupted', questionId: request.questionId })

      const answer = yield* withQuestions(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          expect(yield* storedStatuses).toEqual(['pending'])
          return yield* ParentQuestions.use(questions =>
            questions.answer({ agent: root, questionId: request.questionId, answer: 'Resume with the same request id.' }),
          )
        }),
      )
      const recovered = yield* withQuestions(
        storageRoot,
        world,
      )(ParentQuestions.use(questions => questions.wait({ agent: firstChild, questionId: request.questionId })))
      expect(recovered).toEqual(answer)
    }),
  )

  it.effect('cancels the durable request when the child abandons its wait', () =>
    Effect.gen(function* () {
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        newWorld(),
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const request = yield* questions.request(requestInput({}))
          const waiting = yield* Effect.forkChild(questions.wait({ agent: firstChild, questionId: request.questionId }))
          yield* Effect.yieldNow
          yield* Fiber.interrupt(waiting)
          expect(yield* questions.cancel({ agent: firstChild, questionId: request.questionId })).toEqual({ kind: 'cancelled', questionId: request.questionId })
          const late = yield* Effect.flip(questions.answer({ agent: root, questionId: request.questionId, answer: 'Too late.' }))
          expect(late.message).toBe('Parent question is cancelled.')
        }),
      )
    }),
  )

  it.effect('uses the recommended option when a waited question reaches its deadline', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000_000)
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        newWorld(),
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const request = yield* questions.request(requestInput({ timeoutMs: 1_000 }))
          const waiting = yield* Effect.forkChild(questions.wait({ agent: firstChild, questionId: request.questionId }))
          yield* TestClock.adjust(1_000)
          expect(yield* Fiber.join(waiting)).toEqual({
            kind: 'recommended',
            questionId: request.questionId,
            option: { id: 'expand-contract', label: 'Expand and contract' },
          })
        }),
      )
    }),
  )

  it.effect('returns deferred question data and attaches one safe relative file path', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000_000)
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        newWorld(),
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const request = yield* questions.request(requestInput({ timeoutMs: 1_000, expiryBehavior: 'defer' }))
          yield* TestClock.setTime(1_001_000)
          expect(yield* questions.wait({ agent: firstChild, questionId: request.questionId })).toEqual({
            kind: 'deferred',
            questionId: request.questionId,
            childSessionId: firstChild.id,
            question: 'Which migration strategy should I use?',
            context: 'The migration needs to preserve existing account data.',
            options: [
              { id: 'expand-contract', label: 'Expand and contract' },
              { id: 'direct', label: 'Replace in one migration' },
            ],
            recommendedOption: { id: 'expand-contract', label: 'Expand and contract' },
            createdAt: 1_000_000,
            deferredAt: 1_001_000,
          })

          const filePath = 'questions/2026-10-06T10-00-00-000Z_migration.md'
          const recorded = yield* questions.recordDeferredFile({ agent: firstChild, questionId: request.questionId, filePath })
          expect(recorded).toMatchObject({ kind: 'deferred', filePath })
          expect(yield* questions.recordDeferredFile({ agent: firstChild, questionId: request.questionId, filePath })).toEqual(recorded)
          const conflict = yield* Effect.flip(
            questions.recordDeferredFile({ agent: firstChild, questionId: request.questionId, filePath: 'questions/other-question.md' }),
          )
          expect(conflict.message).toBe('Deferred question already has a different file path.')
          const forbidden = yield* Effect.flip(questions.recordDeferredFile({ agent: unrelatedAgent, questionId: request.questionId, filePath }))
          expect(forbidden.message).toBe('Only the requesting direct child can read or cancel this question.')
          const [stored] = yield* QuestionStore.use(store => Effect.map(store.questions.entries, rows => rows.map(([, row]) => row)))
          expect(stored?.deferredFilePath).toBe(filePath)
        }),
      )
    }),
  )

  it.effect('rejects calls from an Agent with no live direct parent and settles a refused delivery', () =>
    Effect.gen(function* () {
      const world = newWorld()
      yield* withQuestions(
        yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-'),
        world,
      )(
        Effect.gen(function* () {
          const questions = yield* ParentQuestions
          const refused = yield* Effect.flip(questions.request(requestInput({ agent: unrelatedAgent })))
          expect(refused.message).toBe('A question can only be requested by a live direct subagent.')
          world.failParentDelivery = true
          const undelivered = yield* Effect.flip(questions.request(requestInput({ operationId: 'call-undelivered' })))
          expect(undelivered._tag).toBe('NotificationFailed')
          expect(yield* storedStatuses).toEqual(['delivery-failed'])
        }),
      )
    }),
  )
})
