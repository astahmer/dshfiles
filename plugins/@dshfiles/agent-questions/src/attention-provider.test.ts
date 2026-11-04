import type { AttentionActRequest, AttentionItem } from '@dshfiles/activity-timeline/attention-api'
import { HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer } from 'effect'
import { CHILD_QUESTION_SOURCE, ChildQuestionAttention } from './attention-provider.js'
import { ParentQuestions, type ParentQuestionAgent } from './parent-questions.js'
import { QuestionStore } from './question-store.js'
import type { ParentQuestionRecord } from './store.js'
import { AgentQuestionsTesting } from './test-support.js'

const parent: ParentQuestionAgent = { id: 'root-session' }
const child: ParentQuestionAgent = { id: 'child-session' }

const record = (overrides: Partial<ParentQuestionRecord> = {}): ParentQuestionRecord => ({
  questionId: '00000000-0000-4000-8000-000000000001',
  parentSessionId: parent.id,
  childSessionId: child.id,
  operationId: 'op',
  question: 'Deploy now?',
  context: 'The release branch is green.',
  options: [
    { id: 'yes', label: 'Deploy' },
    { id: 'no', label: 'Wait' },
  ],
  recommendedOptionId: 'yes',
  expiryBehavior: 'recommended',
  status: 'pending',
  createdAt: 1,
  expiresAt: 10_000,
  updatedAt: 1,
  ...overrides,
})

const itemFor = (questionId: string): AttentionItem => ({
  id: 'item',
  source: CHILD_QUESTION_SOURCE,
  dedupeKey: questionId,
  subject: { kind: 'session', id: parent.id },
  reason: 'A subagent asks: Deploy now?',
  detail: null,
  severity: 'blocking',
  verbs: ['Answer', 'Open', 'Done', 'Snooze', 'MuteSource'],
  choices: [],
  fingerprint: 'f',
  createdAt: 1,
  openedAt: 1,
  updatedAt: 1,
  occurrences: 1,
  resolvedAt: null,
  doneAt: null,
  snoozedUntil: null,
  snoozeUntilChange: false,
})

describe('agent-questions attention provider', () => {
  it('states each pending, unexpired child question as a blocking item about its parent thread', () => {
    const drafts = ChildQuestionAttention.openDrafts(
      [
        record(),
        record({ questionId: '00000000-0000-4000-8000-000000000002', status: 'answered', answer: 'yes' }),
        record({ questionId: '00000000-0000-4000-8000-000000000003', expiresAt: 5 }),
      ],
      100,
    )
    expect(drafts).toEqual([
      {
        dedupeKey: '00000000-0000-4000-8000-000000000001',
        subject: { kind: 'session', id: parent.id },
        reason: 'A subagent asks: Deploy now?',
        detail: 'The release branch is green.',
        severity: 'blocking',
        verbs: ['Answer', 'Open', 'Done', 'Snooze', 'MuteSource'],
        choices: [
          { id: 'yes', label: 'Deploy', recommended: true },
          { id: 'no', label: 'Wait' },
        ],
      },
    ])
  })

  it.live('answers a child question from the Inbox as the parent and wakes the waiting child', () =>
    Effect.gen(function* () {
      const root = yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-attention-')
      const world = AgentQuestionsTesting.makeWorld({ agents: [parent, child], parents: [[child.id, parent.id]] })
      const services = ChildQuestionAttention.layer.pipe(
        Layer.provideMerge(ParentQuestions.layer),
        Layer.provideMerge(QuestionStore.layer),
        Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, HostApis.layer, AgentQuestionsTesting.fakeAgentDirectory(world))),
        Layer.provideMerge(AgentQuestionsTesting.jsonStorageHost(root)),
      )
      yield* Effect.gen(function* () {
        const host = yield* HostContext
        const questions = yield* ParentQuestions
        const receipt = yield* questions.request({
          agent: child,
          operationId: 'call-1',
          question: 'Deploy now?',
          options: [
            { id: 'yes', label: 'Deploy' },
            { id: 'no', label: 'Wait' },
          ],
          recommendedOptionId: 'yes',
          expiryBehavior: 'recommended',
          timeoutMs: 60_000,
        })
        const waiting = yield* Effect.forkChild(questions.wait({ agent: child, questionId: receipt.questionId }))
        const act = (request: AttentionActRequest) => Effect.promise(() => host.ctx.serial('dshfiles/attention/act', request))

        expect(yield* act({ item: { ...itemFor(receipt.questionId), source: 'other.source' }, verb: 'Answer', choiceId: 'no' })).toBeUndefined()
        expect(yield* act({ item: itemFor(receipt.questionId), verb: 'Answer', choiceId: 'maybe' })).toMatchObject({ ok: false })
        expect(yield* act({ item: itemFor(receipt.questionId), verb: 'Answer', choiceId: 'no' })).toMatchObject({ ok: true })
        expect(yield* Fiber.join(waiting)).toEqual({
          kind: 'answered',
          questionId: receipt.questionId,
          answer: ChildQuestionAttention.inboxAnswerText({ id: 'no', label: 'Wait' }),
        })
        expect(yield* act({ item: itemFor(receipt.questionId), verb: 'Answer', choiceId: 'yes' })).toMatchObject({ ok: false })
      }).pipe(Effect.provide(services))
    }),
  )
})
