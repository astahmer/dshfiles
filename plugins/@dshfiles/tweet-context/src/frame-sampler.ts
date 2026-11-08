import { Context, Duration, Effect, FileSystem, Layer, Path, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { boundedBytes } from './bounded-bytes.js'
import { FrameSamplingFailed } from './errors.js'
import { TweetContextModel, TweetLimits } from './tweet-model.js'

const FFMPEG_TIMEOUT = Duration.seconds(30)
const FFMPEG_MAX_ALLOC_BYTES = 128_000_000
const FFMPEG_MAX_PIXELS = 16_000_000
const FRAME_EDGE_PIXELS = 960
const SCAN_OUTPUT_LIMIT = TweetLimits.videoScanEdge * TweetLimits.videoScanHeight * 3 * TweetLimits.maxScanCandidates + 1_000
const isFrameName = Schema.is(Schema.String.check(Schema.isPattern(/^frame-\d{2}\.jpg$/u)))

export interface SampledFrame {
  readonly atSeconds: number
  readonly data: Uint8Array
}

export interface SampleRequest {
  readonly videoPath: string
  readonly frameDirectory: string
  readonly durationSeconds: number
  readonly maxFrames?: number | undefined
  readonly startSeconds?: number | undefined
  readonly endSeconds?: number | undefined
}

/** A non-zero start is an input seek, so ffmpeg decodes the window instead of every frame before it. */
const boundedInputArgs = (input: { readonly videoPath: string; readonly startSeconds: number }) => [
  '-nostdin',
  '-hide_banner',
  '-loglevel',
  'error',
  '-threads',
  '1',
  '-max_alloc',
  String(FFMPEG_MAX_ALLOC_BYTES),
  '-max_pixels',
  String(FFMPEG_MAX_PIXELS),
  '-protocol_whitelist',
  'file',
  ...(input.startSeconds > 0 ? ['-ss', String(input.startSeconds)] : []),
  '-i',
  input.videoPath,
]

const windowFilter = (window: { readonly windowSeconds: number; readonly scanFps: number }) =>
  `trim=duration=${String(window.windowSeconds)},setpts=PTS-STARTPTS,fps=${String(window.scanFps)}:eof_action=pass`

/** Content-aware stills from a local MP4: a low-resolution scan, a frame selection, then one bounded extraction pass. */
export class FrameSampler extends Context.Service<
  FrameSampler,
  { readonly sample: (request: SampleRequest) => Effect.Effect<ReadonlyArray<SampledFrame>, FrameSamplingFailed> }
>()('@dshfiles/tweet-context/FrameSampler') {
  static readonly layer = Layer.effect(
    FrameSampler,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      /** One ffmpeg run with a 30 s deadline and a stdout cap; a missing binary and a failed decode stay distinct. */
      const ffmpeg = (input: { readonly args: ReadonlyArray<string>; readonly maxOutputBytes: number; readonly failure: 'scan-failed' | 'decode-failed' }) =>
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(ChildProcess.make('ffmpeg', input.args, { stdin: 'ignore', forceKillAfter: Duration.seconds(1) }))
          const [stdout, exitCode] = yield* Effect.all(
            [
              boundedBytes({ stream: handle.stdout, maxBytes: input.maxOutputBytes, onOverflow: () => new FrameSamplingFailed({ reason: input.failure }) }),
              handle.exitCode,
              Stream.runDrain(handle.stderr),
            ],
            { concurrency: 'unbounded' },
          )
          yield* Effect.annotateCurrentSpan({ 'process.exit.code': exitCode })
          if (exitCode !== 0) return yield* new FrameSamplingFailed({ reason: input.failure })
          return stdout
        }).pipe(
          Effect.scoped,
          Effect.catchTag('PlatformError', cause =>
            Effect.fail(new FrameSamplingFailed({ reason: cause.reason._tag === 'NotFound' ? 'ffmpeg-missing' : input.failure, cause })),
          ),
          Effect.timeoutOrElse({ duration: FFMPEG_TIMEOUT, orElse: () => Effect.fail(new FrameSamplingFailed({ reason: input.failure })) }),
        )

      const scan = (input: { readonly videoPath: string; readonly startSeconds: number; readonly windowSeconds: number; readonly scanFps: number }) =>
        ffmpeg({
          args: [
            ...boundedInputArgs(input),
            '-t',
            String(input.windowSeconds),
            '-vf',
            `${windowFilter(input)},scale=${String(TweetLimits.videoScanEdge)}:${String(TweetLimits.videoScanHeight)}:force_original_aspect_ratio=decrease,pad=${String(TweetLimits.videoScanEdge)}:${String(TweetLimits.videoScanHeight)}:(ow-iw)/2:(oh-ih)/2,format=rgb24`,
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgb24',
            'pipe:1',
          ],
          maxOutputBytes: SCAN_OUTPUT_LIMIT,
          failure: 'scan-failed',
        }).pipe(
          Effect.withSpan('ffmpeg scan', {
            kind: 'client',
            attributes: { 'process.executable.name': 'ffmpeg', 'dshx.tweet-context.candidate_limit': TweetLimits.maxScanCandidates },
          }),
        )

      const extract = (input: {
        readonly videoPath: string
        readonly outputPattern: string
        readonly startSeconds: number
        readonly windowSeconds: number
        readonly scanFps: number
        readonly frameIndexes: ReadonlyArray<number>
      }) => {
        const select = input.frameIndexes.map(index => `eq(n\\,${String(index)})`).join('+')
        return ffmpeg({
          args: [
            ...boundedInputArgs(input),
            '-t',
            String(input.windowSeconds),
            '-vf',
            `${windowFilter(input)},select='${select}',scale=${String(FRAME_EDGE_PIXELS)}:${String(FRAME_EDGE_PIXELS)}:force_original_aspect_ratio=decrease,setsar=1`,
            '-fps_mode',
            'passthrough',
            '-frames:v',
            String(input.frameIndexes.length),
            '-q:v',
            '3',
            '-y',
            input.outputPattern,
          ],
          maxOutputBytes: 1_000_000,
          failure: 'decode-failed',
        }).pipe(
          Effect.withSpan('ffmpeg sample', {
            kind: 'client',
            attributes: { 'process.executable.name': 'ffmpeg', 'dshx.tweet-context.frames': input.frameIndexes.length },
          }),
        )
      }

      const readFrames = Effect.fnUntraced(function* (frameDirectory: string) {
        const names = (yield* fs.readDirectory(frameDirectory)).filter(isFrameName).toSorted()
        return yield* Effect.forEach(names, name => fs.readFile(path.join(frameDirectory, name)))
      })

      return FrameSampler.of({
        sample: Effect.fn('tweet context sample frames')(function* (request: SampleRequest) {
          const maxFrames = Math.min(TweetLimits.maxVideoFrames, Math.max(0, Math.floor(request.maxFrames ?? TweetLimits.defaultVideoFrames)))
          if (maxFrames === 0) return []
          const startSeconds = request.startSeconds ?? 0
          const endSeconds = Math.min(
            request.endSeconds ?? Math.min(request.durationSeconds, startSeconds + TweetLimits.maxVideoWindowSeconds),
            request.durationSeconds,
          )
          if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || startSeconds >= endSeconds)
            return yield* new FrameSamplingFailed({ reason: 'invalid-window' })
          const windowSeconds = endSeconds - startSeconds
          const scanFps = Math.min(TweetLimits.videoScanFps, TweetLimits.maxScanCandidates / windowSeconds)
          const lowResolution = TweetContextModel.scanFrames(yield* scan({ videoPath: request.videoPath, startSeconds, windowSeconds, scanFps }))
          const selected = TweetContextModel.selectInformativeFrames(lowResolution, maxFrames)
          if (selected.length === 0) return yield* new FrameSamplingFailed({ reason: 'no-frames' })
          yield* extract({
            videoPath: request.videoPath,
            outputPattern: path.join(request.frameDirectory, 'frame-%02d.jpg'),
            startSeconds,
            windowSeconds,
            scanFps,
            frameIndexes: selected.map(frame => frame.index),
          })
          const frames = yield* readFrames(request.frameDirectory).pipe(
            Effect.mapError(cause => new FrameSamplingFailed({ reason: 'frames-unreadable', cause })),
          )
          if (frames.length === 0) return yield* new FrameSamplingFailed({ reason: 'no-selected-frames' })
          yield* Effect.annotateCurrentSpan({ 'dshx.tweet-context.frames': frames.length })
          return frames.map((data, index) => ({
            atSeconds: Math.round((startSeconds + (selected[index]?.index ?? 0) / scanFps) * 1_000) / 1_000,
            data,
          }))
        }),
      })
    }),
  )
}
