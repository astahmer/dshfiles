import { defineHost } from '@dshfiles/dshx/host'
import { tweetContextBacklogApi, TweetContextBacklogLimits, type TweetContextBacklogResult } from './backlog-api.js'
import { createTweetContextTool, TweetContextService } from './tweet-context.js'

type TweetContextResult = Awaited<ReturnType<TweetContextService['fetch']>>
type TweetPost = TweetContextResult['threadPosts'][number]
type TweetMediaPost = Pick<TweetPost, 'photos' | 'videos'>

const imageAttachments = (post: TweetMediaPost): { attachment: TweetMediaPost['photos'][number]['attachment']; name: string }[] => [
  ...post.photos.map((photo, index) => ({ attachment: photo.attachment, name: photo.attachment.name ?? `tweet-photo-${String(index + 1)}.jpg` })),
  ...post.videos.flatMap((video, videoIndex) =>
    video.frames.map((frame, frameIndex) => ({
      attachment: frame.attachment,
      name: frame.attachment.name ?? `tweet-video-${String(videoIndex + 1)}-frame-${String(frameIndex + 1)}.jpg`,
    })),
  ),
]

const allPosts = (post: TweetContextResult): (TweetContextResult | TweetPost)[] => [
  post,
  ...(post.quote === undefined ? [] : [post.quote]),
  ...post.threadPosts,
]

const postRecord = (post: TweetContextResult | TweetPost): TweetContextBacklogResult['posts'][number] => {
  const record = { url: post.tweetUrl, author: post.author.name, username: post.author.username, text: post.text }
  if (post.postedAt === undefined) return record
  return { ...record, postedAt: post.postedAt }
}

const tweetContextBacklogApiHost = tweetContextBacklogApi.host({
  retrieve: async ({ ctx, input, signal }) => {
    const service = new TweetContextService({ attachments: ctx.attachments, fetcher: fetch })

    const result = await service.fetch({ url: input.url, signal, maxFrames: 8 })
    const allSourcePosts = allPosts(result)
    const sourcePosts = allSourcePosts.slice(0, TweetContextBacklogLimits.maxPosts)
    const posts = sourcePosts.map(postRecord)
    const warnings = sourcePosts.some(post => post.warnings.length !== 0) ? ['Some media could not be retrieved.'] : []
    if (sourcePosts.length < allSourcePosts.length) warnings.push('Some post context was omitted to fit the import budget.')
    if (result.threadWarning !== undefined) warnings.push('Same-author thread was truncated.')
    if (result.quoteUnavailable !== undefined) warnings.push('Quoted post unavailable.')
    const images: {
      name: string
      attachmentId: string
      mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
      bytes: number
      width: number
      height: number
    }[] = []
    const seen = new Set<string>()
    let totalBytes = 0
    for (const post of sourcePosts) {
      for (const image of imageAttachments(post)) {
        if (images.length >= TweetContextBacklogLimits.maxImages || totalBytes >= TweetContextBacklogLimits.maxImageBytes) break
        if (seen.has(image.attachment.attachmentId)) continue
        seen.add(image.attachment.attachmentId)
        if (image.attachment.bytes + totalBytes > TweetContextBacklogLimits.maxImageBytes) {
          warnings.push('Image byte budget reached; remaining media was not copied to Backlog.')
          break
        }
        totalBytes += image.attachment.bytes
        images.push({
          name: image.name,
          attachmentId: image.attachment.attachmentId,
          mediaType: image.attachment.mediaType,
          bytes: image.attachment.bytes,
          width: image.attachment.width,
          height: image.attachment.height,
        })
      }
      if (images.length >= TweetContextBacklogLimits.maxImages || totalBytes >= TweetContextBacklogLimits.maxImageBytes) break
    }
    return { posts, images, warnings: warnings.slice(0, 64) }
  },
})

export default defineHost({
  name: '@dshfiles/tweet-context',
  inject: ['tools', 'attachments'],
  tools: [ctx => createTweetContextTool(ctx.attachments)],
  apis: [tweetContextBacklogApiHost],
})
