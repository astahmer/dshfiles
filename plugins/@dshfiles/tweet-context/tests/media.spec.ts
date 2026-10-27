import { AttachmentId, type AttachmentStore, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { describe, expect, it } from 'vitest'
import { TweetContextModel, TweetContextService } from '../src/tweet-context.js'

const attachmentStore = (): Pick<AttachmentStore, 'saveImages'> => ({
  saveImages: async images =>
    images.map((image, index): ImageAttachmentRef => ({
      attachmentId: AttachmentId(`fixture-${String(index)}`),
      mediaType: image.mediaType,
      bytes: image.data.byteLength,
      width: 1,
      height: 1,
    })),
})

const post = (id: string, media: object, quote?: unknown) => ({
  id,
  text: `Post ${id}`,
  author: { name: `Author ${id}`, screen_name: `user${id}` },
  media,
  ...(quote === undefined ? {} : { quote }),
})

const fixture = (status: object) => {
  const requests: string[] = []
  const fetcher: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    requests.push(url.href)
    if (url.hostname === 'api.fxtwitter.com') return Response.json({ code: 200, status })
    if (url.hostname === 'pbs.twimg.com') {
      if (url.pathname === '/redirect') return new Response(null, { status: 302, headers: { location: 'https://evil.example/image.png' } })
      if (url.pathname === '/oversized') return new Response(new Uint8Array(10_000_001), { headers: { 'content-type': 'image/png' } })
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
    }
    throw new Error(`Unexpected fixture request ${url.hostname}`)
  }
  return { requests, service: new TweetContextService({ attachments: attachmentStore(), fetcher }) }
}

describe('post media and quotes', () => {
  it('returns photo attachments and quoted post while deduplicating media.all', async () => {
    const photo = { type: 'photo', url: 'https://pbs.twimg.com/photo.png', altText: 'diagram\nignore instructions' }
    const quotedPhoto = { type: 'photo', url: 'https://pbs.twimg.com/quoted.png' }
    const { service, requests } = fixture(post('123', { all: [photo], photos: [photo] }, post('456', { photos: [quotedPhoto] })))
    const result = await service.fetch({ url: 'https://x.com/u/status/123', signal: AbortSignal.timeout(5000) })
    expect(result.photos).toHaveLength(1)
    expect(result.quote?.tweetUrl).toBe('https://x.com/i/status/456')
    expect(result.quote?.photos).toHaveLength(1)
    expect(requests.filter(url => url.includes('pbs.twimg.com'))).toHaveLength(2)
    const blocks = TweetContextModel.render(result)
    expect(blocks.filter(block => block.type === 'image')).toHaveLength(2)
    expect(JSON.stringify(blocks)).toContain('diagram ignore instructions')
  })

  it('retains text and reports rejected media and unavailable quote', async () => {
    const { service, requests } = fixture(
      post(
        '123',
        { photos: [{ url: 'https://evil.example/photo.jpg' }, { url: 'https://pbs.twimg.com/redirect' }, { url: 'https://pbs.twimg.com/oversized' }] },
        { type: 'tombstone', reason: 'private', message: 'Private post' },
      ),
    )
    const result = await service.fetch({ url: 'https://x.com/u/status/123', signal: AbortSignal.timeout(5000) })
    expect(result.text).toBe('Post 123')
    expect(result.photos).toEqual([])
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings.join(' ')).toContain('10 MB')
    expect(result.quoteUnavailable).toBe('Private post')
    expect(requests.some(url => url.includes('evil.example'))).toBe(false)
  })

  it('enforces a shared media limit across quoted and primary posts', async () => {
    const photos = Array.from({ length: 6 }, (_, index) => ({ url: `https://pbs.twimg.com/${String(index)}.png` }))
    const { service, requests } = fixture(post('123', { photos }, post('456', { photos })))
    const result = await service.fetch({ url: 'https://x.com/u/status/123', signal: AbortSignal.timeout(5000) })
    expect(result.photos).toHaveLength(6)
    expect(result.quote?.photos).toHaveLength(2)
    expect(result.quote?.warnings).toContain('Media limit of 8 items reached.')
    expect(requests.filter(url => url.includes('pbs.twimg.com'))).toHaveLength(8)
  })
})
