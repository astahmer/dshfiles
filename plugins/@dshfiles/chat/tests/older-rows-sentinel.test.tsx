// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { OlderRowsSentinel } from '../src/native/chat/older-rows-sentinel.js'

/** jsdom has no IntersectionObserver; report every observed target in view, as for rows shorter than the viewport. */
class InViewObserver {
  constructor(private readonly callback: (records: { isIntersecting: boolean }[]) => void) {}
  observe(): void {
    queueMicrotask(() => this.callback([{ isIntersecting: true }]))
  }
  disconnect(): void {}
}

const touch = (type: string, clientY: number): Event => Object.assign(new Event(type), { touches: [{ clientY }] })

const renderSentinel = () => {
  const list = document.createElement('div')
  document.body.append(list)
  let calls = 0
  render(
    <OlderRowsSentinel
      listRef={{ current: list }}
      hidden={0}
      firstSeq={100}
      onVisible={() => {
        calls += 1
      }}
      fillSteps={{ current: 0 }}
    />,
    { container: list },
  )
  return { list, calls: () => calls }
}

beforeAll(() => {
  Object.assign(globalThis, { IntersectionObserver: InViewObserver })
})
afterEach(cleanup)

describe('older rows on a transcript that does not fill the view', () => {
  it('waits at the tail without a gesture once the opening fill steps are spent', async () => {
    const sentinel = renderSentinel()
    await act(async () => {})
    expect(sentinel.calls()).toBe(0)
  })

  it('pages older rows when a finger drags the rows down', async () => {
    const sentinel = renderSentinel()
    await act(async () => {})
    sentinel.list.dispatchEvent(touch('touchstart', 100))
    sentinel.list.dispatchEvent(touch('touchmove', 160))
    expect(sentinel.calls()).toBe(1)
  })

  it('takes the next page once a Host page moves the first row while every row stays mounted', async () => {
    const list = document.createElement('div')
    document.body.append(list)
    let calls = 0
    const listRef = { current: list }
    const onVisible = () => {
      calls += 1
    }
    const sentinel = (firstSeq: number) => (
      <OlderRowsSentinel listRef={listRef} hidden={0} firstSeq={firstSeq} onVisible={onVisible} fillSteps={{ current: 0 }} />
    )
    const view = render(sentinel(100), { container: list })
    await act(async () => {})
    const drag = () => {
      list.dispatchEvent(touch('touchstart', 100))
      list.dispatchEvent(touch('touchmove', 160))
    }
    drag()
    drag()
    expect(calls).toBe(1)
    view.rerender(sentinel(60))
    await act(async () => {})
    drag()
    expect(calls).toBe(2)
  })

  it('ignores a drag toward newer rows', async () => {
    const sentinel = renderSentinel()
    await act(async () => {})
    sentinel.list.dispatchEvent(touch('touchstart', 160))
    sentinel.list.dispatchEvent(touch('touchmove', 100))
    expect(sentinel.calls()).toBe(0)
  })
})

/** Fixes a box's layout, which jsdom does not compute. */
const layOut = (element: HTMLElement, box: { scrollHeight: number; clientHeight: number; scrollTop: number }): void => {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: box.scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: box.clientHeight })
  Object.defineProperty(element, 'scrollTop', { configurable: true, writable: true, value: box.scrollTop })
}

/** The phone layout: the list grows with its rows inside a shared conversation scrollport that scrolls instead. */
const renderInScrollport = (fillSteps: number) => {
  const scrollport = document.createElement('div')
  scrollport.setAttribute('data-conversation-scroll', '')
  const list = document.createElement('div')
  scrollport.append(list)
  document.body.append(scrollport)
  layOut(scrollport, { scrollHeight: 7000, clientHeight: 700, scrollTop: 6300 })
  layOut(list, { scrollHeight: 6900, clientHeight: 6900, scrollTop: 0 })
  let calls = 0
  render(
    <OlderRowsSentinel
      listRef={{ current: list }}
      hidden={0}
      firstSeq={100}
      onVisible={() => {
        calls += 1
      }}
      fillSteps={{ current: fillSteps }}
    />,
    { container: list },
  )
  return { scrollport, calls: () => calls }
}

describe('older rows inside a shared conversation scrollport', () => {
  it('takes no opening fill step when the scrollport is already full', async () => {
    const sentinel = renderInScrollport(3)
    await act(async () => {})
    expect(sentinel.calls()).toBe(0)
  })

  it('pages older rows when the reader scrolls the scrollport up', async () => {
    const sentinel = renderInScrollport(0)
    await act(async () => {})
    sentinel.scrollport.scrollTop = 0
    sentinel.scrollport.dispatchEvent(new Event('scroll'))
    expect(sentinel.calls()).toBe(1)
  })

  it('stays at the tail when a shrinking layout clamps the scrollport to its new floor', async () => {
    const sentinel = renderInScrollport(0)
    await act(async () => {})
    sentinel.scrollport.dispatchEvent(new Event('scroll'))
    layOut(sentinel.scrollport, { scrollHeight: 6962, clientHeight: 700, scrollTop: 6262 })
    sentinel.scrollport.dispatchEvent(new Event('scroll'))
    expect(sentinel.calls()).toBe(0)
  })
})
