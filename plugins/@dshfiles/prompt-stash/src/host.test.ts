import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import promptStashHost from './host.js'
import type { SavedPrompt } from './library.js'
import { promptStashApi } from './library-api.js'

const prompt = (index: number): SavedPrompt => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  revision: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  title: `Prompt ${index}`,
  text: `Text ${index}`,
  updatedAt: 1_700_000_000_000 + index,
})

const mountedStash = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'prompt-stash-host-'))),
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
  const plugin = yield* Effect.promise(() => host.mount(promptStashHost, { packageId: '@dshfiles/prompt-stash' }))
  const client = createHostApiClient(host.ctx, promptStashApi, '@test/caller')
  return { host, plugin, client }
})

describe('prompt-stash Host wiring', () => {
  it.effect('serves the shared prompt library and keeps it across a reload', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { plugin, client } = yield* mountedStash
        expect((yield* Effect.promise(() => client.state())).prompts).toEqual([])

        const saved = yield* Effect.promise(() => client.save({ prompt: prompt(1), expectedRevision: null }))
        expect(saved.kind).toBe('applied')

        yield* Effect.promise(() => plugin.reload())
        const state = yield* Effect.promise(() => client.state())
        expect(state.prompts.map(item => item.id)).toEqual([prompt(1).id])
      }),
    ),
  )

  it.effect('rejects a stale prompt write and removes a stored prompt', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client } = yield* mountedStash
        yield* Effect.promise(() => client.save({ prompt: prompt(1), expectedRevision: null }))

        const stale = yield* Effect.promise(() => client.save({ prompt: prompt(1), expectedRevision: '20000000-0000-4000-8000-000000000009' }))
        expect(stale.kind).toBe('conflict')
        expect(stale.prompts[0]?.revision).toBe(prompt(1).revision)

        const removed = yield* Effect.promise(() => client.remove({ id: prompt(1).id, expectedRevision: prompt(1).revision }))
        expect(removed).toMatchObject({ kind: 'applied', prompts: [] })
      }),
    ),
  )
})
