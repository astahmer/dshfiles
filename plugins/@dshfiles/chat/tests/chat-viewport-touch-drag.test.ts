// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatViewport } from '../src/native/chat/use-chat-viewport.ts'

class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** jsdom has no Touch constructor: the viewport reads only `touches` on release. */
const touch = (target: EventTarget, type: 'touchstart' | 'touchend', fingers: number): void => {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'touches', { value: Array.from({ length: fingers }, () => ({ clientX: 0, clientY: 0 })) })
  target.dispatchEvent(event)
}

/** A scrollport holding one older row the viewport can retain as its paging anchor. */
const mount = () => {
  const scroller = document.createElement('div')
  scroller.setAttribute('data-conversation-scroll', '')
  const list = document.createElement('div')
  const column = document.createElement('div')
  const row = document.createElement('div')
  row.dataset.chatPagingAnchor = ''
  row.dataset.chatAnchorKey = 'turn-1'
  row.textContent = 'Transcript answer 1'
  column.append(row)
  list.append(column)
  scroller.append(list)
  document.body.append(scroller)
  const viewport = new ChatViewport()
  viewport.attach(list, column)
  const events = { scroll: vi.fn(), scrollEnd: vi.fn(), resize: vi.fn(), interact: vi.fn(), history: vi.fn(), intent: vi.fn() }
  viewport.connect(events)
  return { viewport, scroller, events }
}

describe('ChatViewport touch drags', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', InertResizeObserver)
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  // Older rows page in mid-drag (the sentinel takes a page on touchmove) and retain a paging anchor. A finger held
  // longer than the wheel's gesture window kept scrolling, but each of its scroll events was put back on the anchor:
  // the transcript stuck under the finger and fought it on a phone.
  it('lets a finger still on the rows scroll past a paging anchor taken during the drag', () => {
    const { viewport, scroller, events } = mount()
    touch(scroller, 'touchstart', 1)
    vi.advanceTimersByTime(1_000)
    viewport.beginPaging()
    expect(viewport.preserving).toBe(true)
    scroller.dispatchEvent(new Event('scroll'))
    expect(events.resize).not.toHaveBeenCalled()
    expect(viewport.preserving).toBe(false)
    expect(events.interact).toHaveBeenCalledTimes(1)
  })

  it('still keeps the anchor for a scroll no reader input caused', () => {
    const { viewport, scroller, events } = mount()
    touch(scroller, 'touchstart', 1)
    touch(document, 'touchend', 0)
    vi.advanceTimersByTime(1_000)
    viewport.beginPaging()
    scroller.dispatchEvent(new Event('scroll'))
    expect(events.resize).toHaveBeenCalledTimes(1)
    expect(viewport.preserving).toBe(true)
  })
})
