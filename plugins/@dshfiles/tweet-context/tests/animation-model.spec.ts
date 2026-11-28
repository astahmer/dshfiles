import { describe, expect, it } from '@effect/vitest'
import { AnimationModel, type MotionAnalysis, type SamplingWindow, type ScanSize, type SourceInfo } from '../src/animation-model.js'

const size: ScanSize = { width: 64, height: 16 }
const BOX = 6

/** A white frame with a black box whose left edge is at `x` (rounded): the moving element of every synthetic clip. */
const frameWithBox = (x: number): Uint8Array => {
  const pixels = new Uint8Array(size.width * size.height * 3).fill(255)
  const left = Math.round(x)
  for (let y = 5; y < 5 + BOX; y += 1)
    for (let column = left; column < left + BOX; column += 1) pixels.fill(0, (y * size.width + column) * 3, (y * size.width + column + 1) * 3)
  return pixels
}

/** Hold at `from`, move to `to` over `frames` frames along `curve`, then hold again. */
const clip = (input: { readonly hold: number; readonly frames: number; readonly from: number; readonly to: number; readonly curve: (t: number) => number }) => [
  ...Array.from({ length: input.hold }, () => frameWithBox(input.from)),
  ...Array.from({ length: input.frames }, (_, step) => frameWithBox(input.from + (input.to - input.from) * input.curve((step + 1) / input.frames))),
  ...Array.from({ length: input.hold }, () => frameWithBox(input.to)),
]

const linear = (t: number) => t
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const window: SamplingWindow = { startSeconds: 0, endSeconds: 2, scanFps: 20 }

const mp4Probe = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'box.mp4':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 12 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 320x180 [SAR 1:1 DAR 16:9], 6 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
Stream mapping:
  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))
Output #0, null, to 'pipe:':
  Stream #0:0: Video: wrapped_avframe, yuv420p(progressive), 640x360, q=2-31, 200 kb/s, 50 fps, 25 tbn`

describe('animation probe and window', () => {
  it('reads duration, display size, frame rate and codec from the input section only', () => {
    expect(AnimationModel.parseProbe(mp4Probe)).toEqual({ width: 320, height: 180, durationSeconds: 2, frameRate: 25, codec: 'h264' })
    const gif = `Input #0, gif, from 'box.gif':
  Duration: 00:00:01.50, start: 0.000000, bitrate: 8 kb/s
  Stream #0:0: Video: gif, bgra, 160x90 [SAR 64:64 DAR 16:9], 12.50 fps, 12.50 tbr, 100 tbn`
    expect(AnimationModel.parseProbe(gif)).toEqual({ width: 160, height: 90, durationSeconds: 1.5, frameRate: 12.5, codec: 'gif' })
  })

  it('swaps the display size of a quarter-turn phone recording and refuses a file without video', () => {
    const rotated = `${mp4Probe.split('\nStream mapping')[0] ?? ''}\n    Side data:\n      displaymatrix: rotation of -90.00 degrees`
    expect(AnimationModel.parseProbe(rotated)).toMatchObject({ width: 180, height: 320 })
    const audio = `Input #0, wav, from 'tone.wav':\n  Duration: 00:00:01.00, bitrate: 705 kb/s\n  Stream #0:0: Audio: pcm_s16le, 44100 Hz, 1 channels\nStream map '0:v:0' matches no streams.`
    expect(AnimationModel.parseProbe(audio)).toBeUndefined()
    expect(AnimationModel.lacksVideoStream(audio)).toBe(true)
  })

  it('analyses the whole clip by default and scans no faster than the source, 30 FPS or 300 frames', () => {
    const source: SourceInfo = { width: 320, height: 180, durationSeconds: 2, frameRate: 25 }
    expect(AnimationModel.samplingWindow({ source })).toEqual({ window: { startSeconds: 0, endSeconds: 2, scanFps: 25 } })
    expect(AnimationModel.samplingWindow({ source: { ...source, frameRate: 60 } })).toEqual({ window: { startSeconds: 0, endSeconds: 2, scanFps: 30 } })
    expect(AnimationModel.samplingWindow({ source: { ...source, durationSeconds: 45 } })).toEqual({
      window: { startSeconds: 0, endSeconds: 45, scanFps: 6.666 },
    })
    expect(AnimationModel.samplingWindow({ source, startSeconds: 0.5, endSeconds: 9 })).toEqual({ window: { startSeconds: 0.5, endSeconds: 2, scanFps: 25 } })
  })

  it('scans a clip without a known duration at the full rate and ends its window at the last decoded frame', () => {
    const streamed: SourceInfo = { width: 320, height: 180, frameRate: 30 }
    const planned = AnimationModel.samplingWindow({ source: streamed })
    expect(planned).toEqual({ window: { startSeconds: 0, endSeconds: 10, scanFps: 30 } })
    if (!('window' in planned)) throw new Error('Expected a window')
    expect(AnimationModel.settledWindow({ window: planned.window, source: streamed, frameCount: 60 })).toEqual({ startSeconds: 0, endSeconds: 2, scanFps: 30 })
    expect(AnimationModel.scanBudgetReached({ window: planned.window, source: streamed, frameCount: 60 })).toBe(false)
    expect(AnimationModel.scanBudgetReached({ window: planned.window, source: streamed, frameCount: 300 })).toBe(true)
  })

  it('warns about the frame budget only when the scan stopped before the end of the window', () => {
    const source: SourceInfo = { width: 320, height: 180, durationSeconds: 45, frameRate: 25 }
    const planned = AnimationModel.samplingWindow({ source })
    if (!('window' in planned)) throw new Error('Expected a window')
    expect(AnimationModel.scanBudgetReached({ window: planned.window, source, frameCount: 300 })).toBe(false)
    expect(AnimationModel.scanBudgetReached({ window: { startSeconds: 0, endSeconds: 45, scanFps: 30 }, source, frameCount: 300 })).toBe(true)
  })

  it('refuses a negative window, one that starts outside the clip, ends before it starts, or exceeds 60 seconds', () => {
    const source: SourceInfo = { width: 320, height: 180, durationSeconds: 120 }
    expect(AnimationModel.samplingWindow({ source, startSeconds: -1 })).toEqual({ problem: 'negative' })
    expect(AnimationModel.samplingWindow({ source, endSeconds: -0.5 })).toEqual({ problem: 'negative' })
    expect(AnimationModel.samplingWindow({ source, startSeconds: 120 })).toEqual({ problem: 'start-outside-clip' })
    expect(AnimationModel.samplingWindow({ source, startSeconds: 3, endSeconds: 3 })).toEqual({ problem: 'start-after-end' })
    expect(AnimationModel.samplingWindow({ source, startSeconds: 0, endSeconds: 61 })).toEqual({ problem: 'too-long' })
  })

  it('fits the scan inside 128 px with even edges and never upscales', () => {
    expect(AnimationModel.scanSize({ width: 320, height: 180 })).toEqual({ width: 128, height: 72 })
    expect(AnimationModel.scanSize({ width: 1080, height: 1920 })).toEqual({ width: 72, height: 128 })
    expect(AnimationModel.scanSize({ width: 101, height: 51 })).toEqual({ width: 102, height: 52 })
  })
})

describe('animation motion analysis', () => {
  it('reports no motion for a still clip', () => {
    const analysis = AnimationModel.analyse(
      Array.from({ length: 10 }, () => frameWithBox(10)),
      size,
    )
    expect(analysis.motions).toEqual([])
    const described = AnimationModel.describeMotions({ analysis, window, size })
    expect(described.timeline).toEqual([{ kind: 'still', startSeconds: 0, endSeconds: 0.45 }])
  })

  it('times one move from its last still frame to its settled frame and bounds the region it crosses', () => {
    const analysis = AnimationModel.analyse(clip({ hold: 5, frames: 10, from: 4, to: 44, curve: linear }), size)
    expect(analysis.motions).toHaveLength(1)
    expect(analysis.motions[0]).toMatchObject({ firstFrame: 4, lastFrame: 14 })
    const [motion] = AnimationModel.describeMotions({ analysis, window, size }).motions
    expect(motion).toMatchObject({ startSeconds: 0.2, endSeconds: 0.7, durationSeconds: 0.5, beginsAtWindowStart: false, endsAtWindowEnd: false })
    const round3 = (value: number) => Math.round(value * 1_000) / 1_000
    expect(motion?.region).toEqual({ left: round3(4 / 64), top: round3(5 / 16), width: round3((44 + BOX - 4) / 64), height: round3(BOX / 16) })
  })

  it('names linear and ease-in-out progress from the change per frame', () => {
    const steady = AnimationModel.describeMotions({
      analysis: AnimationModel.analyse(clip({ hold: 3, frames: 12, from: 2, to: 38, curve: linear }), size),
      window,
      size,
    })
    expect(steady.motions[0]?.timing?.nearest).toBe('linear')
    const eased = AnimationModel.describeMotions({
      analysis: AnimationModel.analyse(clip({ hold: 3, frames: 16, from: 2, to: 50, curve: easeInOutCubic }), size),
      window,
      size,
    })
    expect(eased.motions[0]?.timing?.nearest).toBe('ease-in-out')
    expect(eased.motions[0]?.timing?.cubicBezier).toEqual([0.42, 0, 0.58, 1])
    const progress = eased.motions[0]?.progress ?? []
    expect(progress[0]?.progress).toBe(0)
    expect(progress.at(-1)?.progress).toBe(1)
    expect(progress.every((point, index) => index === 0 || point.progress >= (progress[index - 1]?.progress ?? 0))).toBe(true)
  })

  it('separates two motions with a pause between them and keeps a one-frame hold inside one motion', () => {
    const first = clip({ hold: 3, frames: 6, from: 2, to: 20, curve: linear })
    const second = Array.from({ length: 8 }, (_, step) => frameWithBox(20 + 3 * Math.min(step + 1, 6)))
    const staggered = AnimationModel.analyse([...first, ...Array.from({ length: 4 }, () => frameWithBox(20)), ...second], size)
    expect(staggered.motions).toHaveLength(2)
    const described = AnimationModel.describeMotions({ analysis: staggered, window, size })
    expect(described.timeline.map(entry => entry.kind)).toEqual(['still', 'motion', 'still', 'motion', 'still'])

    const held = [frameWithBox(2), frameWithBox(6), frameWithBox(10), frameWithBox(10), frameWithBox(14), frameWithBox(18), frameWithBox(18), frameWithBox(18)]
    expect(AnimationModel.analyse(held, size).motions).toHaveLength(1)
  })

  it('finds the repeat period of a loop and does not force a timing function on it', () => {
    const cycle = [0, 4, 8, 12, 16, 12, 8, 4]
    const loop = Array.from({ length: 40 }, (_, step) => frameWithBox(10 + (cycle[step % cycle.length] ?? 0)))
    const analysis = AnimationModel.analyse(loop, size)
    expect(analysis.motions).toHaveLength(1)
    expect(analysis.motions[0]?.periodFrames).toBe(8)
    const [motion] = AnimationModel.describeMotions({ analysis, window, size }).motions
    expect(motion?.repeatsEverySeconds).toBe(0.4)
    expect(motion?.timing).toBeUndefined()
    expect(motion).toMatchObject({ beginsAtWindowStart: true, endsAtWindowEnd: true })
  })

  it('ignores changes below the noise threshold', () => {
    const noisy = Array.from({ length: 8 }, (_, step) => frameWithBox(10).map((value, index) => (index % 7 === step % 7 ? Math.max(0, value - 20) : value)))
    expect(AnimationModel.analyse(noisy, size).motions).toEqual([])
  })
})

describe('animation key frame selection', () => {
  const twoMotions: MotionAnalysis = {
    frameCount: 60,
    motions: [
      { firstFrame: 4, lastFrame: 20, region: { left: 0, top: 0, right: 1, bottom: 1 }, progress: [], periodFrames: undefined },
      { firstFrame: 30, lastFrame: 38, region: { left: 0, top: 0, right: 1, bottom: 1 }, progress: [], periodFrames: undefined },
    ],
  }

  it('keeps the resting frames around every motion and spreads the rest in proportion to motion length', () => {
    const { frames, omittedMotions } = AnimationModel.selectFrames(twoMotions, 12)
    expect(omittedMotions).toBe(0)
    expect(frames.length).toBeLessThanOrEqual(12)
    expect(frames.filter(frame => frame.role === 'before').map(frame => frame.index)).toEqual([4, 30])
    expect(frames.filter(frame => frame.role === 'after').map(frame => frame.index)).toEqual([20, 38])
    const during = (motion: number) => frames.filter(frame => frame.role === 'during' && frame.motion === motion).length
    expect(during(1)).toBeGreaterThan(during(2))
    expect(frames.map(frame => frame.index)).toEqual(frames.map(frame => frame.index).toSorted((left, right) => left - right))
  })

  it('reports motions left without frames when maxFrames is too small, and returns first, middle and last when nothing moves', () => {
    expect(AnimationModel.selectFrames(twoMotions, 3)).toMatchObject({ omittedMotions: 1 })
    expect(AnimationModel.selectFrames(twoMotions, 0)).toEqual({ frames: [], omittedMotions: 2 })
    expect(AnimationModel.selectFrames({ frameCount: 11, motions: [] }, 12).frames).toEqual([
      { index: 0, role: 'still' },
      { index: 5, role: 'still' },
      { index: 10, role: 'still' },
    ])
  })
})
