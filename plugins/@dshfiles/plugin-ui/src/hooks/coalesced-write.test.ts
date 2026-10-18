import { describe, expect, it, vi } from 'vitest'
import { createCoalescedWrite } from './coalesced-write.js'

const manual = () => {
  let nextHandle = 0
  const pending = new Map<number, () => void>()
  return {
    schedule: (callback: () => void): number => {
      nextHandle += 1
      pending.set(nextHandle, callback)
      return nextHandle
    },
    cancel: (handle: number): void => {
      pending.delete(handle)
    },
    pending: () => pending.size,
    fire: (): void => {
      const [handle, callback] = [...pending.entries()][0] ?? []
      if (handle === undefined || callback === undefined) throw new Error('nothing scheduled')
      pending.delete(handle)
      callback()
    },
  }
}

const coalescer = () => {
  const timer = manual()
  const write = vi.fn<(value: string) => void>()
  const reads: number[] = []
  const subject = createCoalescedWrite<string>({
    write,
    delayMs: 250,
    schedule: timer.schedule,
    cancel: timer.cancel,
  })
  const set = (value: string): void => {
    subject.set(() => {
      reads.push(reads.length + 1)
      return value
    })
  }
  return { subject, timer, write, reads, set }
}

describe('createCoalescedWrite', () => {
  it('writes once per window with the newest value', () => {
    const { subject, timer, write, reads, set } = coalescer()
    set('first')
    set('second')
    set('third')
    expect(timer.pending()).toBe(1)
    expect(write).not.toHaveBeenCalled()

    timer.fire()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('third')
    // The value was produced once, at the write, not once per recorded change.
    expect(reads).toHaveLength(1)
    subject.flush()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('flushes the pending value immediately and cancels its timer', () => {
    const { subject, timer, write, set } = coalescer()
    set('draft')
    subject.flush()
    expect(write).toHaveBeenCalledWith('draft')
    expect(timer.pending()).toBe(0)
  })

  it('writes nothing when no change is pending', () => {
    const { subject, write } = coalescer()
    subject.flush()
    expect(write).not.toHaveBeenCalled()
  })

  it('cancel drops the pending value', () => {
    const { subject, timer, write, set } = coalescer()
    set('dropped')
    subject.cancel()
    expect(timer.pending()).toBe(0)
    subject.flush()
    expect(write).not.toHaveBeenCalled()
  })

  it('opens a new window for a change that arrives after a write', () => {
    const { timer, write, set } = coalescer()
    set('one')
    timer.fire()
    set('two')
    expect(timer.pending()).toBe(1)
    timer.fire()
    expect(write.mock.calls.map(call => call[0])).toEqual(['one', 'two'])
  })
})
