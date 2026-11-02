import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { AiActivity } from './ai-activity.js'
import { HostAttachments } from './host-edge-promise.js'
import { BacklogStore } from './store.js'
import { backlogStoreLayer } from './test-support.js'
import { TweetImport } from './tweet-import.js'

const tweetImportLayer = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      host => Effect.sync(() => host.dispose()),
    ),
    host =>
      TweetImport.layer.pipe(
        Layer.provideMerge(Layer.mergeAll(backlogStoreLayer(), AiActivity.layer, HostApis.layer, HostAttachments.layer)),
        Layer.provideMerge(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/backlog' })),
      ),
  ),
)

describe('TweetImport', () => {
  it.layer(tweetImportLayer)(it => {
    it.effect('records one bounded span for the import work unit', () =>
      Effect.gen(function* () {
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          spans => Effect.sync(() => spans[Symbol.dispose]()),
        )
        const store = yield* BacklogStore
        const created = yield* store.capture({ text: 'Read https://x.com/writer/status/123', actor: { kind: 'user' } })
        const url = 'https://x.com/i/status/123'
        yield* store.importTweetContext({ id: created.item.id, url, bodySection: '> quoted post', files: [], actor: { kind: 'system' } })

        const imported = yield* (yield* TweetImport).import({ id: created.item.id, url, actor: { kind: 'user' } })

        expect(imported.ok && imported.value.item.tweetContextUrls).toEqual([url])
        const span = recorder.span('backlog tweet import')
        expect(span.attributes['dshx.backlog.item_id']).toBe(created.item.id)
        expect(span.attributes['dshx.backlog.tweet_import.outcome']).toBe('succeeded')
      }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
    )

    it.effect('refuses a post URL the item does not name', () =>
      Effect.gen(function* () {
        const created = yield* (yield* BacklogStore).capture({ text: 'No tweet here', actor: { kind: 'user' } })
        const error = yield* Effect.flip((yield* TweetImport).import({ id: created.item.id, url: 'https://x.com/i/status/9', actor: { kind: 'user' } }))
        expect(error._tag).toBe('TweetUrlNotInItem')
      }),
    )
  })
})
