import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostContext } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import type { AnnotationDraft } from './schema.js'
import { AnnotationStore } from './store.js'

/** A real JSON-backed storage domain facility in a temporary directory, as the Host serves it. */
const storageHost = Layer.effect(
  HostContext,
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'annotations-store-'))),
      directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    )
    const host = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const created = await createTestHost()
        await created.ctx.plugin(Storage)
        await created.ctx.plugin(StorageJson, { root })
        await created.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
        return created
      }),
      created => Effect.promise(() => created.dispose()),
    )
    return HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/annotations' })
  }),
)

const openStore = Effect.map(Layer.build(AnnotationStore.layer.pipe(Layer.provide(StorageDomain.layer), Layer.provide(storageHost))), services =>
  Context.get(services, AnnotationStore),
)

const sessionId = 'session-abc123'

const draft = (note: string): AnnotationDraft => ({
  kind: 'element',
  target: {
    surface: 'dsh',
    url: 'http://127.0.0.1:3080/',
    selector: '#save',
    tag: 'button',
    rect: { x: 0, y: 0, width: 80, height: 24 },
  },
  note,
})

const created = (store: AnnotationStore['Service'], note = 'make this clearer') =>
  store.create({ sessionId, drafts: [draft(note)], origin: 'dsh' }).pipe(
    Effect.flatMap(annotations => {
      const created = annotations[0]
      return created === undefined ? Effect.die('create answers with the annotation it stored') : Effect.succeed(created)
    }),
  )

describe('annotation status transitions', () => {
  it.effect('acknowledges a pending annotation once, then leaves it acknowledged', () =>
    Effect.gen(function* () {
      const store = yield* openStore
      const annotation = yield* created(store)

      const acknowledged = yield* store.ack({ sessionId, ids: [annotation.id] })
      expect(acknowledged.map(row => row.status)).toEqual(['acknowledged'])
      // Nothing left to acknowledge: the refused transition answers with no rows, as before.
      expect(yield* store.ack({ sessionId, ids: [annotation.id] })).toEqual([])
    }).pipe(Effect.scoped),
  )

  it.effect('acknowledges a stale annotation, and counts each status it reached', () =>
    Effect.gen(function* () {
      const store = yield* openStore
      const first = yield* created(store, 'first')
      const second = yield* created(store, 'second')
      yield* store.markStale({ sessionId, id: first.id, reason: 'element-missing' })

      const acknowledged = yield* store.ack({ sessionId, ids: [first.id, second.id] })
      expect(acknowledged.map(row => row.status)).toEqual(['acknowledged', 'acknowledged'])
      expect(yield* store.counts(sessionId)).toEqual({ pending: 0, acknowledged: 2, stale: 0, resolved: 0, dismissed: 0 })
    }).pipe(Effect.scoped),
  )

  it.effect('keeps a repeated stale report of the same reason idempotent, and refuses one on a closed annotation', () =>
    Effect.gen(function* () {
      const store = yield* openStore
      const annotation = yield* created(store)
      const stale = yield* store.markStale({ sessionId, id: annotation.id, reason: 'text-changed' })
      const repeated = yield* store.markStale({ sessionId, id: annotation.id, reason: 'text-changed' })
      expect(repeated.revision).toBe(stale.revision)

      yield* store.dismiss({ sessionId, id: annotation.id, reason: 'not worth it' })
      const refused = yield* Effect.result(store.markStale({ sessionId, id: annotation.id, reason: 'route-changed' }))
      expect(refused._tag).toBe('Failure')
    }).pipe(Effect.scoped),
  )

  it.effect('resolves with the revision it read, refuses a stale revision and a closed annotation', () =>
    Effect.gen(function* () {
      const store = yield* openStore
      const annotation = yield* created(store)

      const resolved = yield* store.resolve({ sessionId, id: annotation.id, revision: annotation.revision, resolvedBy: 'human' })
      expect(resolved.status).toBe('resolved')
      expect(resolved.resolution?.revision).toBe(annotation.revision)

      const stale = yield* Effect.result(store.resolve({ sessionId, id: annotation.id, revision: annotation.revision, resolvedBy: 'human' }))
      expect(stale._tag === 'Failure' ? stale.failure._tag : 'succeeded').toBe('AnnotationRevisionConflict')

      const closed = yield* Effect.result(store.resolve({ sessionId, id: annotation.id, revision: resolved.revision, resolvedBy: 'human' }))
      expect(closed._tag === 'Failure' ? closed.failure._tag : 'succeeded').toBe('AnnotationClosed')

      const dismissed = yield* created(store, 'drop this')
      yield* store.dismiss({ sessionId, id: dismissed.id, reason: 'duplicate' })
      const refused = yield* Effect.result(store.dismiss({ sessionId, id: dismissed.id, reason: 'again' }))
      expect(refused._tag === 'Failure' ? refused.failure._tag : 'succeeded').toBe('AnnotationClosed')
    }).pipe(Effect.scoped),
  )

  it.effect('adds a message to a closed annotation thread without moving its status', () =>
    Effect.gen(function* () {
      const store = yield* openStore
      const annotation = yield* created(store)
      yield* store.dismiss({ sessionId, id: annotation.id, reason: 'not now' })
      const replied = yield* store.reply({ sessionId, id: annotation.id, body: 'reopening later', role: 'human' })
      expect(replied.status).toBe('dismissed')
      expect(replied.thread.map(message => message.body)).toEqual(['Dismissed: not now', 'reopening later'])
    }).pipe(Effect.scoped),
  )
})
