import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ParentFeedback, type FeedbackResponse, type ParentFeedbackAgent } from './parent-feedback.js'
import { QuestionStore } from './question-store.js'
import type { MarkdownFeedbackAnchor } from './store.js'
import { AgentQuestionsTesting, type AgentWorld } from './test-support.js'

const root: ParentFeedbackAgent = { id: 'root-session' }
const firstChild: ParentFeedbackAgent = { id: 'child-session-a' }
const secondChild: ParentFeedbackAgent = { id: 'child-session-b' }
const unrelatedAgent: ParentFeedbackAgent = { id: 'unrelated-session' }

const GUIDE = 'docs/guide.md'
const EXCERPT = '12. Keep the first sentence.\n13. Keep the second sentence.\n14. Keep the third sentence.'
const ORIGINAL = `${Array.from({ length: 11 }, (_, index) => `Line ${String(index + 1)}.`).join('\n')}\n${EXCERPT}\n`
const CHANGED = `${ORIGINAL}A later edit.\n`

const anchorFor = (revision: string): MarkdownFeedbackAnchor => ({ kind: 'markdown', path: GUIDE, revision, startLine: 12, endLine: 14, excerpt: EXCERPT })

/** Two children of `root`, each with its own workspace holding docs/guide.md at its original revision. */
const setup = Effect.gen(function* () {
  const world = AgentQuestionsTesting.makeWorld({
    agents: [root, firstChild, secondChild, unrelatedAgent],
    parents: [
      [firstChild.id, root.id],
      [secondChild.id, root.id],
    ],
  })
  const workspaces = {
    [firstChild.id]: yield* AgentQuestionsTesting.temporaryDirectory('feedback-a-'),
    [secondChild.id]: yield* AgentQuestionsTesting.temporaryDirectory('feedback-b-'),
  }
  for (const [childId, workspace] of Object.entries(workspaces)) world.workspaces.set(childId, workspace)
  const writeGuide = (childId: string, contents: string) =>
    AgentQuestionsTesting.writeWorkspaceFile({ workspace: world.workspaces.get(childId) ?? '', relativePath: GUIDE, contents })
  const revision = yield* writeGuide(firstChild.id, ORIGINAL)
  yield* writeGuide(secondChild.id, ORIGINAL)
  return { world, writeGuide, revision, storageRoot: yield* AgentQuestionsTesting.temporaryDirectory('feedback-storage-') }
})

const withFeedback =
  (storageRoot: string, world: AgentWorld) =>
  <A, E>(body: Effect.Effect<A, E, ParentFeedback | QuestionStore>) =>
    body.pipe(Effect.provide(AgentQuestionsTesting.questionServices({ root: storageRoot, world })))

const submitAs = (input: { readonly agent?: ParentFeedbackAgent; readonly operationId?: string; readonly anchor: MarkdownFeedbackAnchor }) =>
  ParentFeedback.use(feedback =>
    feedback.submit({
      agent: input.agent ?? firstChild,
      operationId: input.operationId ?? 'call-1',
      anchor: input.anchor,
      comment: 'Clarify the recovery behavior.',
    }),
  )

const resolveAs = (agent: ParentFeedbackAgent, responses: ReadonlyArray<FeedbackResponse>) =>
  ParentFeedback.use(feedback => feedback.answerMany({ agent, responses }))

describe('revisioned Markdown feedback', () => {
  it.effect('stores an exact direct-parent request and deduplicates the parent wakeup', () =>
    Effect.gen(function* () {
      const { world, revision, storageRoot } = yield* setup
      yield* withFeedback(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          const first = yield* submitAs({ anchor: anchorFor(revision) })
          const duplicate = yield* submitAs({ anchor: anchorFor(revision) })
          expect(first.feedbackId).toBe(duplicate.feedbackId)
          expect(first.status).toBe('pending')
          expect(first.notificationMessageId).toBe('parent-message-1')
          expect(world.parentNotices).toHaveLength(1)
          const forbidden = yield* Effect.flip(ParentFeedback.use(feedback => feedback.read({ agent: secondChild, feedbackId: first.feedbackId })))
          expect(forbidden.message).toMatch(/Only the requesting direct child/)
        }),
      )
    }),
  )

  it.effect('records batch resolutions with current or stale revision receipts', () =>
    Effect.gen(function* () {
      const { world, writeGuide, revision, storageRoot } = yield* setup
      yield* withFeedback(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          const current = yield* submitAs({ operationId: 'current', anchor: anchorFor(revision) })
          const stale = yield* submitAs({ agent: secondChild, operationId: 'stale', anchor: anchorFor(revision) })
          const changedRevision = yield* writeGuide(secondChild.id, CHANGED)
          const results = yield* resolveAs(root, [
            { feedbackId: current.feedbackId, disposition: 'accepted', note: 'Apply after review.' },
            { feedbackId: stale.feedbackId, disposition: 'accepted', note: 'Apply after review.' },
          ])
          expect(results).toEqual([
            { feedbackId: current.feedbackId, status: 'resolved', notified: true },
            { feedbackId: stale.feedbackId, status: 'stale', notified: true },
          ])
          const feedback = yield* ParentFeedback
          expect((yield* feedback.read({ agent: firstChild, feedbackId: current.feedbackId })).resolutionReceipt).toMatchObject({
            baseRevision: revision,
            observedRevision: revision,
            disposition: 'accepted',
          })
          expect((yield* feedback.read({ agent: secondChild, feedbackId: stale.feedbackId })).resolutionReceipt).toMatchObject({
            baseRevision: revision,
            observedRevision: changedRevision,
            disposition: 'accepted',
          })
          expect(world.childNotices).toHaveLength(2)
        }),
      )
    }),
  )

  it.effect('turns a previously current receipt stale if the document changes before retrieval', () =>
    Effect.gen(function* () {
      const { world, writeGuide, revision, storageRoot } = yield* setup
      yield* withFeedback(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          const record = yield* submitAs({ anchor: anchorFor(revision) })
          yield* resolveAs(root, [{ feedbackId: record.feedbackId, disposition: 'rejected', note: 'Keep the existing text.' }])
          const changedRevision = yield* writeGuide(firstChild.id, CHANGED)
          const refreshed = yield* ParentFeedback.use(feedback => feedback.read({ agent: firstChild, feedbackId: record.feedbackId }))
          expect(refreshed.status).toBe('stale')
          expect(refreshed.resolutionReceipt).toMatchObject({ baseRevision: revision, observedRevision: changedRevision })
        }),
      )
    }),
  )

  it.effect('deduplicates concurrent parent resolutions and child wakeups', () =>
    Effect.gen(function* () {
      const { world, revision, storageRoot } = yield* setup
      yield* withFeedback(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          const record = yield* submitAs({ anchor: anchorFor(revision) })
          const response: ReadonlyArray<FeedbackResponse> = [{ feedbackId: record.feedbackId, disposition: 'accepted' }]
          const results = yield* Effect.all([resolveAs(root, response), resolveAs(root, response)], { concurrency: 'unbounded' })
          expect(results.flat()).toEqual([
            { feedbackId: record.feedbackId, status: 'resolved', notified: true },
            { feedbackId: record.feedbackId, status: 'resolved', notified: false },
          ])
          expect(world.childNotices).toHaveLength(1)
        }),
      )
    }),
  )

  it.effect('accepts batches of 20 and rejects larger batches before resolving any item', () =>
    Effect.gen(function* () {
      const { world, revision, storageRoot } = yield* setup
      yield* withFeedback(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          const records = yield* Effect.forEach(
            Array.from({ length: 21 }, (_, index) => `batch-${String(index)}`),
            operationId => submitAs({ operationId, anchor: anchorFor(revision) }),
          )
          const responses = records.map((record): FeedbackResponse => ({ feedbackId: record.feedbackId, disposition: 'accepted' }))
          expect((yield* Effect.flip(resolveAs(root, responses)))._tag).toBe('RequestInputInvalid')
          const statuses = yield* QuestionStore.use(store => Effect.map(store.feedback.entries, rows => rows.map(([, row]) => row.status)))
          expect(statuses.every(status => status === 'pending')).toBe(true)
          const results = yield* resolveAs(root, responses.slice(0, 20))
          expect(results).toHaveLength(20)
          expect(results.every(result => result.status === 'resolved')).toBe(true)
        }),
      )
    }),
  )

  it.effect('resolves after child shutdown and lets the reattached child retrieve the durable receipt across a Host restart', () =>
    Effect.gen(function* () {
      const { world, revision, storageRoot } = yield* setup
      const record = yield* withFeedback(storageRoot, world)(submitAs({ anchor: anchorFor(revision) }))
      world.live.delete(firstChild.id)
      yield* withFeedback(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          expect(yield* resolveAs(root, [{ feedbackId: record.feedbackId, disposition: 'deferred' }])).toEqual([
            { feedbackId: record.feedbackId, status: 'resolved', notified: true },
          ])
        }),
      )
      world.live.set(firstChild.id, firstChild)
      const reread = yield* withFeedback(
        storageRoot,
        world,
      )(ParentFeedback.use(feedback => feedback.read({ agent: firstChild, feedbackId: record.feedbackId })))
      expect(reread.resolutionReceipt).toMatchObject({ disposition: 'deferred', baseRevision: revision, observedRevision: revision })
    }),
  )

  it.effect('rejects a changed document before admission and a conflicting late resolution', () =>
    Effect.gen(function* () {
      const { world, writeGuide, revision, storageRoot } = yield* setup
      yield* withFeedback(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          yield* writeGuide(firstChild.id, CHANGED)
          expect((yield* Effect.flip(submitAs({ anchor: anchorFor(revision) }))).message).toMatch(/changed before feedback/)
          yield* writeGuide(firstChild.id, ORIGINAL)
          const record = yield* submitAs({ anchor: anchorFor(revision) })
          yield* resolveAs(root, [{ feedbackId: record.feedbackId, disposition: 'accepted' }])
          expect(yield* resolveAs(root, [{ feedbackId: record.feedbackId, disposition: 'rejected' }])).toEqual([
            { feedbackId: record.feedbackId, status: 'rejected', notified: false },
          ])
        }),
      )
    }),
  )

  it.effect('lets only the direct parent resolve and the owning child cancel pending feedback', () =>
    Effect.gen(function* () {
      const { world, revision, storageRoot } = yield* setup
      yield* withFeedback(
        storageRoot,
        world,
      )(
        Effect.gen(function* () {
          const record = yield* submitAs({ anchor: anchorFor(revision) })
          expect(yield* resolveAs(unrelatedAgent, [{ feedbackId: record.feedbackId, disposition: 'accepted' }])).toEqual([
            { feedbackId: record.feedbackId, status: 'rejected', notified: false },
          ])
          expect((yield* ParentFeedback.use(feedback => feedback.cancel({ agent: firstChild, feedbackId: record.feedbackId }))).status).toBe('cancelled')
          expect((yield* resolveAs(root, [{ feedbackId: record.feedbackId, disposition: 'accepted' }]))[0]?.status).toBe('rejected')
        }),
      )
    }),
  )

  it.effect('marks feedback whose parent wakeup failed as delivery-failed', () =>
    Effect.gen(function* () {
      const { world, revision, storageRoot } = yield* setup
      world.failParentDelivery = true
      const record = yield* withFeedback(storageRoot, world)(submitAs({ anchor: anchorFor(revision) }))
      expect(record.status).toBe('delivery-failed')
    }),
  )
})
