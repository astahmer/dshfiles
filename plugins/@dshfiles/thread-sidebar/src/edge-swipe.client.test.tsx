// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEdgeSwipe, type EdgeSwipeSide } from './edge-swipe.js'

afterEach(cleanup)

/** jsdom has no Touch constructor: a touch event carries plain touch points, which is all the hook reads. */
const touch = (target: Element, type: string, x: number, y = 300): void => {
  const event = new Event(type, { bubbles: true })
  const points = type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }]
  Object.defineProperty(event, 'touches', { value: points })
  Object.defineProperty(event, 'changedTouches', { value: [{ identifier: 1, clientX: x, clientY: y }] })
  target.dispatchEvent(event)
}

const swipe = (target: Element, from: number, to: number): void => {
  touch(target, 'touchstart', from)
  touch(target, 'touchmove', from + (to - from) / 2)
  touch(target, 'touchend', to)
}

const Stage = (props: { readonly side: EdgeSwipeSide; readonly onSwipe: () => void }): JSX.Element => {
  useEdgeSwipe({ side: props.side, enabled: true, onSwipe: props.onSwipe })
  return (
    <main>
      <p data-testid="text">Body</p>
      <div data-testid="scroller" style={{ overflowX: 'auto' }}>
        <span data-testid="cell">Wide table</span>
      </div>
    </main>
  )
}

describe('useEdgeSwipe', () => {
  it('opens from the right edge on a leftward swipe across the content', () => {
    const onSwipe = vi.fn()
    const view = render(<Stage side="right" onSwipe={onSwipe} />)
    const start = window.innerWidth - 20
    swipe(view.getByTestId('text'), start, start - 100)
    expect(onSwipe).toHaveBeenCalledTimes(1)
    // Too short, or the wrong way, does nothing.
    swipe(view.getByTestId('text'), start, start - 40)
    swipe(view.getByTestId('text'), 100, 300)
    expect(onSwipe).toHaveBeenCalledTimes(1)
  })

  it('ignores a drag that starts inside a horizontal scroller scrolled to its start', () => {
    const onSwipe = vi.fn()
    const view = render(<Stage side="left" onSwipe={onSwipe} />)
    const scroller = view.getByTestId('scroller')
    // jsdom lays nothing out: give the scroller more content than width, at scrollLeft 0.
    Object.defineProperty(scroller, 'scrollWidth', { value: 800 })
    Object.defineProperty(scroller, 'clientWidth', { value: 390 })
    expect(scroller.scrollLeft).toBe(0)
    swipe(view.getByTestId('cell'), 4, 120)
    expect(onSwipe).not.toHaveBeenCalled()
    swipe(view.getByTestId('text'), 4, 120)
    expect(onSwipe).toHaveBeenCalledTimes(1)
  })

  it('starts nothing while a modal is open, its scrim included', () => {
    const onSwipe = vi.fn()
    const view = render(
      <>
        <Stage side="right" onSwipe={onSwipe} />
        <section role="dialog" aria-modal="true" />
      </>,
    )
    const start = window.innerWidth - 20
    swipe(view.getByTestId('text'), start, start - 100)
    expect(onSwipe).not.toHaveBeenCalled()
  })
})
