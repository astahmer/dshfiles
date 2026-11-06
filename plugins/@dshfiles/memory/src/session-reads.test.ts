import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'

import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { SessionReads } from './session-reads-promise.ts'

const sessionId = 'session-11111111-0000-4000-8000-000000000000'

const readsLayer = (ctx: CordisContext) => SessionReads.layer.pipe(Layer.provide(HostContext.layer({ ctx, packageId: '@test/memory' })))

describe('SessionReads', () => {
  it.effect('reads a sessionQuery service provided after activation instead of the snapshot taken at activation', () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        created => Effect.promise(() => created.dispose()),
      )
      const reads = Context.get(yield* Layer.build(readsLayer(host.ctx)), SessionReads)

      expect(yield* Effect.result(reads.searchContent({ query: 'retry storm', limit: 5 }))).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'ContentSearchFailed', code: 'unavailable' },
      })
      expect(yield* Effect.result(reads.list)).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SessionListUnavailable' } })

      host.ctx.provide('sessionQuery', {
        readSession: async () => ({ session: { id: sessionId }, inheritedEventCount: 0, events: [] }),
        listSessions: async () => [{ header: { id: sessionId }, live: false, persisted: true }],
        searchSessions: async () => ({ items: [{ header: { id: sessionId }, bestMatch: { snippet: 'capped the retry storm' } }] }),
      })

      const page = yield* reads.searchContent({ query: 'retry storm', limit: 5 })
      expect(page.hits).toEqual([{ sessionId, snippet: 'capped the retry storm' }])
      expect((yield* reads.list).map(entry => entry.header.id)).toEqual([sessionId])
    }),
  )
})
