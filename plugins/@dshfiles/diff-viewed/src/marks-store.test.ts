import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostContext } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { viewedKey } from './marks-api.js'
import { type ViewedMark, ViewedMarks, viewedMarksDomain } from './marks-store.js'

const storageHost = Layer.effect(
  HostContext,
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'diff-viewed-'))),
      directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    )
    const ctx = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const context = new CordisContext()
        await context.plugin(Storage)
        await context.plugin(StorageJson, { root })
        await context.plugin(StorageDomainPlugin, { backend: 'json' })
        return context
      }),
      context => Effect.promise(() => context.fiber.dispose()),
    )
    return HostContext.of({ ctx, packageId: '@dshfiles/diff-viewed' })
  }),
)

const storage = StorageDomain.layer.pipe(Layer.provideMerge(storageHost))

const storedKeys = Effect.scoped(
  Effect.gen(function* () {
    const domain = yield* (yield* StorageDomain).open(viewedMarksDomain)
    return (yield* domain.table('marks').entries).map(([key]) => key)
  }),
)

const seed = (marks: ReadonlyArray<ViewedMark>) =>
  Effect.flatMap(HostContext, host =>
    Effect.promise(async () => {
      const domain = await host.ctx.storageDomain.open(viewedMarksDomain)
      const table = domain.table('marks')
      await Promise.all(marks.map(mark => table.put(mark.key, mark)))
      await domain.close()
    }),
  )

const withMarks = <A, E>(effect: Effect.Effect<A, E, ViewedMarks>) => Effect.scoped(Effect.provide(effect, ViewedMarks.layer))

const file = { sessionId: 'session-1', seq: 4, path: 'src/a.ts' }

describe('ViewedMarks', () => {
  it.effect('a mark is stored durably and belongs to its own turn', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(5_000)
      const toggled = yield* withMarks(ViewedMarks.use(marks => marks.toggle(file)))
      expect(toggled.marks).toEqual([viewedKey(file)])
      expect(yield* storedKeys).toEqual([viewedKey(file)])

      yield* TestClock.setTime(5_100)
      yield* withMarks(
        Effect.gen(function* () {
          const marks = yield* ViewedMarks
          const reopened = yield* marks.snapshot
          expect(reopened).toEqual({ revision: 5_100, marks: [viewedKey(file)] })
          expect(reopened.marks).not.toContain(viewedKey({ ...file, seq: 9 }))
          expect(reopened.marks).not.toContain(viewedKey({ ...file, sessionId: 'session-2' }))
          expect((yield* marks.toggle(file)).marks).toEqual([])
        }),
      )
      expect(yield* storedKeys).toEqual([])
    }).pipe(Effect.provide(storage)),
  )

  it.effect('a new mark always outranks every stored version, even after a clock step back', () =>
    Effect.gen(function* () {
      yield* seed([{ key: viewedKey(file), version: 10_000 }])
      yield* TestClock.setTime(900)
      yield* withMarks(
        Effect.gen(function* () {
          const marks = yield* ViewedMarks
          expect((yield* marks.snapshot).revision).toBe(10_000)
          const toggled = yield* marks.toggle({ ...file, seq: 5 })
          expect(toggled.revision).toBe(10_001)
          expect(toggled.marks).toEqual([viewedKey(file), viewedKey({ ...file, seq: 5 })])
        }),
      )
    }).pipe(Effect.provide(storage)),
  )

  it.effect('the oldest marks are trimmed past the bound', () =>
    Effect.gen(function* () {
      yield* seed(Array.from({ length: 3 }, (_, seq) => ({ key: viewedKey({ ...file, seq }), version: 1 + seq })))
      yield* TestClock.setTime(5_000)
      const marks = yield* Effect.scoped(
        Effect.provide(
          ViewedMarks.use(viewed => viewed.toggle({ ...file, seq: 3 })),
          ViewedMarks.layerWithBound(3),
        ),
      ).pipe(Effect.map(snapshot => snapshot.marks))
      expect(marks.length).toBe(3)
      expect(marks).not.toContain(viewedKey({ ...file, seq: 0 }))
      expect(marks).toContain(viewedKey({ ...file, seq: 3 }))
      const stored = yield* storedKeys
      expect(stored.length).toBe(3)
      expect(stored).not.toContain(viewedKey({ ...file, seq: 0 }))
    }).pipe(Effect.provide(storage)),
  )

  it('the least recently written marks are the ones trimmed', () => {
    const mark = (key: string, version: number): ViewedMark => ({ key, version })
    expect(ViewedMarks.keysToTrim([mark('newest', 3), mark('oldest', 1), mark('middle', 2)], 2)).toEqual(['oldest'])
    expect(ViewedMarks.keysToTrim([mark('a', 1)], 2)).toEqual([])
    expect(ViewedMarks.nextVersion(1_000, 900)).toBe(1_001)
  })
})
