import { describe, expect, it } from 'vitest'
import { SheetSnap } from './sheet-snap.js'

const tall = { rest: 300, expanded: 700 }
const short = { rest: 300, expanded: 310 }

describe('SheetSnap', () => {
  it('offers an expanded point only when the content has room to grow', () => {
    expect(SheetSnap.points(tall).map(entry => entry.point)).toEqual(['dismissed', 'rest', 'expanded'])
    expect(SheetSnap.points(short).map(entry => entry.point)).toEqual(['dismissed', 'rest'])
    expect(SheetSnap.heightOf(short, 'expanded')).toBe(300)
  })

  it('follows the finger between the snap points and stretches less and less past the top', () => {
    expect(SheetSnap.follow({ layout: tall, startHeight: 300, dy: 120 })).toBe(180)
    expect(SheetSnap.follow({ layout: tall, startHeight: 300, dy: -200 })).toBe(500)
    expect(SheetSnap.follow({ layout: tall, startHeight: 300, dy: 400 })).toBe(0)
    const over = SheetSnap.follow({ layout: short, startHeight: 300, dy: -100 })
    expect(over).toBeGreaterThan(300)
    expect(over).toBeLessThan(300 + 64)
    expect(SheetSnap.follow({ layout: short, startHeight: 300, dy: -10_000 })).toBeLessThan(364)
  })

  it('settles a slow release by position: dismiss below 70% of rest, else the nearer of rest and expanded', () => {
    expect(SheetSnap.settle({ layout: tall, height: 200, velocity: 0 })).toBe('dismissed')
    expect(SheetSnap.settle({ layout: tall, height: 220, velocity: 0 })).toBe('rest')
    expect(SheetSnap.settle({ layout: tall, height: 480, velocity: 0 })).toBe('rest')
    expect(SheetSnap.settle({ layout: tall, height: 520, velocity: 0 })).toBe('expanded')
    expect(SheetSnap.settle({ layout: short, height: 330, velocity: 0 })).toBe('rest')
  })

  it('moves a flick to the next snap point in its direction', () => {
    expect(SheetSnap.settle({ layout: tall, height: 290, velocity: 1 })).toBe('dismissed')
    expect(SheetSnap.settle({ layout: tall, height: 650, velocity: 1 })).toBe('rest')
    expect(SheetSnap.settle({ layout: tall, height: 320, velocity: -1 })).toBe('expanded')
    expect(SheetSnap.settle({ layout: tall, height: 200, velocity: -1 })).toBe('rest')
    expect(SheetSnap.settle({ layout: short, height: 320, velocity: -1 })).toBe('rest')
  })

  it('measures velocity over the last 100 ms only', () => {
    const samples = [
      { y: 0, time: 0 },
      { y: 300, time: 50 },
      { y: 300, time: 400 },
    ].reduce(SheetSnap.remember, [])
    expect(SheetSnap.velocity(samples)).toBe(0)
    expect(
      SheetSnap.velocity([
        { y: 0, time: 0 },
        { y: 50, time: 50 },
      ]),
    ).toBe(1)
    expect(SheetSnap.velocity([])).toBe(0)
  })
})
