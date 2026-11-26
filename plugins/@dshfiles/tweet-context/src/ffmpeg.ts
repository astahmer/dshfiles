import { Context, Duration, Effect, Layer, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { boundedBytes } from './bounded-bytes.js'

/** Decoder budgets shared by every ffmpeg pass in this plugin. */
export const FfmpegLimits = {
  timeout: Duration.seconds(30),
  maxAllocBytes: 128_000_000,
  maxPixels: 16_000_000,
  maxStderrBytes: 64_000,
} as const

/** Why one ffmpeg run produced nothing usable; callers map it to their own user-facing reason. */
export class FfmpegFailed extends Schema.TaggedError<FfmpegFailed>()('FfmpegFailed', {
  reason: Schema.Literals(['missing', 'exit', 'output-limit', 'timeout', 'spawn']),
  /** Bounded diagnostics of a run that exited non-zero, for callers that classify the refusal. */
  stderr: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `ffmpeg run failed (${this.reason}).`
  }
}

interface KeptBytes {
  readonly chunks: ReadonlyArray<Uint8Array>
  readonly bytes: number
}

/** Drain a diagnostic stream completely (so ffmpeg never blocks on a full pipe) and keep only its first `maxBytes`. */
const truncatedText = <E>(stream: Stream.Stream<Uint8Array, E>, maxBytes: number): Effect.Effect<string, E> =>
  Effect.map(
    Stream.runFoldEffect(
      stream,
      (): KeptBytes => ({ chunks: [], bytes: 0 }),
      (kept, chunk) => {
        const room = maxBytes - kept.bytes
        if (room <= 0) return Effect.succeed(kept)
        const part = chunk.byteLength <= room ? chunk : chunk.subarray(0, room)
        return Effect.succeed({ chunks: [...kept.chunks, part], bytes: kept.bytes + part.byteLength })
      },
    ),
    kept => new TextDecoder().decode(Buffer.concat(kept.chunks)),
  )

export interface FfmpegRun {
  readonly args: ReadonlyArray<string>
  readonly maxOutputBytes: number
}

export interface FfmpegResult {
  readonly stdout: Uint8Array
  /** Bounded diagnostics; empty unless the arguments raise the log level. */
  readonly stderr: string
}

/**
 * Input arguments for a local file only: no stdin, one thread, the pixel and allocation budgets, the `file` protocol
 * alone (no network input), and an input seek when the window starts after zero.
 */
export const boundedInputArgs = (input: { readonly inputPath: string; readonly startSeconds: number; readonly logLevel?: 'error' | 'info' }) => [
  '-nostdin',
  '-hide_banner',
  '-loglevel',
  input.logLevel ?? 'error',
  '-threads',
  '1',
  '-max_alloc',
  String(FfmpegLimits.maxAllocBytes),
  '-max_pixels',
  String(FfmpegLimits.maxPixels),
  '-protocol_whitelist',
  'file',
  ...(input.startSeconds > 0 ? ['-ss', String(input.startSeconds)] : []),
  '-i',
  input.inputPath,
]

/** One bounded ffmpeg process: a 30 s deadline, capped stdout and stderr, and a missing binary kept distinct from a failed run. */
export class Ffmpeg extends Context.Service<Ffmpeg, { readonly run: (input: FfmpegRun) => Effect.Effect<FfmpegResult, FfmpegFailed> }>()(
  '@dshfiles/tweet-context/Ffmpeg',
) {
  static readonly layer = Layer.effect(
    Ffmpeg,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      return Ffmpeg.of({
        run: input =>
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(ChildProcess.make('ffmpeg', input.args, { stdin: 'ignore', forceKillAfter: Duration.seconds(1) }))
            const [stdout, stderr, exitCode] = yield* Effect.all(
              [
                boundedBytes({ stream: handle.stdout, maxBytes: input.maxOutputBytes, onOverflow: () => new FfmpegFailed({ reason: 'output-limit' }) }),
                truncatedText(handle.stderr, FfmpegLimits.maxStderrBytes),
                handle.exitCode,
              ],
              { concurrency: 'unbounded' },
            )
            yield* Effect.annotateCurrentSpan({ 'process.exit.code': exitCode })
            if (exitCode !== 0) return yield* new FfmpegFailed({ reason: 'exit', stderr })
            return { stdout, stderr }
          }).pipe(
            Effect.scoped,
            Effect.catchTag('PlatformError', cause => Effect.fail(new FfmpegFailed({ reason: cause.reason._tag === 'NotFound' ? 'missing' : 'spawn', cause }))),
            Effect.timeoutOrElse({ duration: FfmpegLimits.timeout, orElse: () => Effect.fail(new FfmpegFailed({ reason: 'timeout' })) }),
          ),
      })
    }),
  )
}
