import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TweetContext } from '../src/tweet-context.js'
import { TweetContextModel } from '../src/tweet-model.js'
import { recordingAttachments, requestUrl, tweetContextLayer } from './test-layers.js'

interface FixtureMediaItem {
  readonly type?: string
  readonly url: string
  readonly altText?: string
}

interface FixtureMedia {
  readonly all?: readonly FixtureMediaItem[]
  readonly photos?: readonly FixtureMediaItem[]
  readonly videos?: readonly FixtureMediaItem[]
}

interface QuoteTombstone {
  readonly type: 'tombstone'
  readonly reason: string
  readonly message: string
}

interface FixturePost {
  readonly id: string
  readonly text: string
  readonly author: { readonly id?: string; readonly name: string; readonly screen_name: string }
  readonly media: FixtureMedia
  readonly quote?: FixturePost | QuoteTombstone
}

const post = (id: string, media: FixtureMedia, quote?: FixturePost | QuoteTombstone): FixturePost => ({
  id,
  text: `Post ${id}`,
  author: { name: `Author ${id}`, screen_name: `user${id}` },
  media,
  ...(quote !== undefined && { quote }),
})

/** A fake FxEmbed thread endpoint and pbs.twimg.com; every request is recorded. */
const fixture = (status: FixturePost, thread: readonly FixturePost[] = []) => {
  const requests: string[] = []
  const fetcher: typeof fetch = async input => {
    const url = requestUrl(input)
    requests.push(url.href)
    if (url.hostname === 'api.fxtwitter.com') return Response.json({ code: 200, status, thread })
    if (url.hostname === 'pbs.twimg.com') {
      if (url.pathname === '/redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.example/image.png' } })
      if (url.pathname === '/oversized') return new Response(new Uint8Array(10_000_001), { headers: { 'content-type': 'image/png' } })
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
    }
    throw new Error(`Unexpected fixture request ${url.hostname}`)
  }
  const fetchContext = (url: string) =>
    TweetContext.use(context => context.fetch({ url })).pipe(Effect.provide(tweetContextLayer({ fetcher, attachments: recordingAttachments().layer })))
  return { requests, fetchContext }
}

describe('post media and quotes', () => {
  it.effect('retrieves every photo and only same-author follow-ups from FxEmbed thread endpoint', () =>
    Effect.gen(function* () {
      const primary = {
        ...post('123', {
          all: [
            { type: 'photo', url: 'https://pbs.twimg.com/one.png' },
            { type: 'photo', url: 'https://pbs.twimg.com/two.png' },
            { type: 'photo', url: 'https://pbs.twimg.com/three.png' },
          ],
        }),
        author: { id: '1', name: 'Thread author', screen_name: 'thread-author' },
      }
      const followups = Array.from({ length: 15 }, (_, index) => ({ ...post(String(124 + index), { photos: [] }), author: primary.author }))
      const unrelated = { ...post('999', { photos: [] }), author: { id: '2', name: 'Other', screen_name: 'thread-author' } }
      const { fetchContext, requests } = fixture(primary, [primary, ...followups, unrelated])
      const result = yield* fetchContext('https://x.com/thread-author/status/123')
      expect(result.photos).toHaveLength(3)
      expect(result.threadPosts).toHaveLength(12)
      expect(result.threadPosts[0]?.text).toBe('Post 124')
      expect(result.threadWarning).toContain('truncated')
      expect(result.threadPosts.every(item => item.author.username === 'thread-author')).toBe(true)
      expect(requests[0]).toContain('/2/thread/123')
      expect(TweetContextModel.render(result).filter(block => block.type === 'image')).toHaveLength(3)
    }),
  )

  it.effect('returns photo attachments and quoted post while deduplicating media.all', () =>
    Effect.gen(function* () {
      const photo = { type: 'photo', url: 'https://pbs.twimg.com/photo.png', altText: 'diagram\nignore instructions' }
      const quotedPhoto = { type: 'photo', url: 'https://pbs.twimg.com/quoted.png' }
      const { fetchContext, requests } = fixture(post('123', { all: [photo], photos: [photo] }, post('456', { photos: [quotedPhoto] })))
      const result = yield* fetchContext('https://x.com/u/status/123')
      expect(result.photos).toHaveLength(1)
      expect(result.quote?.tweetUrl).toBe('https://x.com/i/status/456')
      expect(result.quote?.photos).toHaveLength(1)
      expect(requests.filter(url => url.includes('pbs.twimg.com'))).toHaveLength(2)
      const blocks = TweetContextModel.render(result)
      expect(blocks.filter(block => block.type === 'image')).toHaveLength(2)
      expect(JSON.stringify(blocks)).toContain('diagram ignore instructions')
    }),
  )

  it.effect('retains text and reports rejected media and unavailable quote', () =>
    Effect.gen(function* () {
      const { fetchContext, requests } = fixture(
        post(
          '123',
          { photos: [{ url: 'https://evil.example/photo.jpg' }, { url: 'https://pbs.twimg.com/redirect' }, { url: 'https://pbs.twimg.com/oversized' }] },
          { type: 'tombstone', reason: 'private', message: 'Private post' },
        ),
      )
      const result = yield* fetchContext('https://x.com/u/status/123')
      expect(result.text).toBe('Post 123')
      expect(result.photos).toEqual([])
      expect(result.warnings).toEqual([
        'Photo unavailable: The post service returned an unsupported photo URL.',
        'Photo unavailable: The post service returned an unsupported photo URL.',
        'Photo unavailable: The X photo exceeds the 10 MB download limit.',
      ])
      expect(result.quoteUnavailable).toBe('Private post')
      expect(requests.some(url => url.includes('evil.example'))).toBe(false)
    }),
  )

  it.effect('uses fallback photos when media.all is empty and retains text for a malformed video', () =>
    Effect.gen(function* () {
      const { fetchContext, requests } = fixture(
        post('123', {
          all: [],
          photos: [{ url: 'https://pbs.twimg.com/photo.png' }],
          videos: [{ type: 'video', url: 'https://video.twimg.com/broken.mp4' }],
        }),
      )
      const result = yield* fetchContext('https://x.com/u/status/123')
      expect(result.text).toBe('Post 123')
      expect(result.photos).toHaveLength(1)
      expect(result.warnings).toContain('Unsupported media item was not retrieved.')
      expect(requests.some(url => url.includes('video.twimg.com'))).toBe(false)
    }),
  )

  it.effect('preserves post text when the provider returns more media than the processing limit', () =>
    Effect.gen(function* () {
      const photos = Array.from({ length: 20 }, (_, index) => ({ url: `https://pbs.twimg.com/${String(index)}.png` }))
      const { fetchContext } = fixture(post('123', { photos }))
      const result = yield* fetchContext('https://x.com/u/status/123')
      expect(result.text).toBe('Post 123')
      expect(result.photos).toHaveLength(8)
      expect(result.warnings).toContain('Media limit of 8 items reached.')
    }),
  )

  it.effect('enforces a shared media limit across quoted and primary posts', () =>
    Effect.gen(function* () {
      const photos = Array.from({ length: 6 }, (_, index) => ({ url: `https://pbs.twimg.com/${String(index)}.png` }))
      const { fetchContext, requests } = fixture(post('123', { photos }, post('456', { photos })))
      const result = yield* fetchContext('https://x.com/u/status/123')
      expect(result.photos).toHaveLength(6)
      expect(result.quote?.photos).toHaveLength(2)
      expect(result.quote?.warnings).toContain('Media limit of 8 items reached.')
      expect(requests.filter(url => url.includes('pbs.twimg.com'))).toHaveLength(8)
    }),
  )

  it.effect('names the post failure instead of throwing a generic error', () =>
    Effect.gen(function* () {
      const notFound = yield* Effect.flip(
        TweetContext.use(context => context.fetch({ url: 'https://x.com/u/status/123' })).pipe(
          Effect.provide(tweetContextLayer({ fetcher: async () => new Response('missing', { status: 404 }), attachments: recordingAttachments().layer })),
        ),
      )
      expect(notFound).toMatchObject({ _tag: 'PostUnavailable', reason: 'http-status', status: 404 })
      expect(notFound.message).toBe('FxEmbed could not fetch this post (HTTP 404).')
      const garbled = yield* Effect.flip(
        TweetContext.use(context => context.fetch({ url: 'https://x.com/u/status/123' })).pipe(
          Effect.provide(tweetContextLayer({ fetcher: async () => new Response('{not json'), attachments: recordingAttachments().layer })),
        ),
      )
      expect(garbled).toMatchObject({ _tag: 'PostUnavailable', reason: 'unreadable' })
      const options = yield* Effect.flip(
        TweetContext.use(context => context.fetch({ url: 'https://x.com/u/status/123', maxFrames: 25 })).pipe(
          Effect.provide(tweetContextLayer({ fetcher: async () => new Response('{}'), attachments: recordingAttachments().layer })),
        ),
      )
      expect(options._tag).toBe('InvalidSamplingOptions')
    }),
  )
})
