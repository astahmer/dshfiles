import { AttachmentId, type AttachmentStore, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node/NodeChildProcessSpawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, FileSystem, Layer, Path, PlatformError } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { FrameSampler } from '../src/frame-sampler.js'
import { ImageAttachments } from '../src/image-attachments.js'
import { TweetContext } from '../src/tweet-context.js'

export const platformLayer = Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)

/** The real ffmpeg on PATH through Effect's Node spawner; production uses the DSH subprocess provider behind the same service. */
export const ffmpegLayer = nodeChildProcessSpawnerLayer.pipe(Layer.provideMerge(platformLayer))

export const samplerLayer = FrameSampler.layer.pipe(Layer.provideMerge(ffmpegLayer))

/** An attachment store stand-in that records every saved image and returns sequential references. */
export const recordingAttachments = () => {
  const saved: Uint8Array[] = []
  const store: Pick<AttachmentStore, 'saveImages'> = {
    saveImages: async images =>
      images.map((image, index): ImageAttachmentRef => {
        saved.push(image.data)
        const reference: ImageAttachmentRef = {
          attachmentId: AttachmentId(`fixture-image-${String(saved.length)}-${String(index)}`),
          mediaType: image.mediaType,
          bytes: image.data.byteLength,
          width: 320,
          height: 240,
        }
        if (image.name !== undefined) reference.name = image.name
        return reference
      }),
  }
  return { saved, layer: Layer.succeed(ImageAttachments, ImageAttachments.fromStore(store)) }
}

/**
 * The plugin's TweetContext over fake FxEmbed and X media hosts: `fetcher` answers every HTTP request, everything else
 * (download limits, redirect checks, temp files, ffmpeg) is the real implementation.
 */
export const tweetContextLayer = (input: { readonly fetcher: typeof fetch; readonly attachments: Layer.Layer<ImageAttachments> }) =>
  TweetContext.layer.pipe(
    Layer.provide(Layer.mergeAll(samplerLayer, input.attachments, FetchHttpClient.layer)),
    Layer.provideMerge(Layer.mergeAll(platformLayer, Layer.succeed(FetchHttpClient.Fetch, input.fetcher))),
  )

/** A request URL as the fake fetch receives it. */
export const requestUrl = (input: Parameters<typeof fetch>[0]): URL => new URL(input instanceof Request ? input.url : String(input))

/** Run ffmpeg to build a local fixture (a lavfi source, never a network input). */
export const ffmpegFixture = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const exitCode = yield* spawner.exitCode(ChildProcess.make('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], { stdin: 'ignore' }))
    if (exitCode !== 0) return yield* Effect.die(new Error(`ffmpeg could not create the fixture (exit ${String(exitCode)}).`))
  })

export const solidVideo = (input: { readonly videoPath: string; readonly dimensions?: string; readonly durationSeconds?: number }) =>
  ffmpegFixture([
    '-f',
    'lavfi',
    '-i',
    `color=c=red:s=${input.dimensions ?? '320x240'}:d=${String(input.durationSeconds ?? 2)}`,
    '-c:v',
    'mpeg4',
    '-pix_fmt',
    'yuv420p',
    '-t',
    String(input.durationSeconds ?? 2),
    '-y',
    input.videoPath,
  ])

export const changingVideo = (input: { readonly videoPath: string; readonly durationSeconds: number; readonly rate: number }) =>
  ffmpegFixture([
    '-f',
    'lavfi',
    '-i',
    `color=black:s=32x32:r=${String(input.rate)}:d=${String(input.durationSeconds)}`,
    '-vf',
    "geq=r='min(N*5,250)':g=0:b=0",
    '-c:v',
    'mpeg4',
    '-pix_fmt',
    'yuv420p',
    '-y',
    input.videoPath,
  ])

export const sceneVideo = (videoPath: string) =>
  ffmpegFixture([
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x240:r=10:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x240:r=10:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:s=320x240:r=10:d=2',
    '-filter_complex',
    '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p',
    '-c:v',
    'mpeg4',
    '-y',
    videoPath,
  ])

/** The average RGB colour of one JPEG, read back through ffmpeg as a single raw pixel. */
export const frameColor = (input: { readonly jpeg: string; readonly pixel: string }) =>
  Effect.gen(function* () {
    yield* ffmpegFixture(['-i', input.jpeg, '-vf', 'scale=1:1:flags=area,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', '-y', input.pixel])
    const fs = yield* FileSystem.FileSystem
    const pixel = yield* fs.readFile(input.pixel)
    return { red: pixel[0] ?? 0, green: pixel[1] ?? 0, blue: pixel[2] ?? 0 }
  })

/** A private scratch directory with a `frames` subdirectory, removed with the test scope. */
export const scratch = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'dsh-tweet-context-test-' })
  const frameDirectory = path.join(directory, 'frames')
  yield* fs.makeDirectory(frameDirectory)
  return { directory, frameDirectory, file: (name: string) => path.join(directory, name) }
})

/** A Host whose PATH has no ffmpeg: every spawn fails the way the DSH spawner reports ENOENT. */
export const missingFfmpeg = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() =>
    Effect.fail(PlatformError.systemError({ _tag: 'NotFound', module: 'ChildProcess', method: 'spawn', description: 'ffmpeg not found' })),
  ),
)
