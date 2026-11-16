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

  it('ignores a drag toward newer rows', async () => {
    const sentinel = renderSentinel()
    await act(async () => {})
    sentinel.list.dispatchEvent(touch('touchstart', 160))
    sentinel.list.dispatchEvent(touch('touchmove', 100))
    expect(sentinel.calls()).toBe(0)
  })
})
