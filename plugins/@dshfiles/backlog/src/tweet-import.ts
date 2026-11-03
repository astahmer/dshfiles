import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { tweetContextBacklogApi } from '@dshfiles/tweet-context/backlog-api'
import { Context, Effect, FiberMap, Layer } from 'effect'
import { AiActivity } from './ai-activity.js'
import type { BacklogDetailResult } from './api.js'
import { BacklogTweetContext } from './backlog-tweet-context.js'
import { TweetContextFailed, TweetContextUnavailable, TweetDescriptionFull, TweetImageInvalid, TweetUrlNotInItem, type BacklogWriteFailed } from './errors.js'
import { BacklogItems, type BacklogFileInput } from './item.js'
import { HostAttachments } from './host-edge-promise.js'
import { BacklogStore, type BacklogActor } from './store.js'

type TweetImportError = BacklogWriteFailed | TweetUrlNotInItem | TweetContextUnavailable | TweetContextFailed | TweetImageInvalid | TweetDescriptionFull

/** Public X posts an item names, imported once into its description with their images as attachments. */
export class TweetImport extends Context.Service<
  TweetImport,
  {
    readonly import: (input: {
      readonly id: number
      readonly url: string
      readonly actor: BacklogActor
    }) => Effect.Effect<BacklogDetailResult, TweetImportError>
    /** Import the first post an item names in the background; a second request for the same post joins the first. */
    readonly schedule: (id: number) => Effect.Effect<void>
  }
>()('@dshfiles/backlog/TweetImport') {
  static readonly layer = Layer.effect(
    TweetImport,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const images = yield* HostAttachments
      const activity = yield* AiActivity
      const tweets = (yield* HostApis).client(tweetContextBacklogApi)
      const running = yield* FiberMap.make<string>()

      const importContext = Effect.fn('backlog tweet import')(
        function* (input: { readonly id: number; readonly url: string; readonly actor: BacklogActor }) {
          yield* Effect.annotateCurrentSpan({ 'dshx.plugin.package': '@dshfiles/backlog', 'dshx.backlog.item_id': input.id })
          const found = yield* store.get(input.id)
          if (!found.ok) return found
          const item = found.value.item
          const url = BacklogTweetContext.normalizeUrl(input.url)
          if (url === undefined || !BacklogTweetContext.urls(`${item.title}\n${item.body}`).includes(url)) return yield* new TweetUrlNotInItem()
          if (item.tweetContextUrls?.includes(url)) return found
          const retrieved = yield* tweets
            .retrieve({ url })
            .pipe(Effect.mapError(error => (error.kind === 'unavailable' ? new TweetContextUnavailable() : new TweetContextFailed({ cause: error }))))
          const room = Math.max(0, BacklogItems.maxAttachments - item.attachments.length)
          const files = yield* Effect.forEach(retrieved.images.slice(0, room), image =>
            Effect.gen(function* () {
              const reference: ImageAttachmentRef = {
                attachmentId: AttachmentId(image.attachmentId),
                mediaType: image.mediaType,
                bytes: image.bytes,
                width: image.width,
                height: image.height,
                name: image.name,
              }
              const stored = yield* images.readImage(reference)
              if (stored.data.byteLength !== image.bytes) return yield* new TweetImageInvalid({})
              const file: BacklogFileInput = {
                id: globalThis.crypto.randomUUID(),
                kind: 'image',
                name: image.name,
                mediaType: image.mediaType,
                bytes: stored.data.byteLength,
                width: image.width,
                height: image.height,
                data: Buffer.from(stored.data).toString('base64'),
              }
              return file
            }),
          )
          const separatorLength = item.body === '' ? 0 : 2
          const bodySection = BacklogTweetContext.section({ url, posts: retrieved.posts, room: BacklogItems.maxBodyChars - item.body.length - separatorLength })
          if (bodySection === '') return yield* new TweetDescriptionFull()
          return yield* store.importTweetContext({ id: item.id, url, bodySection, files, actor: input.actor })
        },
        effect =>
          effect.pipe(
            Effect.tap(() => Effect.annotateCurrentSpan('dshx.backlog.tweet_import.outcome', 'succeeded')),
            Effect.tapError(() => Effect.annotateCurrentSpan('dshx.backlog.tweet_import.outcome', 'failed')),
          ),
      )

      const schedule = Effect.fn('backlog tweet import schedule')(function* (id: number) {
        const found = yield* store.get(id)
        if (!found.ok) return
        const url = BacklogTweetContext.urlsForItem(found.value.item)[0]
        if (url === undefined) return
        yield* FiberMap.run(
          running,
          `${String(id)}:${url}`,
          activity
            .track(importContext({ id, url, actor: { kind: 'system' } }))
            .pipe(Effect.catch(error => Effect.logDebug('backlog: tweet import skipped', error))),
          { onlyIfMissing: true, startImmediately: true },
        )
      })

      return TweetImport.of({ import: importContext, schedule })
    }),
  )
}
