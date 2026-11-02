import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import type { AnnotationDraft, AnnotationTarget } from '../src/schema.js'
import { AnnotationStore } from '../src/store.js'
import { StorageDomainLive } from './host-fixtures.js'

const target: AnnotationTarget = {
  surface: 'dsh',
  url: 'http://127.0.0.1:3080/',
  selector: 'button.primary',
  tag: 'button',
  text: 'Rebase',
  rect: { x: 0, y: 0, width: 10, height: 10 },
}

const draft = (note = 'note'): AnnotationDraft => ({ kind: 'element', target, note })

const sessionId = 'session-1'

const withStore = <A, E>(body: (store: AnnotationStore['Service']) => Effect.Effect<A, E>) =>
  Effect.flatMap(AnnotationStore, body).pipe(Effect.provide(AnnotationStore.layer.pipe(Layer.provide(StorageDomainLive))))

describe('annotation store', () => {
  it.effect('creates a pending annotation with a stable id', () =>
    withStore(store =>
      Effect.gen(function* () {
        const created = yield* store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
        expect(created).toHaveLength(1)
        expect(created[0]).toMatchObject({ id: 'ann_1', status: 'pending', revision: 1 })
        expect((yield* store.create({ sessionId, drafts: [draft()], origin: 'dsh' }))[0]?.id).toBe('ann_2')
      }),
    ),
  )

  it.effect('acknowledges only open annotations', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
        const acked = yield* store.ack({ sessionId, ids: ['ann_1'] })
        expect(acked[0]?.status).toBe('acknowledged')
        expect(acked[0]?.revision).toBeGreaterThan(1)
        expect(yield* store.ack({ sessionId, ids: ['ann_1'] })).toHaveLength(0)
      }),
    ),
  )

  it.effect('refuses to resolve a stale revision', () =>
    withStore(store =>
      Effect.gen(function* () {
        const [record] = yield* store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
        if (record === undefined) return yield* Effect.die('missing record')
        const resolved = yield* store.resolve({ sessionId, id: record.id, revision: record.revision, summary: 'fixed', resolvedBy: 'agent' })
        expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: 'agent', resolution: { summary: 'fixed' } })
        const again = yield* Effect.flip(store.resolve({ sessionId, id: record.id, revision: record.revision, resolvedBy: 'agent' }))
        expect(again._tag).toBe('AnnotationRevisionConflict')
      }),
    ),
  )

  it.effect('dismisses once and refuses a second dismiss', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
        const dismissed = yield* store.dismiss({ sessionId, id: 'ann_1', reason: 'wont fix' })
        expect(dismissed.status).toBe('dismissed')
        expect(dismissed.thread.at(-1)?.body).toContain('wont fix')
        expect((yield* Effect.flip(store.dismiss({ sessionId, id: 'ann_1', reason: 'again' })))._tag).toBe('AnnotationClosed')
      }),
    ),
  )

  it.effect('marks an element stale without resolving it', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
        const stale = yield* store.markStale({ sessionId, id: 'ann_1', reason: 'element-missing' })
        expect(stale.status).toBe('stale')
        expect(stale.target.staleReason).toBe('element-missing')
        expect((yield* store.counts(sessionId)).stale).toBe(1)
      }),
    ),
  )

  it.effect('keeps sessions apart', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.create({ sessionId, drafts: [draft()], origin: 'dsh' })
        yield* store.create({ sessionId: 'session-2', drafts: [draft(), draft()], origin: 'dsh' })
        expect(yield* store.list({ sessionId })).toHaveLength(1)
        expect(yield* store.list({ sessionId: 'session-2' })).toHaveLength(2)
        expect(yield* store.list({ sessionId: 'session-3' })).toHaveLength(0)
      }),
    ),
  )

  it.effect('ingests unattached extension feedback and attaches it to a chosen Session', () =>
    withStore(store =>
      Effect.gen(function* () {
        const accepted = yield* store.ingest({ drafts: [draft('from chrome')], extensionOrigin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' })
        expect(accepted).toHaveLength(1)
        expect(accepted[0]?.draft.target.surface).toBe('external')
        expect(yield* store.intake).toHaveLength(1)
        const attached = yield* store.attach({ sessionId, ids: [accepted[0]?.id ?? ''] })
        expect(attached[0]).toMatchObject({ origin: 'extension', sessionId })
        expect(yield* store.intake).toHaveLength(0)
      }),
    ),
  )

  it.effect('rotates the extension token', () =>
    withStore(store =>
      Effect.gen(function* () {
        const first = yield* store.token
        expect(first.length).toBeGreaterThan(20)
        const rotated = yield* store.rotateToken
        expect(rotated).not.toBe(first)
        expect(yield* store.token).toBe(rotated)
      }),
    ),
  )

  it.effect('reports a missing annotation', () =>
    withStore(store =>
      Effect.gen(function* () {
        const missing = yield* Effect.flip(store.resolve({ sessionId, id: 'ann_99', revision: 1, resolvedBy: 'agent' }))
        expect(missing).toMatchObject({ _tag: 'AnnotationNotFound', id: 'ann_99' })
      }),
    ),
  )
})
