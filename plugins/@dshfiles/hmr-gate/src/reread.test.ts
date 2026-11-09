import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPendingReread, type RereadStream } from './reread.js'

interface FakeStream extends RereadStream {
  readonly closed: boolean
  readonly emitMessage: (data: string) => void
  readonly emitError: () => void
}

const fakeStream = (): FakeStream => {
  const messageListeners: ((data: string) => void)[] = []
  const errorListeners: (() => void)[] = []
  let closed = false
  return {
    onMessage: listener => {
      messageListeners.push(listener)
    },
    onError: listener => {
      errorListeners.push(listener)
    },
    close: () => {
      closed = true
    },
    get closed() {
      return closed
    },
    emitMessage: data => {
      for (const listener of messageListeners) listener(data)
    },
    emitError: () => {
      for (const listener of errorListeners) listener()
    },
  }
}

describe('createPendingReread', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('closes the borrowed stream once a frame delivers the list', () => {
    const stream = fakeStream()
    const reread = createPendingReread({ open: () => stream, receive: () => true, timeoutMs: 1_000 })
    reread.reread()
    stream.emitMessage('frame')
    expect(stream.closed).toBe(true)
    reread.dispose()
  })

  it('keeps reading frames that do not carry the list', () => {
    const stream = fakeStream()
    const reread = createPendingReread({ open: () => stream, receive: () => false, timeoutMs: 1_000 })
    reread.reread()
    stream.emitMessage('graph')
    expect(stream.closed).toBe(false)
    reread.dispose()
  })

  it('closes a stream the Host never answers', () => {
    const stream = fakeStream()
    const reread = createPendingReread({ open: () => stream, receive: () => false, timeoutMs: 1_000 })
    reread.reread()
    vi.advanceTimersByTime(1_000)
    expect(stream.closed).toBe(true)
    reread.dispose()
  })

  it('closes on a stream error', () => {
    const stream = fakeStream()
    const reread = createPendingReread({ open: () => stream, receive: () => false, timeoutMs: 1_000 })
    reread.reread()
    stream.emitError()
    expect(stream.closed).toBe(true)
    reread.dispose()
  })

  it('opens one stream for a burst of focus events', () => {
    const streams = [fakeStream(), fakeStream()]
    let opened = 0
    const reread = createPendingReread({ open: () => streams[opened++] ?? fakeStream(), receive: () => false, timeoutMs: 1_000 })
    reread.reread()
    reread.reread()
    expect(opened).toBe(1)
    reread.dispose()
  })

  it('closes the open stream when the page tears the effect down', () => {
    const stream = fakeStream()
    const reread = createPendingReread({ open: () => stream, receive: () => false, timeoutMs: 1_000 })
    reread.reread()
    reread.dispose()
    expect(stream.closed).toBe(true)
  })
})
