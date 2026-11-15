import { describe, expect, it } from 'vitest'
import { SceneClock, type SteppedAnimation } from '../src/scene-stage.ts'

/** A Web Animation as the clock sees it: it records pauses and every time it is given. */
class FakeAnimation implements SteppedAnimation {
  paused = 0
  writes = 0
  #time: CSSNumberish | null
  constructor(time: CSSNumberish | null) {
    this.#time = time
  }
  get currentTime(): CSSNumberish | null {
    return this.#time
  }
  set currentTime(value: CSSNumberish | null) {
    this.writes += 1
    this.#time = value
  }
  pause(): void {
    this.paused += 1
  }
}

describe('scene clock', () => {
  it('pauses each animation once and moves it to where it would have run freely', () => {
    const origins = new WeakMap()
    // A negative animation-delay starts a CSS animation part-way through: its time is already ahead.
    const fall = new FakeAnimation(12_000)
    const glow = new FakeAnimation(0)
    SceneClock.step([fall, glow], origins, 1_000)
    expect([fall.paused, glow.paused]).toEqual([1, 1])
    expect([fall.currentTime, glow.currentTime]).toEqual([12_000, 0])
    // One step later, both moved forward by the elapsed scene time, and nothing paused them again.
    expect(SceneClock.step([fall, glow], origins, 1_083)).toBe(2)
    expect([fall.currentTime, glow.currentTime]).toEqual([12_083, 83])
    expect([fall.paused, glow.paused]).toEqual([1, 1])
  })

  it('leaves a held scene alone: no write, so the browser repaints nothing', () => {
    const origins = new WeakMap()
    const fall = new FakeAnimation(500)
    SceneClock.step([fall], origins, 0)
    SceneClock.step([fall], origins, 100)
    const writes = fall.writes
    // The tab lost focus: the scene clock stops, the stage still ticks to catch restarted animations.
    expect(SceneClock.step([fall], origins, 100)).toBe(0)
    expect(SceneClock.step([fall], origins, 100)).toBe(0)
    expect(fall.writes).toBe(writes)
    // Focus is back: it resumes from the frame it held, not from the wall clock.
    SceneClock.step([fall], origins, 183)
    expect(fall.currentTime).toBe(683)
  })

  it('catches an animation a style change restarted, from where it stands', () => {
    const origins = new WeakMap()
    SceneClock.step([new FakeAnimation(500)], origins, 0)
    // The scheme or the motion preference changed: the scene's animations are new objects running freely.
    const restarted = new FakeAnimation(40)
    SceneClock.step([restarted], origins, 2_000)
    expect(restarted.paused).toBe(1)
    SceneClock.step([restarted], origins, 2_100)
    expect(restarted.currentTime).toBe(140)
  })

  it('treats an idle animation (no time yet) as starting now', () => {
    const origins = new WeakMap()
    const idle = new FakeAnimation(null)
    SceneClock.step([idle], origins, 50)
    SceneClock.step([idle], origins, 150)
    expect(idle.currentTime).toBe(100)
  })

  it('moves only in the focused, shown tab, at the chosen frame rate', () => {
    expect(SceneClock.moving(12, true, true)).toBe(true)
    // Another window has focus, the tab is in the background, or the user chose a still picture.
    expect(SceneClock.moving(12, true, false)).toBe(false)
    expect(SceneClock.moving(12, false, true)).toBe(false)
    expect(SceneClock.moving(0, true, true)).toBe(false)
    expect(SceneClock.interval(12, true)).toBeCloseTo(83.33, 1)
    expect(SceneClock.interval(30, true)).toBeCloseTo(33.33, 1)
    // Held: only a slow check that the stage is still mounted.
    expect(SceneClock.interval(12, false)).toBe(1000)
    expect(SceneClock.interval(0, true)).toBe(1000)
  })
})
