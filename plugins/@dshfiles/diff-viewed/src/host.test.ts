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
import diffViewedHost from './host.js'
import { diffViewedApi, viewedKey } from './marks-api.js'

describe('diff-viewed Host wiring', () => {
  it.effect('serves durable marks that survive a plugin reload', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), 'diff-viewed-host-'))),
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
        const plugin = yield* Effect.promise(() => host.mount(diffViewedHost, { packageId: '@dshfiles/diff-viewed' }))
        const client = createHostApiClient(host.ctx, diffViewedApi, '@test/caller')
        const file = { sessionId: 'session-1', seq: 4, path: 'src/a.ts' }

        expect((yield* Effect.promise(() => client.state())).marks).toEqual([])
        expect((yield* Effect.promise(() => client.toggle(file))).marks).toEqual([viewedKey(file)])

        yield* Effect.promise(() => plugin.reload())
        expect((yield* Effect.promise(() => client.state())).marks).toEqual([viewedKey(file)])
      }),
    ),
  )
})
