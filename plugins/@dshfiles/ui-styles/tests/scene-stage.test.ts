import { describe, expect, it } from 'vitest'
import { Affine } from '../src/scene-canvas/matrix.ts'
import type { Track } from '../src/scene-canvas/model.ts'
import { SceneMath } from '../src/scene-canvas/render.ts'
import { SceneView } from '../src/scene-canvas/view.ts'

const track = (values: number[], options: Partial<Track> = {}): Track => ({
  period: 1000,
  count: values.length,
  stride: 1,
  hold: false,
  loop: true,
  values: Float32Array.from(values),
  ...options,
})

const at = (value: Track, time: number): number => {
  const out = new Float64Array(1)
  SceneMath.sample(value, time, out)
  return out[0] ?? Number.NaN
}

describe('scene canvas', () => {
  it('plays a sampled animation track: loops, holds steps and stops a finite one on its last value', () => {
    const ramp = track([0, 10, 20, 30])
    // Between two samples it blends; past the period it starts over, back to the first sample after the last.
    expect(at(ramp, 125)).toBeCloseTo(5)
    expect(at(ramp, 1125)).toBeCloseTo(5)
    expect(at(ramp, 875)).toBeCloseTo(15)
    // A `steps()` animation holds each sample.
    expect(at(track([0, 10, 20, 30], { hold: true }), 490)).toBe(10)
    // A finite animation keeps its last value.
    expect(at(track([0, 10, 20, 30], { loop: false }), 5000)).toBeCloseTo(30)
    expect(at(ramp, -125)).toBeCloseTo(15)
  })

  it('moves a part by its animated transform about its origin', () => {
    const node = {
      parent: -1,
      origin: [100, 50] as const,
      translate: [0, 0] as const,
      rotate: track([0, 90], { period: 2000, hold: true }),
      scale: [1, 1] as const,
      transform: Affine.translate(0, 0),
      moves: true,
      before: Affine.translate(0, 0),
      after: Affine.translate(0, 0),
      alpha: [],
    }
    // A quarter turn about (100, 50) sends (110, 50) to (100, 60).
    const [x, y] = Affine.apply(SceneMath.localAt(node, 1500), 110, 50)
    expect(x).toBeCloseTo(100)
    expect(y).toBeCloseTo(60)
  })

  it('lays the scene over the viewport as cover did, and moves only in the focused, shown tab', () => {
    // A 1600 × 1000 scene on a 2000 × 1000 viewport: scaled 1.25, centred vertically, the host at (300, 40).
    const view = SceneView.view([0, 0, 1600, 1000], { width: 2000, height: 1000 }, { left: 300, top: 40 }, 2)
    expect(view.map(value => Math.round(value * 100) / 100)).toEqual([2.5, 0, 0, 2.5, -600, -330])
    expect(SceneView.scale([0, 0, 1600, 1000], { width: 2000, height: 1000 }, 2)).toBe(2.5)
    expect(SceneView.moving(60, true, true, false)).toBe(true)
    // Another window has focus, the tab is in the background, reduced motion, or a still picture.
    expect(SceneView.moving(60, true, false, false)).toBe(false)
    expect(SceneView.moving(60, false, true, false)).toBe(false)
    expect(SceneView.moving(60, true, true, true)).toBe(false)
    expect(SceneView.moving(0, true, true, false)).toBe(false)
  })
})
