import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as activityTimeline from '@dshfiles/activity-timeline'
import { attentionApi } from '@dshfiles/activity-timeline/attention-api'
import { HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { join } from 'node:path'
import { Effect, Fiber, Layer, Schedule } from 'effect'
import { CHILD_QUESTION_SOURCE, ChildQuestionAttention } from './attention-provider.js'
import { ParentQuestions, type ParentQuestionAgent } from './parent-questions.js'
import { QuestionStore } from './question-store.js'
import { AgentQuestionsTesting } from './test-support.js'

const parent: ParentQuestionAgent = { id: 'root-session' }
const child: ParentQuestionAgent = { id: 'child-session' }

/** The real activity-timeline Host (the inbox owner) and the agent-questions provider on one Cordis context. */
const inboxWithProvider = Effect.gen(function* () {
  const root = yield* AgentQuestionsTesting.temporaryDirectory('attention-inbox-e2e-')
  const previousHome = process.env.DSH_HOME
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.DSH_HOME = root
    }),
    () =>
      Effect.sync(() => {
        if (previousHome === undefined) delete process.env.DSH_HOME
        else process.env.DSH_HOME = previousHome
      }),
  )
  const host = yield* Effect.acquireRelease(
    Effect.promise(() => createTestHost()),
    created => Effect.promise(() => created.dispose()),
  )
  // SAFETY: the timeline only injects `agents` to order its activation; it never calls the service.
  const releaseAgents = host.ctx.provide('agents', {} as never)
  yield* Effect.addFinalizer(() => Effect.sync(releaseAgents))
  yield* Effect.promise(async () => {
    await host.ctx.plugin(Storage)
    await host.ctx.plugin(StorageJson, { root: join(root, 'storage') })
    await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
  })
  yield* Effect.promise(() => host.mount(activityTimeline, { packageId: '@dshfiles/activity-timeline', native: true }))
  const world = AgentQuestionsTesting.makeWorld({ agents: [parent, child], parents: [[child.id, parent.id]] })
  const provider = ChildQuestionAttention.layer.pipe(
    Layer.provideMerge(ParentQuestions.layer),
    Layer.provideMerge(QuestionStore.layer),
    Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, HostApis.layer, AgentQuestionsTesting.fakeAgentDirectory(world))),
    Layer.provideMerge(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/agent-questions' }))),
  )
  // The Inbox page calls the inbox as a browser does; a plugin caller is enough for list and act, which any caller may use.
  return { provider, inbox: createHostApiClient(host.ctx, attentionApi, '@test/inbox-page') }
})

const until = <A>(read: () => Promise<A>, done: (value: A) => boolean) =>
  Effect.promise(read).pipe(Effect.repeat({ schedule: Schedule.spaced('25 millis'), until: done, times: 200 }))

describe('attention inbox with the agent-questions provider', () => {
  it.live('lists a pending child question as blocking, answers it in place, and resolves the item', () =>
    Effect.gen(function* () {
      const { provider, inbox } = yield* inboxWithProvider
      yield* Effect.gen(function* () {
        const questions = yield* ParentQuestions
        const receipt = yield* questions.request({
          agent: child,
          operationId: 'call-1',
          question: 'Deploy the release now?',
          options: [
            { id: 'deploy', label: 'Deploy' },
            { id: 'wait', label: 'Wait' },
          ],
          recommendedOptionId: 'deploy',
          expiryBehavior: 'recommended',
          timeoutMs: 600_000,
        })
        const waiting = yield* Effect.forkChild(questions.wait({ agent: child, questionId: receipt.questionId }))

        const listed = yield* until(
          () => inbox.list({}),
          list => list.counts.needsYou === 1,
        )
        expect(listed.counts).toMatchObject({ needsYou: 1, blocking: 1 })
        const item = listed.items[0]
        expect(item).toMatchObject({
          source: CHILD_QUESTION_SOURCE,
          dedupeKey: receipt.questionId,
          subject: { kind: 'session', id: parent.id },
          reason: 'A subagent asks: Deploy the release now?',
          severity: 'blocking',
          choices: [
            { id: 'deploy', label: 'Deploy', recommended: true },
            { id: 'wait', label: 'Wait' },
          ],
        })

        const outcome = yield* Effect.promise(() => inbox.act({ id: item?.id ?? '', verb: 'Answer', choiceId: 'deploy' }))
        expect(outcome.ok).toBe(true)
        expect(yield* Fiber.join(waiting)).toMatchObject({ kind: 'answered', questionId: receipt.questionId })

        const after = yield* until(
          () => inbox.list({}),
          list => list.counts.needsYou === 0,
        )
        expect(after.items).toEqual([])
        const closed = yield* Effect.promise(() => inbox.list({ view: 'closed' }))
        expect(closed.items.map(closedItem => [closedItem.dedupeKey, closedItem.resolvedAt !== null])).toEqual([[receipt.questionId, true]])
      }).pipe(Effect.provide(provider))
    }),
  )
})
