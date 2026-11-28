import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans, type SpanRecorder } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer } from 'effect'
import { AnimationFrames, type AnimationRequest } from '../src/animation-frames.js'
import { ffmpegFixture, ffmpegLayer, missingFfmpeg, platformLayer, recordingAttachments, scratch } from './test-layers.js'

const sample = (request: AnimationRequest) => AnimationFrames.use(frames => frames.sample(request))
const isJpeg = (data: Uint8Array) => data[0] === 0xff && data[1] === 0xd8
const stopRecording = (recorder: SpanRecorder) => Effect.sync(() => recorder.stop())

/**
 * A 40 px red box overlaid on white: `x` and `y` are ffmpeg expressions of `t` evaluated per frame, so each clip's true
 * timing is known. (`drawbox` evaluates its position once, so it cannot draw motion.)
 */
const boxClip = (input: { readonly file: string; readonly x: string; readonly y?: string; readonly seconds?: number; readonly rate?: number }) =>
  ffmpegFixture([
    '-f',
    'lavfi',
    '-i',
    `color=c=white:s=320x180:r=${String(input.rate ?? 25)}:d=${String(input.seconds ?? 2)}`,
    '-f',
    'lavfi',
    '-i',
    `color=c=red:s=40x40:r=${String(input.rate ?? 25)}:d=${String(input.seconds ?? 2)}`,
    '-filter_complex',
    `[0:v][1:v]overlay=x='${input.x}':y='${input.y ?? '60'}':shortest=1,format=yuv420p`,
    '-c:v',
    'mpeg4',
    '-q:v',
    '2',
    '-y',
    input.file,
  ])

/** Rest at x=0, slide linearly to x=200 between 0.5 s and 1.5 s, rest again. */
const SLIDE = 'if(lt(t,0.5),0,if(lt(t,1.5),(t-0.5)*200,200))'

const animationLayer = (attachments: ReturnType<typeof recordingAttachments>) =>
  AnimationFrames.layer.pipe(Layer.provideMerge(Layer.mergeAll(ffmpegLayer, attachments.layer)))

describe('animation frames from a local file', () => {
  it.effect(
    'times a slide in an MP4 and returns the frames before, during and after it as images',
    () => {
      const attachments = recordingAttachments()
      return Effect.gen(function* () {
        const temp = yield* scratch
        yield* boxClip({ file: temp.file('slide.mp4'), x: SLIDE })
        const output = yield* sample({ path: temp.file('slide.mp4') })

        expect(output.source).toMatchObject({ width: 320, height: 180, frameRate: 25, durationSeconds: 2 })
        expect(output.window).toMatchObject({ startSeconds: 0, endSeconds: 2, scanFps: 25, timingPrecisionSeconds: 0.04 })
        expect(output.timeline.map(entry => entry.kind)).toEqual(['still', 'motion', 'still'])
        expect(output.motions).toHaveLength(1)
        const [motion] = output.motions
        expect(motion?.startSeconds).toBeGreaterThanOrEqual(0.44)
        expect(motion?.startSeconds).toBeLessThanOrEqual(0.52)
        expect(motion?.endSeconds).toBeGreaterThanOrEqual(1.48)
        expect(motion?.endSeconds).toBeLessThanOrEqual(1.56)
        expect(motion?.region.left).toBeLessThan(0.02)
        expect(motion?.region.width).toBeCloseTo(240 / 320, 1)
        expect(motion?.region.top).toBeCloseTo(60 / 180, 1)
        expect(motion?.timing?.nearest).toBe('linear')
        expect(motion?.repeatsEverySeconds).toBeUndefined()

        expect(output.frames.length).toBeGreaterThanOrEqual(3)
        expect(output.frames.length).toBeLessThanOrEqual(12)
        expect(output.frames.map(frame => frame.role)).toEqual(expect.arrayContaining(['before', 'during', 'after']))
        expect(output.frames.map(frame => frame.atSeconds)).toEqual(output.frames.map(frame => frame.atSeconds).toSorted((left, right) => left - right))
        expect(attachments.saved).toHaveLength(output.frames.length)
        expect(attachments.saved.every(isJpeg)).toBe(true)
        expect(output.frames[0]?.attachment.name).toMatch(/^slide-\d+\.\d{3}s\.jpg$/u)
        expect(output.warnings).toEqual([])
      }).pipe(Effect.provide(animationLayer(attachments)))
    },
    60_000,
  )

  it.effect(
    'reads an animated GIF at its own frame rate',
    () =>
      Effect.gen(function* () {
        const temp = yield* scratch
        yield* boxClip({ file: temp.file('slide.mp4'), x: SLIDE })
        yield* ffmpegFixture(['-i', temp.file('slide.mp4'), '-vf', 'fps=12.5,scale=160:-1', '-y', temp.file('slide.gif')])
        const output = yield* sample({ path: temp.file('slide.gif'), maxFrames: 4 })
        expect(output.source).toMatchObject({ width: 160, height: 90, frameRate: 12.5, codec: 'gif' })
        expect(output.window.scanFps).toBe(12.5)
        expect(output.motions).toHaveLength(1)
        expect(output.motions[0]?.startSeconds).toBeCloseTo(0.5, 0)
        expect(output.motions[0]?.endSeconds).toBeCloseTo(1.5, 0)
        expect(Math.abs((output.motions[0]?.durationSeconds ?? 0) - 1)).toBeLessThanOrEqual(0.16)
        expect(output.frames.length).toBeLessThanOrEqual(4)
      }).pipe(Effect.provide(animationLayer(recordingAttachments()))),
    60_000,
  )

  it.effect(
    'separates staggered motions, analyses only the requested window, and finds the period of a loop',
    () =>
      Effect.gen(function* () {
        const temp = yield* scratch
        yield* boxClip({
          file: temp.file('stagger.mp4'),
          x: 'if(lt(t,0.2),0,if(lt(t,0.6),(t-0.2)*300,120))',
          y: 'if(lt(t,1.2),20,if(lt(t,1.6),20+(t-1.2)*200,100))',
        })
        const staggered = yield* sample({ path: temp.file('stagger.mp4') })
        expect(staggered.motions).toHaveLength(2)
        expect(staggered.timeline.map(entry => entry.kind)).toEqual(['still', 'motion', 'still', 'motion', 'still'])
        expect(staggered.motions[1]?.startSeconds).toBeGreaterThan(1.1)
        expect(staggered.frames.filter(frame => frame.role === 'before').map(frame => frame.motion)).toEqual([1, 2])

        const second = yield* sample({ path: temp.file('stagger.mp4'), startSeconds: 1, endSeconds: 2 })
        expect(second.window).toMatchObject({ startSeconds: 1, endSeconds: 2 })
        expect(second.motions).toHaveLength(1)
        expect(second.motions[0]?.startSeconds).toBeGreaterThanOrEqual(1.1)

        yield* boxClip({ file: temp.file('loop.mp4'), x: '140+60*sin(2*PI*t/0.5)', seconds: 3 })
        const loop = yield* sample({ path: temp.file('loop.mp4') })
        expect(loop.motions).toHaveLength(1)
        expect(loop.motions[0]?.repeatsEverySeconds).toBeCloseTo(0.5, 1)
        expect(loop.motions[0]?.timing).toBeUndefined()
      }).pipe(Effect.provide(animationLayer(recordingAttachments()))),
    60_000,
  )

  it.effect(
    'reads a stream that does not report its length up to the frame budget and says where to continue',
    () =>
      Effect.gen(function* () {
        const temp = yield* scratch
        // A raw MPEG-4 elementary stream carries no duration, like a browser MediaRecorder WebM.
        yield* ffmpegFixture([
          '-f',
          'lavfi',
          '-i',
          'color=c=white:s=320x180:r=30:d=20',
          '-f',
          'lavfi',
          '-i',
          'color=c=red:s=40x40:r=30:d=20',
          '-filter_complex',
          "[0:v][1:v]overlay=x='mod(t,4)*50':y=60:shortest=1,format=yuv420p",
          '-c:v',
          'mpeg4',
          '-q:v',
          '2',
          '-f',
          'm4v',
          '-y',
          temp.file('stream.m4v'),
        ])
        const output = yield* sample({ path: temp.file('stream.m4v'), maxFrames: 2 })
        expect(output.source.durationSeconds).toBeUndefined()
        const end = output.window.endSeconds
        expect(end).toBeCloseTo(300 / output.window.scanFps, 1)
        expect(output.warnings).toContain(
          `The clip does not report its length; the analysis stopped at ${String(end)} s (300 scan frames). Call again with startSeconds: ${String(end)} to read on.`,
        )
        const next = yield* sample({ path: temp.file('stream.m4v'), startSeconds: end, maxFrames: 2 })
        expect(next.window.startSeconds).toBe(end)
        expect(next.window.endSeconds).toBeLessThanOrEqual(20.1)
        expect(next.warnings.some(warning => warning.includes('does not report its length'))).toBe(false)
      }).pipe(Effect.provide(animationLayer(recordingAttachments()))),
    60_000,
  )

  it.effect(
    'refuses unusable files and windows with a message that says what to do next',
    () =>
      Effect.gen(function* () {
        const temp = yield* scratch
        const fs = yield* FileSystem.FileSystem
        const failure = (request: AnimationRequest) => Effect.flip(sample(request))

        expect(yield* failure({ path: temp.file('absent.gif') })).toMatchObject({ _tag: 'AnimationSourceUnavailable', reason: 'not-found' })
        const folder = yield* failure({ path: temp.directory })
        expect(folder).toMatchObject({ reason: 'not-a-file' })
        expect(folder.message).toContain('not a folder')

        yield* fs.writeFileString(temp.file('huge.mp4'), '')
        yield* fs.truncate(temp.file('huge.mp4'), 100_000_001)
        const huge = yield* failure({ path: temp.file('huge.mp4') })
        expect(huge).toMatchObject({ reason: 'too-large' })
        expect(huge.message).toContain('ffmpeg -ss')

        yield* fs.writeFileString(temp.file('notes.gif'), 'not an animation')
        const text = yield* failure({ path: temp.file('notes.gif') })
        expect(text).toMatchObject({ reason: 'unreadable' })
        expect(text.message).toContain('Export it as MP4')

        yield* ffmpegFixture(['-f', 'lavfi', '-i', 'sine=d=1', '-y', temp.file('tone.wav')])
        expect(yield* failure({ path: temp.file('tone.wav') })).toMatchObject({ reason: 'no-video' })

        yield* boxClip({ file: temp.file('slide.mp4'), x: SLIDE })
        expect(yield* failure({ path: temp.file('slide.mp4'), startSeconds: 5 })).toMatchObject({
          _tag: 'InvalidAnimationWindow',
          reason: 'start-outside-clip',
          durationSeconds: 2,
        })
        expect(yield* failure({ path: temp.file('slide.mp4'), startSeconds: 1, endSeconds: 0.5 })).toMatchObject({ reason: 'start-after-end' })
        const negative = yield* failure({ path: temp.file('slide.mp4'), startSeconds: -1 })
        expect(negative).toMatchObject({ _tag: 'InvalidAnimationWindow', reason: 'negative' })
        expect(negative.message).toContain('use 0 or more')

        // A folder without search permission makes the file impossible to stat (root bypasses permissions, so skip there).
        if (process.getuid?.() !== 0) {
          yield* fs.makeDirectory(temp.file('locked'))
          yield* fs.writeFileString(temp.file('locked/clip.gif'), 'GIF89a')
          yield* fs.chmod(temp.file('locked'), 0o600)
          const locked = yield* failure({ path: temp.file('locked/clip.gif') })
          yield* fs.chmod(temp.file('locked'), 0o700)
          expect(locked).toMatchObject({ reason: 'inaccessible' })
          expect(locked.message).toContain('may read the file')
        }
      }).pipe(Effect.provide(animationLayer(recordingAttachments()))),
    60_000,
  )

  it.effect(
    'reports a missing ffmpeg binary with install steps',
    () => {
      const attachments = recordingAttachments()
      return Effect.gen(function* () {
        const temp = yield* scratch
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(temp.file('clip.gif'), 'GIF89a')
        const error = yield* Effect.flip(sample({ path: temp.file('clip.gif') }))
        expect(error).toMatchObject({ _tag: 'AnimationSamplingFailed', reason: 'ffmpeg-missing' })
        expect(error.message).toContain('brew install ffmpeg')
      }).pipe(Effect.provide(AnimationFrames.layer.pipe(Layer.provideMerge(Layer.mergeAll(missingFfmpeg, platformLayer, attachments.layer)))))
    },
    30_000,
  )

  it.effect(
    'records probe, scan and sample spans with counts and no file paths',
    () =>
      Effect.gen(function* () {
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          stopRecording,
        )
        const temp = yield* scratch
        yield* boxClip({ file: temp.file('slide.mp4'), x: SLIDE })
        const output = yield* sample({ path: temp.file('slide.mp4'), maxFrames: 5 }).pipe(Effect.provide(tracerLayer))
        const root = recorder.span('animation frames sample')
        expect(root.attributes['dshx.tweet-context.frames']).toBe(output.frames.length)
        expect(root.attributes['dshx.tweet-context.motions']).toBe(1)
        for (const name of ['ffmpeg probe', 'ffmpeg scan', 'ffmpeg sample']) {
          const span = recorder.span(name)
          expect(span.attributes['process.executable.name']).toBe('ffmpeg')
          expect(JSON.stringify(span.attributes)).not.toContain(temp.directory)
        }
        expect(JSON.stringify(root.attributes)).not.toContain(temp.directory)
      }).pipe(Effect.provide(animationLayer(recordingAttachments()))),
    60_000,
  )
})
