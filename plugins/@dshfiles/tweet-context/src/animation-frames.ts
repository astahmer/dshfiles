import { Context, Effect, FileSystem, Layer, Path, Schema } from 'effect'
import { AnimationModel, AnimationLimits, type AnimationFramesOutput, type SamplingWindow, type ScanSize, type SourceInfo } from './animation-model.js'
import { AnimationSamplingFailed, AnimationSourceUnavailable, type AttachmentSaveFailed, InvalidAnimationWindow } from './errors.js'
import { boundedInputArgs, Ffmpeg, type FfmpegFailed } from './ffmpeg.js'
import { ImageAttachments } from './image-attachments.js'

const isFrameName = Schema.is(Schema.String.check(Schema.isPattern(/^frame-\d{2}\.jpg$/u)))

export interface AnimationRequest {
  /** Absolute path of the reference file. */
  readonly path: string
  readonly maxFrames?: number | undefined
  readonly startSeconds?: number | undefined
  readonly endSeconds?: number | undefined
}

export type AnimationError = AnimationSourceUnavailable | InvalidAnimationWindow | AnimationSamplingFailed | AttachmentSaveFailed

/** The scan and extraction passes share one timeline: seek, trim to the window, resample to the scan rate. */
const windowFilter = (window: SamplingWindow) =>
  `trim=duration=${String(window.endSeconds - window.startSeconds)},setpts=PTS-STARTPTS,fps=${String(window.scanFps)}:eof_action=pass`

const samplingFailure = (reason: 'probe-failed' | 'scan-failed' | 'decode-failed') => (cause: FfmpegFailed) =>
  new AnimationSamplingFailed({ reason: cause.reason === 'missing' ? 'ffmpeg-missing' : reason, cause })

/**
 * Timing and key frames of a local animation reference (video or GIF): probe the file, scan the window at low
 * resolution, find still and moving stretches, then extract the frames that show each motion's start, course and end.
 */
export class AnimationFrames extends Context.Service<
  AnimationFrames,
  { readonly sample: (request: AnimationRequest) => Effect.Effect<AnimationFramesOutput, AnimationError> }
>()('@dshfiles/tweet-context/AnimationFrames') {
  static readonly layer = Layer.effect(
    AnimationFrames,
    Effect.gen(function* () {
      const ffmpeg = yield* Ffmpeg
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const attachments = yield* ImageAttachments

      const checkFile = Effect.fnUntraced(function* (file: string) {
        const info = yield* fs
          .stat(file)
          .pipe(
            Effect.mapError(
              cause => new AnimationSourceUnavailable({ reason: cause.reason._tag === 'NotFound' ? 'not-found' : 'inaccessible', path: file, cause }),
            ),
          )
        if (info.type !== 'File') return yield* new AnimationSourceUnavailable({ reason: 'not-a-file', path: file })
        if (Number(info.size) > AnimationLimits.maxFileBytes) return yield* new AnimationSourceUnavailable({ reason: 'too-large', path: file })
      })

      const probe = (file: string): Effect.Effect<SourceInfo, AnimationSourceUnavailable | AnimationSamplingFailed> =>
        ffmpeg
          .run({
            args: [...boundedInputArgs({ inputPath: file, startSeconds: 0, logLevel: 'info' }), '-map', '0:v:0', '-frames:v', '0', '-f', 'null', '-'],
            maxOutputBytes: 1_000,
          })
          .pipe(
            Effect.withSpan('ffmpeg probe', { kind: 'client', attributes: { 'process.executable.name': 'ffmpeg' } }),
            Effect.mapError(cause =>
              cause.reason === 'exit'
                ? new AnimationSourceUnavailable({ reason: AnimationModel.lacksVideoStream(cause.stderr ?? '') ? 'no-video' : 'unreadable', path: file, cause })
                : samplingFailure('probe-failed')(cause),
            ),
            Effect.flatMap(result => {
              const source = AnimationModel.parseProbe(result.stderr)
              if (source !== undefined) return Effect.succeed(source)
              const reason = AnimationModel.lacksVideoStream(result.stderr) ? 'no-video' : 'unreadable'
              return Effect.fail(new AnimationSourceUnavailable({ reason, path: file }))
            }),
          )

      const scan = (input: { readonly file: string; readonly window: SamplingWindow; readonly size: ScanSize }) =>
        ffmpeg
          .run({
            args: [
              ...boundedInputArgs({ inputPath: input.file, startSeconds: input.window.startSeconds }),
              '-t',
              String(input.window.endSeconds - input.window.startSeconds),
              '-vf',
              `${windowFilter(input.window)},scale=${String(input.size.width)}:${String(input.size.height)},format=rgb24`,
              '-frames:v',
              String(AnimationLimits.maxScanFrames),
              '-f',
              'rawvideo',
              '-pix_fmt',
              'rgb24',
              'pipe:1',
            ],
            maxOutputBytes: input.size.width * input.size.height * 3 * AnimationLimits.maxScanFrames + 1_000,
          })
          .pipe(
            Effect.withSpan('ffmpeg scan', {
              kind: 'client',
              attributes: { 'process.executable.name': 'ffmpeg', 'dshx.tweet-context.candidate_limit': AnimationLimits.maxScanFrames },
            }),
            Effect.map(result => AnimationModel.splitFrames(result.stdout, input.size)),
            Effect.mapError(samplingFailure('scan-failed')),
          )

      const extract = Effect.fnUntraced(
        function* (input: {
          readonly file: string
          readonly window: SamplingWindow
          readonly frameIndexes: ReadonlyArray<number>
          readonly directory: string
        }) {
          const select = input.frameIndexes.map(index => `eq(n\\,${String(index)})`).join('+')
          const edge = String(AnimationLimits.frameEdge)
          yield* ffmpeg
            .run({
              args: [
                ...boundedInputArgs({ inputPath: input.file, startSeconds: input.window.startSeconds }),
                '-t',
                String(input.window.endSeconds - input.window.startSeconds),
                '-vf',
                `${windowFilter(input.window)},select='${select}',scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease,setsar=1`,
                '-fps_mode',
                'passthrough',
                '-frames:v',
                String(input.frameIndexes.length),
                '-q:v',
                '3',
                '-y',
                path.join(input.directory, 'frame-%02d.jpg'),
              ],
              maxOutputBytes: 1_000_000,
            })
            .pipe(
              Effect.withSpan('ffmpeg sample', {
                kind: 'client',
                attributes: { 'process.executable.name': 'ffmpeg', 'dshx.tweet-context.frames': input.frameIndexes.length },
              }),
              Effect.mapError(samplingFailure('decode-failed')),
            )
          const names = (yield* fs.readDirectory(input.directory)).filter(isFrameName).toSorted()
          return yield* Effect.forEach(names, name => fs.readFile(path.join(input.directory, name)))
        },
        Effect.mapError(cause => (cause instanceof AnimationSamplingFailed ? cause : new AnimationSamplingFailed({ reason: 'frames-unreadable', cause }))),
      )

      return AnimationFrames.of({
        sample: Effect.fn('animation frames sample')(function* (request: AnimationRequest) {
          yield* checkFile(request.path)
          const source = yield* probe(request.path)
          const planned = AnimationModel.samplingWindow({ source, startSeconds: request.startSeconds, endSeconds: request.endSeconds })
          if ('problem' in planned) return yield* new InvalidAnimationWindow({ reason: planned.problem, durationSeconds: source.durationSeconds })
          const size = AnimationModel.scanSize(source)
          const frames = yield* scan({ file: request.path, window: planned.window, size })
          if (frames.length === 0) return yield* new AnimationSamplingFailed({ reason: 'no-frames' })
          const window = AnimationModel.settledWindow({ window: planned.window, source, frameCount: frames.length })
          const analysis = AnimationModel.analyse(frames, size)
          const selection = AnimationModel.selectFrames(analysis, Math.min(AnimationLimits.maxFrames, request.maxFrames ?? AnimationLimits.defaultFrames))
          const directory = yield* fs
            .makeTempDirectoryScoped({ prefix: 'dsh-animation-frames-' })
            .pipe(Effect.mapError(cause => new AnimationSamplingFailed({ reason: 'frames-unreadable', cause })))
          const images =
            selection.frames.length === 0
              ? []
              : yield* extract({ file: request.path, window, frameIndexes: selection.frames.map(frame => frame.index), directory })
          if (images.length !== selection.frames.length) return yield* new AnimationSamplingFailed({ reason: 'decode-failed' })
          const stem =
            path
              .basename(request.path, path.extname(request.path))
              .replace(/[^\w.-]+/gu, '-')
              .slice(0, 48) || 'animation'
          const saved = yield* attachments.save(
            selection.frames.map((frame, index) => ({
              data: images[index] ?? new Uint8Array(),
              mediaType: 'image/jpeg' as const,
              name: `${stem}-${AnimationModel.frameTime(window, frame.index).toFixed(3)}s.jpg`,
            })),
          )
          const { motions, timeline } = AnimationModel.describeMotions({ analysis, window, size })
          const warnings: string[] = []
          if (AnimationModel.scanBudgetReached({ window: planned.window, source, frameCount: frames.length }))
            warnings.push(
              source.durationSeconds === undefined
                ? `The clip does not report its length; the analysis stopped at ${String(window.endSeconds)} s (300 scan frames). Call again with startSeconds: ${String(window.endSeconds)} to read on.`
                : 'The scan reached its 300-frame budget before the end of the window; narrow startSeconds/endSeconds for the rest.',
            )
          if (selection.omittedMotions > 0)
            warnings.push(
              `${String(selection.omittedMotions)} later motion(s) have timings but no frames within maxFrames; raise maxFrames (up to 24) or narrow the window.`,
            )
          if (window.scanFps < 10) warnings.push('A long window lowers the scan rate; narrow it around one animation for finer timings.')
          yield* Effect.annotateCurrentSpan({ 'dshx.tweet-context.frames': saved.length, 'dshx.tweet-context.motions': motions.length })
          return {
            source: { path: request.path, ...source },
            window: { ...window, timingPrecisionSeconds: Math.round(1_000 / window.scanFps) / 1_000 },
            timeline,
            motions,
            frames: selection.frames.flatMap((frame, index) => {
              const attachment = saved[index]
              if (attachment === undefined) return []
              return [
                {
                  atSeconds: AnimationModel.frameTime(window, frame.index),
                  role: frame.role,
                  ...(frame.motion !== undefined && { motion: frame.motion }),
                  attachment,
                },
              ]
            }),
            warnings,
          } satisfies AnimationFramesOutput
        }, Effect.scoped),
      })
    }),
  ).pipe(Layer.provide(Ffmpeg.layer))
}
