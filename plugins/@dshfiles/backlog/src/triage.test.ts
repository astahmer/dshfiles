import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { Jev } from '@dshfiles/jev'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { AiActivity } from './ai-activity.js'
import type { BacklogItem } from './item.js'
import { backlogSettings, type BacklogSettings } from './settings.js'
import { BacklogStore } from './store.js'
import { backlogStoreLayer } from './test-support.js'
import { BacklogTriage, type TriageServices } from './triage.js'
import { Triage } from './triage-service.js'

const item = (id: number, title: string, fields: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  title,
  body: '',
  kind: 'task',
  status: 'inbox',
  project: null,
  tags: [],
  links: [],
  attachments: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  humanFields: [],
  createdAt: id,
  lastActivityAt: id,
  events: [],
  ...fields,
})

/** The triage service over a real store, with only Jev, the model and the Secret Catalog replaced at their edges. */
const triageLayer = (settings: Partial<BacklogSettings>) =>
  Triage.layer.pipe(
    Layer.provideMerge(backlogStoreLayer({ settings })),
    Layer.provideMerge(AiActivity.layer),
    Layer.provideMerge(Layer.succeed(Jev, Jev.of({ ask: () => Effect.die('unused') }))),
    Layer.provideMerge(Layer.succeed(Llm, Llm.of({ complete: () => Effect.die('unused') } as never))),
    Layer.provideMerge(
      Layer.succeed(SecretReferenceResolver, SecretReferenceResolver.of({ resolve: () => Effect.succeedNone, resolveWithLabel: () => Effect.succeedNone })),
    ),
  )

const jevAnswering =
  (answers: { readonly actionable: number; readonly duplicate?: number }): TriageServices['jev'] =>
  request =>
    Effect.succeed(request.question.instructions.startsWith('Is `content` work') ? answers.actionable : (answers.duplicate ?? 0))

describe('triage', () => {
  it.effect('does not ask Jev to move a newly captured task out of the inbox', () =>
    Effect.gen(function* () {
      const proposal = yield* BacklogTriage.run({
        item: item(1, 'Fix the paste handler'),
        others: [],
        services: { jev: jevAnswering({ actionable: 0.9 }) },
        now: 5,
      })
      expect(proposal).toBeNull()
    }),
  )

  it.effect('skips the actionable question when the kind was explicitly chosen', () =>
    Effect.gen(function* () {
      let jevCalls = 0
      const proposal = yield* BacklogTriage.run({
        item: item(1, 'Fix the paste handler', { humanFields: ['kind'] }),
        others: [],
        services: {
          jev: () =>
            Effect.sync(() => {
              jevCalls += 1
              return 0.9
            }),
        },
        now: 5,
      })
      expect(proposal).toBeNull()
      expect(jevCalls).toBe(0)
    }),
  )

  it.effect('turns a plain capture Jev reads as knowledge into a note', () =>
    Effect.gen(function* () {
      const proposal = yield* BacklogTriage.run({
        item: item(1, 'Kodiak rebases FIFO, never click Update branch'),
        others: [],
        services: { jev: jevAnswering({ actionable: 0.1 }) },
        now: 5,
      })
      expect(proposal?.kind).toBe('note')
      expect(proposal?.confidence).toBe(0.9)
    }),
  )

  it.effect('flags the closest open item as a duplicate when Jev says it is the same work', () =>
    Effect.gen(function* () {
      const others = [
        item(1, 'Wire jj revision signals to auto-move items'),
        item(2, 'Rotate the Doppler token'),
        item(3, 'Wire jj signals to move items', { status: 'done' }),
      ]
      const proposal = yield* BacklogTriage.run({
        item: item(4, 'Auto-move items from jj revision signals'),
        others,
        services: { jev: jevAnswering({ actionable: 0.8, duplicate: 0.85 }) },
        now: 5,
      })
      expect(proposal?.duplicateOf).toBe(1)
    }),
  )

  it.effect('takes the model answer, dropping invalid fields and duplicates it was not shown', () =>
    Effect.gen(function* () {
      const complete: TriageServices['complete'] = () =>
        Effect.succeed(
          'Sure: {"kind": "bug", "status": "sideways", "title": "Composer drops chips on paste", "tags": ["composer"], "duplicateOf": 99, "confidence": 0.92, "reason": "Something is broken."}',
        )
      const proposal = yield* BacklogTriage.run({ item: item(1, 'composer drops chips on paste'), others: [], services: { complete }, now: 5 })
      expect(proposal).toEqual({
        kind: 'bug',
        title: 'Composer drops chips on paste',
        tags: ['composer'],
        confidence: 0.92,
        reason: 'Something is broken.',
        source: 'model',
        at: 5,
      })
    }),
  )

  it.effect('uses the configured model without making a redundant Jev request or changing status', () =>
    Effect.gen(function* () {
      let jevCalls = 0
      const complete: TriageServices['complete'] = () =>
        Effect.succeed('{"kind": "idea", "status": "doing", "confidence": 0.95, "reason": "A possible feature."}')
      const jev: TriageServices['jev'] = () =>
        Effect.sync(() => {
          jevCalls += 1
          return 0.4
        })
      const proposal = yield* BacklogTriage.run({
        item: item(1, 'A weekly digest of dormant items'),
        others: [],
        services: { jev, complete },
        now: 5,
      })
      expect(proposal).toEqual({ kind: 'idea', confidence: 0.95, reason: 'A possible feature.', source: 'model', at: 5 })
      expect(jevCalls).toBe(0)
    }),
  )

  it.effect('proposes nothing when every service fails or nothing would change', () =>
    Effect.gen(function* () {
      const failing: TriageServices = { jev: () => Effect.fail('down'), complete: () => Effect.succeed('not json') }
      expect(yield* BacklogTriage.run({ item: item(1, 'Anything'), others: [], services: failing, now: 5 })).toBeNull()
      const agreeing: TriageServices = { jev: jevAnswering({ actionable: 0.9 }) }
      expect(yield* BacklogTriage.run({ item: item(1, 'Anything', { status: 'todo' }), others: [], services: agreeing, now: 5 })).toBeNull()
    }),
  )

  it('learns from items whose applied triage the user corrected by hand', () => {
    const corrected = item(1, 'Kodiak note', {
      kind: 'note',
      status: 'todo',
      events: [
        { at: 1, actor: 'system', kind: 'triaged', detail: 'applied kind bug, status todo' },
        { at: 2, actor: 'user', kind: 'edited', detail: 'kind' },
      ],
    })
    const untouched = item(2, 'Fine as is', { events: [{ at: 1, actor: 'system', kind: 'triaged', detail: 'applied status todo' }] })
    expect(BacklogTriage.correctionsFrom([corrected, untouched])).toEqual([
      { title: 'Kodiak note', suggested: 'kind bug, status todo', chosen: 'kind note, status todo' },
    ])
  })
})

describe('thread resolution', () => {
  it.effect('suggests done when Jev reads the reply as having finished the item', () =>
    Effect.gen(function* () {
      const proposal = yield* BacklogTriage.resolveThread({
        item: item(1, 'Rework the composer chips', { status: 'doing' }),
        reply: 'Landed the rework in jj:nozwvrtk; the old chips are gone and the tests pass.',
        jev: request => Effect.succeed(request.question.instructions.includes('finished the work') ? 0.86 : 0),
        now: 9,
      })
      expect(proposal).toEqual({
        status: 'done',
        confidence: 0.86,
        reason: "The thread's last reply says the work is done.",
        source: 'jev',
        origin: 'thread',
        at: 9,
      })
    }),
  )

  it.effect('suggests nothing when the reply only reports progress, leaves work, or Jev fails', () =>
    Effect.gen(function* () {
      const open = yield* BacklogTriage.resolveThread({
        item: item(1, 'Rework the composer chips', { status: 'doing' }),
        reply: 'Started on the chips; the attachment path still needs a test.',
        jev: () => Effect.succeed(0.31),
        now: 9,
      })
      expect(open).toBeNull()
      const failing = yield* BacklogTriage.resolveThread({
        item: item(1, 'Rework the composer chips', { status: 'doing' }),
        reply: 'Done.',
        jev: () => Effect.fail('down'),
        now: 9,
      })
      expect(failing).toBeNull()
    }),
  )
})

describe('backlog triage host span', () => {
  it.effect('records one bounded backlog triage pass span with the item id', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      const store = yield* BacklogStore
      const triage = yield* Triage
      const created = yield* store.capture({ text: 'Fix the paste handler', actor: { kind: 'user' } })

      yield* triage.pass({ id: created.item.id, setup: { settings: backlogSettings.schema({}), services: {} } })

      const span = recorder.span('backlog triage pass')
      expect(span.attributes['dshx.backlog.item_id']).toBe(created.item.id)
    }).pipe(Effect.provide(triageLayer({ jevEnabled: false })), Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )
})

describe('Backlog Jev setup status', () => {
  it.effect('reports that Jev needs its key when it is on without one', () =>
    Effect.gen(function* () {
      const triage = yield* Triage
      expect(yield* triage.jevNeedsSetup).toBe(true)
      expect(yield* Effect.flip(triage.setup)).toMatchObject({ reason: 'jev-key-missing' })
    }).pipe(Effect.provide(triageLayer({ jevEnabled: true, jevSecret: '' })), Effect.scoped),
  )

  it.effect('reports no setup need when Jev is off', () =>
    Effect.gen(function* () {
      expect(yield* (yield* Triage).jevNeedsSetup).toBe(false)
    }).pipe(Effect.provide(triageLayer({ jevEnabled: false })), Effect.scoped),
  )
})
