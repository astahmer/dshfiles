import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { AskUserQuestionAnswer, PendingUserQuestion } from '@deepseek-ai/dsh-user-questions'
import { attentionApi, type AttentionActRequest, type AttentionDraft, type AttentionItem } from '@dshfiles/activity-timeline/attention-api'
import { HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { NativeQuestions } from './agent-host-promise.js'
import { NATIVE_QUESTION_SOURCE, NativeQuestionAttention } from './native-question-attention.js'
import { projectNativeQuestion } from './question-inbox.js'
import { QuestionFacts, QuestionScan } from './question-scan.js'

const form = (overrides: Partial<PendingUserQuestion> = {}): PendingUserQuestion =>
  // SAFETY: a test fixture: every field the projection reads is set below, and the rest of the native form is unused.
  ({
    callId: 'call-1',
    state: 'continued',
    questions: [{ id: 'deploy', question: 'Deploy the release now?', options: [{ label: 'Deploy (Recommended)' }, { label: 'Wait' }] }],
    ...overrides,
  }) as PendingUserQuestion

const projected = (pending: PendingUserQuestion, live = true) =>
  projectNativeQuestion({ sessionId: 'session-root', sessionLive: live, sessionPersisted: true, targetIsLiveRoot: live, pending, observedAt: 1 })

const itemFor = (draft: AttentionDraft): AttentionItem => ({
  ...draft,
  id: 'item',
  source: NATIVE_QUESTION_SOURCE,
  detail: draft.detail ?? null,
  choices: draft.choices ?? [],
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

describe('native question inbox provider', () => {
  it('states a continued single-select form as answerable in place, and other forms as answer-in-thread', () => {
    const [answerable, inThread, several] = NativeQuestionAttention.draftsOf([
      projected(form()),
      projected(form({ callId: ToolCallId('call-2'), state: 'open' })),
      projected(
        form({
          callId: ToolCallId('call-3'),
          // SAFETY: a second free-text question in the same shape the fixture form already carries.
          questions: [...form().questions, { id: 'why', question: 'Why?', options: [] }] as PendingUserQuestion['questions'],
        }),
      ),
    ])
    expect(answerable).toEqual({
      dedupeKey: 'session-root:call-1',
      subject: { kind: 'session', id: 'session-root' },
      reason: 'Asks: Deploy the release now?',
      detail: 'Choose an answer here, or open the thread to write your own.',
      severity: 'blocking',
      verbs: ['Answer', 'Open', 'Done', 'Snooze', 'MuteSource'],
      choices: [
        { id: '0', label: 'Deploy', recommended: true },
        { id: '1', label: 'Wait' },
      ],
    })
    expect(inThread).toMatchObject({
      dedupeKey: 'session-root:call-2',
      verbs: ['Open', 'Done', 'Snooze', 'MuteSource'],
      detail: 'Open the thread to answer it there.',
    })
    expect(inThread).not.toHaveProperty('choices')
    expect(several).toMatchObject({ reason: 'Asks: Deploy the release now? (+1 more)', verbs: ['Open', 'Done', 'Snooze', 'MuteSource'] })
  })

  it('states pending forms of live threads, answers one in place through the native answer API, and resolves it', async () => {
    const host = await createTestHost()
    const stated: (readonly AttentionDraft[])[] = []
    const refuse = () => {
      throw new Error('not used by the native question provider')
    }
    const inbox = await host.mount(
      defineHost({
        name: 'activity-timeline',
        apis: [
          attentionApi.host({
            list: refuse,
            publish: refuse,
            resolve: refuse,
            done: refuse,
            snooze: refuse,
            reopen: refuse,
            muteSource: refuse,
            act: refuse,
            reconcile: ({ input }) => {
              if (input.source === NATIVE_QUESTION_SOURCE) stated.push(input.items)
              return { published: input.items.length, resolved: 0 }
            },
          }),
        ],
      }),
      { packageId: '@dshfiles/activity-timeline' },
    )
    let forms: PendingUserQuestion[] = [form()]
    const answers: { readonly sessionId: string; readonly callId: string; readonly answer: AskUserQuestionAnswer }[] = []
    const native = Layer.succeed(
      NativeQuestions,
      NativeQuestions.of({
        liveRootIds: () => new Set(['session-root']),
        isLiveRoot: () => true,
        listTargets: () =>
          Effect.succeed([
            { sessionId: 'session-root', sessionLive: true, sessionPersisted: true, targetIsLiveRoot: true },
            { sessionId: 'session-child', sessionLive: true, sessionPersisted: true, targetIsLiveRoot: false },
          ]),
        answer: input => {
          answers.push(input)
          forms = forms.filter(entry => entry.callId !== input.callId)
          return 'queued'
        },
      }),
    )
    const facts = Layer.succeed(
      QuestionFacts,
      QuestionFacts.of({
        load: target =>
          Effect.succeed(
            target.sessionId === 'session-root' ? { facts: { pending: forms, waits: [] }, projectionUnavailable: false } : { projectionUnavailable: true },
          ),
      }),
    )
    const statedCount = async (count: number): Promise<readonly AttentionDraft[]> => {
      for (let attempt = 0; attempt < 200 && stated.length < count; attempt += 1) await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
      expect(stated).toHaveLength(count)
      return stated.at(-1) ?? []
    }
    const runtime = ManagedRuntime.make(
      NativeQuestionAttention.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(native, QuestionScan.layer.pipe(Layer.provide(facts)), HostApis.layer)),
        Layer.provideMerge(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/agent-questions' }))),
      ),
    )
    const act = (request: AttentionActRequest) => host.ctx.serial('dshfiles/attention/act', request)
    try {
      await runtime.runPromise(Effect.void)
      const [draft] = await statedCount(1)
      expect(draft).toMatchObject({ dedupeKey: 'session-root:call-1', severity: 'blocking' })
      if (draft === undefined) throw new Error('no draft stated')

      expect(await act({ item: { ...itemFor(draft), source: 'other.source' }, verb: 'Answer', choiceId: '0' })).toBeUndefined()
      expect(await act({ item: itemFor(draft), verb: 'Answer', choiceId: '7' })).toMatchObject({ ok: false })
      expect(await act({ item: itemFor(draft), verb: 'Answer', choiceId: '0' })).toEqual({
        ok: true,
        message: 'Answered “Deploy (Recommended)”. The thread continues once it reads the reply.',
      })
      expect(answers).toEqual([{ sessionId: 'session-root', callId: 'call-1', answer: { answers: [{ id: 'deploy', selected: ['Deploy (Recommended)'] }] } }])

      // The reply settled the form: the next pass states nothing, so the inbox resolves the item.
      host.ctx.emit('dshfiles/attention/ready', { version: 1 })
      expect(await statedCount(2)).toEqual([])
      expect(await act({ item: itemFor(draft), verb: 'Answer', choiceId: '0' })).toMatchObject({ ok: false })
    } finally {
      await runtime.dispose()
      await inbox.dispose()
      await host.dispose()
    }
  })
})
