import { Clock, Context, Duration, Effect, FileSystem, Layer, Option, Path, Result, Schema, Stream } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http'
import { boundedBytes } from './bounded-bytes.js'
import { InvalidSamplingOptions, type InvalidTweetUrl, type MediaError, PhotoUnavailable, PostUnavailable, VideoUnavailable } from './errors.js'
import { FrameSampler } from './frame-sampler.js'
import { ImageAttachments } from './image-attachments.js'
import {
  type FxPost,
  type FxVideo,
  imageMediaTypeSchema,
  type MediaItem,
  type PostOutput,
  quoteTombstoneSchema,
  type SamplingOptions,
  samplingOptionsSchema,
  type TweetContextOutput,
  TweetContextModel,
  TweetLimits,
  type TweetReference,
  tweetResponseSchema,
  type VideoOutput,
  fxPostSchema,
} from './tweet-model.js'

const API_TIMEOUT = Duration.seconds(15)
const MEDIA_TIMEOUT = Duration.seconds(30)
const MEDIA_BUDGET_MILLIS = 100_000
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))
const decodeTweetResponse = Schema.decodeUnknownEffect(tweetResponseSchema)
const decodeSamplingOptions = Schema.decodeUnknownEffect(samplingOptionsSchema, { onExcessProperty: 'error' })
const decodeQuotedPost = Schema.decodeUnknownResult(fxPostSchema)
const decodeTombstone = Schema.decodeUnknownResult(quoteTombstoneSchema)
const decodeImageMediaType = Schema.decodeUnknownResult(imageMediaTypeSchema)
const utf8 = new TextDecoder('utf-8', { fatal: true })

export interface TweetRequest extends SamplingOptions {
  readonly url: string
}

const contentType = (response: HttpClientResponse.HttpClientResponse) => response.headers['content-type']?.split(';')[0]?.trim().toLowerCase()

const isRedirect = (response: HttpClientResponse.HttpClientResponse) => response.status >= 300 && response.status < 400

/** A post output while its media is processed in order; it becomes a `PostOutput` as is. */
interface PostDraft {
  readonly tweetUrl: string
  readonly author: PostOutput['author']
  readonly postedAt?: string
  readonly text: string
  readonly photos: Array<PostOutput['photos'][number]>
  readonly videos: Array<VideoOutput>
  readonly warnings: Array<string>
}

type PhotoItem = Extract<MediaItem, { kind: 'photo' }>['photo']

const framesIn = (output: TweetContextOutput) =>
  [...output.videos, ...(output.quote?.videos ?? []), ...output.threadPosts.flatMap(post => post.videos)].reduce(
    (total, video) => total + video.frames.length,
    0,
  )

/** Public X post context through FxEmbed: text, quote, same-author thread, photos and sampled video stills, within fixed budgets. */
export class TweetContext extends Context.Service<
  TweetContext,
  { readonly fetch: (request: TweetRequest) => Effect.Effect<TweetContextOutput, InvalidSamplingOptions | InvalidTweetUrl | PostUnavailable> }
>()('@dshfiles/tweet-context/TweetContext') {
  static readonly layer = Layer.effect(
    TweetContext,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const sampler = yield* FrameSampler
      const attachments = yield* ImageAttachments
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      /** A media host request: redirects come back to us (never followed by fetch) so every hop is checked against the trusted host. */
      const requestMedia = (url: URL, accept: string) =>
        http.execute(HttpClientRequest.get(url, { headers: { accept } })).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }))

      const fetchPost = Effect.fn('tweet context fetch post')(
        function* (tweet: TweetReference) {
          const response = yield* http
            .execute(HttpClientRequest.get(`https://api.fxtwitter.com/2/thread/${tweet.id}`, { headers: { accept: 'application/json' } }))
            .pipe(
              Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
              Effect.mapError(cause => new PostUnavailable({ reason: 'unreachable', cause })),
            )
          if (response.status < 200 || response.status >= 300) return yield* new PostUnavailable({ reason: 'http-status', status: response.status })
          const body = yield* boundedBytes({
            stream: response.stream,
            maxBytes: TweetLimits.maxApiResponseBytes,
            onOverflow: () => new PostUnavailable({ reason: 'unreadable' }),
          }).pipe(Effect.catchTag('HttpClientError', cause => Effect.fail(new PostUnavailable({ reason: 'unreadable', cause }))))
          const text = Result.try({ try: () => utf8.decode(body), catch: cause => new PostUnavailable({ reason: 'unreadable', cause }) })
          if (Result.isFailure(text)) return yield* text.failure
          const json = yield* decodeJson(text.success).pipe(Effect.mapError(cause => new PostUnavailable({ reason: 'unreadable', cause })))
          const payload = yield* decodeTweetResponse(json).pipe(Effect.mapError(cause => new PostUnavailable({ reason: 'unsupported', cause })))
          if (payload.code !== 200) return yield* new PostUnavailable({ reason: 'unsupported' })
          return { status: payload.status, thread: payload.thread ?? [] }
        },
        Effect.timeoutOrElse({ duration: API_TIMEOUT, orElse: () => Effect.fail(new PostUnavailable({ reason: 'unreachable' })) }),
      )

      const photoResponse = Effect.fnUntraced(function* (rawUrl: string) {
        let url = TweetContextModel.trustedMediaUrl(rawUrl, 'pbs.twimg.com')
        for (let redirects = 0; redirects <= TweetLimits.maxRedirects; redirects += 1) {
          if (url === undefined) return yield* new PhotoUnavailable({ reason: 'unsupported-url' })
          const response = yield* requestMedia(url, 'image/jpeg,image/png,image/webp,image/gif').pipe(
            Effect.mapError(cause => new PhotoUnavailable({ reason: 'unreachable', cause })),
          )
          if (!isRedirect(response)) return response
          const location = response.headers['location']
          if (location === undefined) return yield* new PhotoUnavailable({ reason: 'invalid-redirect' })
          url = TweetContextModel.trustedMediaUrl(new URL(location, url).href, 'pbs.twimg.com')
        }
        return yield* new PhotoUnavailable({ reason: 'too-many-redirects' })
      })

      const downloadPhoto = Effect.fn('tweet context download photo')(
        function* (rawUrl: string) {
          const response = yield* photoResponse(rawUrl)
          if (response.status < 200 || response.status >= 300) return yield* new PhotoUnavailable({ reason: 'http-status', status: response.status })
          const mediaType = decodeImageMediaType(contentType(response))
          if (Result.isFailure(mediaType)) return yield* new PhotoUnavailable({ reason: 'unsupported-type' })
          const data = yield* boundedBytes({
            stream: response.stream,
            maxBytes: TweetLimits.maxPhotoBytes,
            onOverflow: () => new PhotoUnavailable({ reason: 'too-large' }),
          }).pipe(Effect.catchTag('HttpClientError', cause => Effect.fail(new PhotoUnavailable({ reason: 'unreachable', cause }))))
          if (data.byteLength === 0) return yield* new PhotoUnavailable({ reason: 'empty' })
          return { data, mediaType: mediaType.success }
        },
        Effect.timeoutOrElse({ duration: MEDIA_TIMEOUT, orElse: () => Effect.fail(new PhotoUnavailable({ reason: 'unreachable' })) }),
      )

      const videoResponse = Effect.fnUntraced(function* (start: URL) {
        let url: URL | undefined = start
        for (let redirects = 0; redirects <= TweetLimits.maxRedirects; redirects += 1) {
          if (url === undefined) return yield* new VideoUnavailable({ reason: 'unreachable' })
          const response = yield* requestMedia(url, 'video/mp4').pipe(Effect.mapError(cause => new VideoUnavailable({ reason: 'unreachable', cause })))
          if (!isRedirect(response)) return response
          const location = response.headers['location']
          if (location === undefined) return yield* new VideoUnavailable({ reason: 'unreachable' })
          url = TweetContextModel.trustedMediaUrl(new URL(location, url).href, 'video.twimg.com')
        }
        return yield* new VideoUnavailable({ reason: 'unreachable' })
      })

      const downloadVideo = Effect.fn('tweet context download video')(
        function* (input: { readonly url: URL; readonly path: string }) {
          const response = yield* videoResponse(input.url)
          if (response.status < 200 || response.status >= 300) return yield* new VideoUnavailable({ reason: 'http-status', status: response.status })
          if (contentType(response) !== 'video/mp4') return yield* new VideoUnavailable({ reason: 'not-mp4' })
          const declared = Number(response.headers['content-length'] ?? '0')
          if (!Number.isInteger(declared) || declared < 0 || declared > TweetLimits.maxVideoBytes) return yield* new VideoUnavailable({ reason: 'too-large' })
          let received = 0
          const counted = Stream.mapEffect(response.stream, chunk => {
            received += chunk.byteLength
            return received > TweetLimits.maxVideoBytes ? Effect.fail(new VideoUnavailable({ reason: 'too-large' })) : Effect.succeed(chunk)
          })
          yield* Stream.run(counted, fs.sink(input.path, { flag: 'wx' })).pipe(
            Effect.catchTags({
              HttpClientError: cause => Effect.fail(new VideoUnavailable({ reason: 'unreachable', cause })),
              PlatformError: cause => Effect.fail(new VideoUnavailable({ reason: 'unreachable', cause })),
            }),
          )
          if (received === 0) return yield* new VideoUnavailable({ reason: 'empty' })
        },
        Effect.timeoutOrElse({ duration: MEDIA_TIMEOUT, orElse: () => Effect.fail(new VideoUnavailable({ reason: 'unreachable' })) }),
      )

      const sampleVideo = Effect.fn('tweet context sample video')(function* (input: {
        readonly video: FxVideo
        readonly postId: string
        readonly maxFrames: number
        readonly options: SamplingOptions
      }) {
        const format = yield* TweetContextModel.selectVideoFormat(input.video)
        const url = TweetContextModel.trustedMediaUrl(format.url, 'video.twimg.com')
        if (url === undefined) return yield* new VideoUnavailable({ reason: 'unsupported-url' })
        const directory = yield* fs
          .makeTempDirectoryScoped({ prefix: 'dsh-tweet-context-' })
          .pipe(Effect.mapError(cause => new VideoUnavailable({ reason: 'temp-directory', cause })))
        const frameDirectory = path.join(directory, 'frames')
        const videoPath = path.join(directory, 'post.mp4')
        yield* fs.makeDirectory(frameDirectory).pipe(Effect.mapError(cause => new VideoUnavailable({ reason: 'temp-directory', cause })))
        yield* downloadVideo({ url, path: videoPath })
        const sampled = yield* sampler.sample({
          videoPath,
          frameDirectory,
          durationSeconds: input.video.duration,
          maxFrames: input.maxFrames,
          startSeconds: input.options.startSeconds,
          endSeconds: input.options.endSeconds,
        })
        const saved = yield* attachments.save(
          sampled.map((frame, index) => ({
            data: frame.data,
            mediaType: 'image/jpeg',
            name: `tweet-${input.postId}-frame-${String(index + 1).padStart(2, '0')}.jpg`,
          })),
        )
        const video: VideoOutput = {
          durationSeconds: input.video.duration,
          frames: sampled.flatMap((frame, index) => {
            const attachment = saved[index]
            return attachment === undefined ? [] : [{ atSeconds: frame.atSeconds, attachment }]
          }),
        }
        return video
      }, Effect.scoped)

      const savePhoto = Effect.fnUntraced(function* (input: { readonly url: string; readonly name: string }) {
        const image = yield* downloadPhoto(input.url)
        const saved = yield* attachments.save([{ ...image, name: input.name }])
        const attachment = saved[0]
        if (attachment === undefined) return yield* new PhotoUnavailable({ reason: 'empty' })
        return attachment
      })

      const sameAuthorFollowUps = (input: { readonly post: FxPost; readonly thread: ReadonlyArray<FxPost>; readonly tweetId: string }) => {
        const seen = new Set([input.tweetId])
        return input.thread.filter(threadPost => {
          const sameAuthor =
            input.post.author.id !== undefined && threadPost.author.id !== undefined
              ? input.post.author.id === threadPost.author.id
              : input.post.author.screen_name.toLowerCase() === threadPost.author.screen_name.toLowerCase()
          if (threadPost.id === undefined || seen.has(threadPost.id) || !sameAuthor) return false
          seen.add(threadPost.id)
          return true
        })
      }

      const fetchContext = Effect.fnUntraced(function* (request: TweetRequest) {
        const options = yield* decodeSamplingOptions({ maxFrames: request.maxFrames, startSeconds: request.startSeconds, endSeconds: request.endSeconds }).pipe(
          Effect.mapError(cause => new InvalidSamplingOptions({ cause })),
        )
        const tweet = yield* TweetContextModel.parseTweetUrl(request.url)
        const fetched = yield* fetchPost(tweet)
        const post = fetched.status
        const quoted = post.quote === undefined || post.quote === null ? undefined : decodeQuotedPost(post.quote)
        const quotedPost = quoted !== undefined && Result.isSuccess(quoted) && quoted.success.id !== undefined ? quoted.success : undefined
        const followUps = sameAuthorFollowUps({ post, thread: fetched.thread, tweetId: tweet.id })
        const posts = [
          { post, id: tweet.id },
          ...(quotedPost?.id === undefined ? [] : [{ post: quotedPost, id: quotedPost.id }]),
          ...followUps
            .slice(0, TweetLimits.maxThreadPosts)
            .flatMap(threadPost => (threadPost.id === undefined ? [] : [{ post: threadPost, id: threadPost.id }])),
        ]
        const allMedia = posts.map(item => TweetContextModel.postMedia(item.post))
        const videoDemands = allMedia
          .flat()
          .slice(0, TweetLimits.maxMediaItems)
          .flatMap(item =>
            item.kind === 'video'
              ? [
                  Math.min(
                    TweetLimits.maxVideoFrames,
                    Math.max(1, Math.ceil(Math.min(item.video.duration, TweetLimits.maxVideoWindowSeconds) * TweetLimits.videoScanFps)),
                  ),
                ]
              : [],
          )
        const deadline = (yield* Clock.currentTimeMillis) + MEDIA_BUDGET_MILLIS
        let remainingMedia: number = TweetLimits.maxMediaItems
        let remainingFrames = Math.min(TweetLimits.maxVideoFrames, Math.max(0, Math.floor(options.maxFrames ?? TweetLimits.defaultVideoFrames)))

        const photoWork = Effect.fnUntraced(function* (input: { readonly photo: PhotoItem; readonly id: string; readonly output: PostDraft }) {
          const attachment = yield* savePhoto({ url: input.photo.url, name: `tweet-${input.id}-photo-${String(input.output.photos.length + 1)}` })
          input.output.photos.push({
            attachment,
            ...(input.photo.altText !== undefined && { altText: TweetContextModel.limitedText(input.photo.altText) }),
          })
        })

        const videoWork = Effect.fnUntraced(function* (input: { readonly video: FxVideo; readonly id: string; readonly output: PostDraft }) {
          const demand = videoDemands.shift() ?? 1
          const share = Math.floor(remainingFrames / (videoDemands.length + 1))
          const reserved = videoDemands.reduce((total, futureDemand) => total + Math.min(futureDemand, Math.max(1, share)), 0)
          const frameBudget = Math.min(demand, Math.max(1, remainingFrames - reserved))
          if (remainingFrames <= 0) {
            input.output.warnings.push('Video frame budget exhausted.')
            return
          }
          const sampled = yield* sampleVideo({ video: input.video, postId: input.id, maxFrames: frameBudget, options })
          remainingFrames -= sampled.frames.length
          input.output.videos.push(sampled)
        })

        /** One media item within the shared 100 s budget; `None` means the budget ran out while it was running. */
        const processMedia = (input: { readonly media: Exclude<MediaItem, { kind: 'unsupported' }>; readonly id: string; readonly output: PostDraft }) =>
          Effect.gen(function* () {
            const remaining = deadline - (yield* Clock.currentTimeMillis)
            const work: Effect.Effect<void, MediaError> =
              input.media.kind === 'photo'
                ? photoWork({ photo: input.media.photo, id: input.id, output: input.output })
                : videoWork({ video: input.media.video, id: input.id, output: input.output })
            const label = input.media.kind === 'photo' ? 'Photo' : 'Video'
            return yield* work.pipe(
              Effect.catch(error => Effect.sync(() => input.output.warnings.push(`${label} unavailable: ${error.message}`))),
              Effect.timeoutOption(Duration.millis(Math.max(0, remaining))),
            )
          })

        const outputs: PostDraft[] = []
        for (const [postIndex, item] of posts.entries()) {
          const output: PostDraft = {
            tweetUrl: `https://x.com/i/status/${item.id}`,
            author: { name: item.post.author.name || item.post.author.screen_name, username: item.post.author.screen_name },
            text: TweetContextModel.limitedText(item.post.text),
            photos: [],
            videos: [],
            warnings: [],
            ...(item.post.created_at !== undefined && { postedAt: item.post.created_at }),
          }
          // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- media items share one ordered item, frame and time budget.
          for (const media of allMedia[postIndex] ?? []) {
            if (remainingMedia <= 0) {
              output.warnings.push(`Media limit of ${String(TweetLimits.maxMediaItems)} items reached.`)
              break
            }
            if ((yield* Clock.currentTimeMillis) >= deadline) {
              output.warnings.push('Media processing time limit reached.')
              break
            }
            remainingMedia -= 1
            if (media.kind === 'unsupported') {
              output.warnings.push('Unsupported media item was not retrieved.')
              continue
            }
            const finished = yield* processMedia({ media, id: item.id, output })
            if (Option.isNone(finished)) {
              output.warnings.push('Media processing time limit reached.')
              break
            }
          }
          outputs.push(output)
        }
        const primary = outputs[0]
        if (primary === undefined) return yield* new PostUnavailable({ reason: 'empty' })
        const quoteOutput = quotedPost === undefined ? undefined : outputs[1]
        const quoteUnavailable =
          quoted !== undefined && quotedPost === undefined
            ? Result.match(decodeTombstone(post.quote), {
                onSuccess: tombstone => tombstone.message ?? tombstone.reason ?? 'Unavailable',
                onFailure: () => 'Unsupported quoted post',
              })
            : undefined
        const result: TweetContextOutput = {
          ...primary,
          threadPosts: outputs.slice(quotedPost === undefined ? 1 : 2),
          ...(quoteOutput !== undefined && { quote: quoteOutput }),
          ...(quoteUnavailable !== undefined && { quoteUnavailable }),
          ...(followUps.length > TweetLimits.maxThreadPosts && {
            threadWarning: `Thread was truncated to ${String(TweetLimits.maxThreadPosts)} same-author follow-up posts.`,
          }),
        }
        return result
      })

      return TweetContext.of({
        fetch: Effect.fn('tweet context fetch', { kind: 'client', attributes: { 'server.address': 'api.fxtwitter.com' } })(function* (request: TweetRequest) {
          const output = yield* fetchContext(request)
          yield* Effect.annotateCurrentSpan({ 'dshx.tweet-context.frames': framesIn(output) })
          return output
        }),
      })
    }),
  )
}
