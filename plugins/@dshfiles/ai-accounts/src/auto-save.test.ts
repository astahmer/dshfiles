import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutoSaver, type AutoSaveStatus } from './auto-save.js'

const setup = (save: (value: string) => Promise<void>) => {
  const statuses: AutoSaveStatus['kind'][] = []
  const saver = createAutoSaver<string>({ save, equals: (left, right) => left === right, onStatus: status => statuses.push(status.kind), delayMs: () => 500 })
  return { saver, statuses }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('auto-save', () => {
  it('waits for a pause and saves only the latest value', async () => {
    const saved: string[] = []
    const { saver, statuses } = setup(async value => {
      saved.push(value)
    })
    saver.schedule('a')
    await vi.advanceTimersByTimeAsync(300)
    saver.schedule('ab')
    await vi.advanceTimersByTimeAsync(499)
    expect(saved).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(saved).toEqual(['ab'])
    expect(statuses.at(-1)).toBe('saved')
  })

  it('never runs two saves at once, and saves a value typed during a save right after it', async () => {
    const saved: string[] = []
    let finish: (() => void) | undefined
    const { saver } = setup(
      value =>
        new Promise<void>(resolve => {
          saved.push(value)
          finish = resolve
        }),
    )
    saver.schedule('one')
    await vi.advanceTimersByTimeAsync(500)
    saver.schedule('two')
    saver.schedule('three')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(saved).toEqual(['one'])
    finish?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(saved).toEqual(['one', 'three'])
  })

  it('keeps a failed value for retry and reports the error', async () => {
    let attempts = 0
    const { saver, statuses } = setup(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('offline')
    })
    saver.schedule('x')
    await vi.advanceTimersByTimeAsync(500)
    expect(statuses.at(-1)).toBe('error')
    await saver.retry()
    expect(attempts).toBe(2)
    expect(statuses.at(-1)).toBe('saved')
  })

  it('does not re-save a value equal to the last saved one', async () => {
    const save = vi.fn(async () => undefined)
    const { saver } = setup(save)
    saver.markSaved('same')
    saver.schedule('same')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(save).not.toHaveBeenCalled()
  })

  it('flushes pending work immediately and cancel drops it', async () => {
    const saved: string[] = []
    const { saver } = setup(async value => {
      saved.push(value)
    })
    saver.schedule('now')
    await saver.flush()
    expect(saved).toEqual(['now'])
    saver.schedule('dropped')
    saver.cancel()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(saved).toEqual(['now'])
  })
})
