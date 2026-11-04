import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import pullRequestsHost from '../src/host.js'
import { pullRequestApi } from '../src/api.js'

const mountedHost = Effect.acquireRelease(
  Effect.promise(async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'pull-requests-host-'))
    const host = await createTestHost()
    await host.ctx.plugin(LocalSubprocessRuntime)
    await host.ctx.plugin(Storage)
    await host.ctx.plugin(StorageJson, { root: storageRoot })
    await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
    const plugin = await host.mount(pullRequestsHost, { packageId: '@dshfiles/pull-requests' })
    const client = createHostApiClient(host.ctx, pullRequestApi, '@test/pull-request-host')
    return { host, plugin, client, storageRoot }
  }),
  mounted =>
    Effect.promise(async () => {
      await mounted.host.dispose()
      await rm(mounted.storageRoot, { recursive: true, force: true })
    }),
)

describe('pull-requests Host API', () => {
  it.effect('links, lists, unwatches and unlinks a PR through the served API', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mounted = yield* mountedHost
        const sessionId = 'pull-request-test-session'
        const url = 'https://github.com/acme/widget/pull/42'

        const linked = yield* Effect.promise(() => mounted.client.link({ sessionId, url }))
        expect(linked.link).toMatchObject({ sessionId, repo: 'acme/widget', number: 42, url, watching: false, lastKnownState: null })
        expect(linked.link).not.toHaveProperty('cwd')
        expect(linked.link).not.toHaveProperty('retryAfterAt')
        yield* Effect.promise(() => mounted.plugin.reload())

        const listed = yield* Effect.promise(() => mounted.client.list({ sessionId }))
        expect(listed).toMatchObject({ total: 1, all: false, links: [{ sessionId, repo: 'acme/widget', number: 42 }] })

        const unwatched = yield* Effect.promise(() => mounted.client.unwatch({ sessionId, url }))
        expect(unwatched.link.watching).toBe(false)

        const removed = yield* Effect.promise(() => mounted.client.unlink({ sessionId, url }))
        expect(removed).toEqual({ sessionId, repo: 'acme/widget', number: 42, removed: true })
        expect((yield* Effect.promise(() => mounted.client.list({ sessionId }))).links).toEqual([])
      }),
    ),
  )
})
