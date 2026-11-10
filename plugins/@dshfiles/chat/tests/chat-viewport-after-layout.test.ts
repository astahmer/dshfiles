// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatViewport } from '../src/native/chat/use-chat-viewport.ts'

const observers: FakeResizeObserver[] = []

class FakeResizeObserver {
  readonly targets = new Set<Element>()
  constructor(private readonly callback: (entries: readonly ResizeObserverEntry[]) => void) {
    observers.push(this)
  }
  observe(target: Element): void {
    this.targets.add(target)
  }
  unobserve(target: Element): void {
    this.targets.delete(target)
  }
  disconnect(): void {
    this.targets.clear()
  }
  /** What the browser does after a layout: deliver every observed target whose size is new. */
  deliver(): void {
    if (this.targets.size === 0) return
    this.callback([])
  }
}

const deliverAfterLayout = (): void => {
  for (const observer of observers) observer.deliver()
}

const mount = (): ChatViewport => {
  const list = document.createElement('div')
  const column = document.createElement('div')
  list.append(column)
  document.body.append(list)
  const viewport = new ChatViewport()
  viewport.attach(list, column)
  return viewport
}

describe('ChatViewport.afterLayout', () => {
  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('runs a commit task after the next layout, not inside the commit', () => {
    const viewport = mount()
    const task = vi.fn()
    viewport.afterLayout(task)
    expect(task).not.toHaveBeenCalled()
    deliverAfterLayout()
    expect(task).toHaveBeenCalledTimes(1)
    deliverAfterLayout()
    vi.advanceTimersToNextFrame()
    vi.advanceTimersToNextFrame()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('runs only the latest task when several commits precede one layout', () => {
    const viewport = mount()
    const first = vi.fn()
    const latest = vi.fn()
    viewport.afterLayout(first)
    viewport.afterLayout(latest)
    deliverAfterLayout()
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it('still runs within two frames when no observation arrives (a hidden view)', () => {
    const viewport = mount()
    const task = vi.fn()
    viewport.afterLayout(task)
    vi.advanceTimersToNextFrame()
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersToNextFrame()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('runs immediately while detached', () => {
    const viewport = new ChatViewport()
    const task = vi.fn()
    viewport.afterLayout(task)
    expect(task).toHaveBeenCalledTimes(1)
  })
})
