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
import type { SavedPrompt } from './library.js'
import { PromptStash, promptStashDomain } from './store.js'

const prompt = (index: number, updatedAt = index): SavedPrompt => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  revision: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Prompt ${index}`,
  text: `Text ${index}`,
  updatedAt,
})

const storageHost = Layer.effect(
  HostContext,
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'prompt-stash-'))),
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
    return HostContext.of({ ctx, packageId: '@dshfiles/prompt-stash' })
  }),
)

const storage = StorageDomain.layer.pipe(Layer.provideMerge(storageHost))

const storedPromptIds = Effect.scoped(
  Effect.gen(function* () {
    const domain = yield* (yield* StorageDomain).open(promptStashDomain)
    return (yield* domain.table('prompts').entries).map(([id]) => id).sort()
  }),
)

const withStash = <A, E>(effect: Effect.Effect<A, E, PromptStash>) => Effect.scoped(Effect.provide(effect, PromptStash.layer))

describe('PromptStash', () => {
  it.effect('saves prompts durably, newest edit first, with a monotone revision', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(5_000)
      yield* withStash(
        Effect.gen(function* () {
          const stash = yield* PromptStash
          expect(yield* stash.save({ prompt: prompt(1, 1_000), expectedRevision: null })).toEqual({
            kind: 'applied',
            revision: 5_001,
            prompts: [prompt(1, 1_000)],
          })
          expect((yield* stash.save({ prompt: prompt(2, 2_000), expectedRevision: null })).revision).toBe(5_002)
          expect((yield* stash.snapshot).prompts.map(item => item.id)).toEqual([prompt(2).id, prompt(1).id])
        }),
      )
      expect(yield* storedPromptIds).toEqual([prompt(1).id, prompt(2).id])
    }).pipe(Effect.provide(storage)),
  )

  it.effect('reloads stored prompts with a revision above every stored edit', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      yield* withStash(PromptStash.use(stash => stash.save({ prompt: prompt(1, 9_000), expectedRevision: null })))
      const reloaded = yield* withStash(PromptStash.use(stash => stash.snapshot))
      expect(reloaded).toEqual({ revision: 9_000, prompts: [prompt(1, 9_000)] })
    }).pipe(Effect.provide(storage)),
  )

  it.effect('refuses to overwrite a prompt another writer changed', () =>
    withStash(
      Effect.gen(function* () {
        yield* TestClock.setTime(6_000)
        const stash = yield* PromptStash
        yield* stash.save({ prompt: prompt(1, 1_000), expectedRevision: null })

        const stale = yield* stash.save({ prompt: prompt(1, 9_000), expectedRevision: '20000000-0000-4000-8000-000000000001' })
        expect(stale.kind).toBe('conflict')
        expect(stale.prompts[0]?.updatedAt).toBe(1_000)

        const applied = yield* stash.save({ prompt: prompt(1, 9_000), expectedRevision: prompt(1).revision })
        expect(applied.kind).toBe('applied')
        expect((yield* stash.snapshot).prompts[0]?.updatedAt).toBe(9_000)
      }),
    ).pipe(Effect.provide(storage)),
  )

  it.effect('removes a prompt only at the revision the caller saw', () =>
    Effect.gen(function* () {
      yield* withStash(
        Effect.gen(function* () {
          const stash = yield* PromptStash
          yield* stash.save({ prompt: prompt(1), expectedRevision: null })
          expect((yield* stash.remove({ id: prompt(1).id, expectedRevision: '20000000-0000-4000-8000-000000000001' })).kind).toBe('conflict')
          expect((yield* stash.remove({ id: prompt(1).id, expectedRevision: prompt(1).revision })).prompts).toEqual([])
        }),
      )
      expect(yield* storedPromptIds).toEqual([])
    }).pipe(Effect.provide(storage)),
  )

  it.effect('stops at the library limit instead of dropping a stored prompt', () =>
    withStash(
      Effect.gen(function* () {
        const stash = yield* PromptStash
        for (let index = 1; index <= 50; index += 1) {
          expect((yield* stash.save({ prompt: prompt(index), expectedRevision: null })).kind).toBe('applied')
        }
        const overLimit = yield* stash.save({ prompt: prompt(51), expectedRevision: null })
        expect(overLimit.kind).toBe('limit')
        expect(overLimit.prompts).toHaveLength(50)
      }),
    ).pipe(Effect.provide(storage)),
  )

  it('orders equally recent prompts by identity for a stable list', () => {
    expect(PromptStash.orderPrompts([prompt(2, 5), prompt(1, 5)]).map(item => item.id)).toEqual([prompt(1).id, prompt(2).id])
  })
})
