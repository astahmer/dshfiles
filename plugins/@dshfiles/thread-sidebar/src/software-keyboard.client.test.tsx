// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSoftwareKeyboard } from './phone-shell.js'

/** A visual viewport the test moves: jsdom has none. */
class FakeVisualViewport extends EventTarget {
  height = 851
  offsetTop = 0
  move(input: { readonly height?: number; readonly offsetTop?: number; readonly type: 'resize' | 'scroll' }): void {
    this.height = input.height ?? this.height
    this.offsetTop = input.offsetTop ?? this.offsetTop
    this.dispatchEvent(new Event(input.type))
  }
}

let viewport: FakeVisualViewport
let frames: FrameRequestCallback[] = []
const flushFrame = (): void => {
  for (const callback of frames.splice(0)) callback(0)
}

const Shell = (): JSX.Element => {
  useSoftwareKeyboard()
  return <textarea data-testid="draft" />
}

beforeEach(() => {
  viewport = new FakeVisualViewport()
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 851 })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  frames = []
})

/** Count writes to the document element's style and attributes, which restyle the whole page. */
const watchRoot = () => {
  const observer = new MutationObserver(() => undefined)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-phone-keyboard'] })
  return { writes: () => observer.takeRecords().length }
}

describe('useSoftwareKeyboard', () => {
  it('publishes the keyboard inset while an editable has focus and the visual viewport is short', () => {
    const view = render(<Shell />)
    view.getByTestId('draft').focus()
    viewport.move({ type: 'resize', height: 480 })
    flushFrame()
    expect(document.documentElement.hasAttribute('data-phone-keyboard')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--dsh-keyboard-inset')).toBe('371px')
  })

  it('still follows a real pan of the visual viewport', () => {
    const view = render(<Shell />)
    view.getByTestId('draft').focus()
    viewport.move({ type: 'resize', height: 480 })
    flushFrame()
    viewport.move({ type: 'scroll', offsetTop: 200 })
    flushFrame()
    expect(document.documentElement.style.getPropertyValue('--dsh-visual-offset-top')).toBe('200px')
    expect(document.documentElement.style.getPropertyValue('--dsh-keyboard-inset')).toBe('171px')
  })

  // Android Chrome pans the visual viewport to the focused composer (offsetTop 370.58 at 2.75 dpr). Publishing that
  // rounded offset moved the fixed bars by a pixel, the browser snapped the viewport back to 370, and each `scroll`
  // event rewrote the root style again: a loop that restyled the page every frame and re-pinned the transcript.
  it('ignores sub-pixel visual viewport jitter instead of rewriting the root style', () => {
    const view = render(<Shell />)
    view.getByTestId('draft').focus()
    viewport.move({ type: 'resize', height: 480 })
    flushFrame()
    viewport.move({ type: 'scroll', offsetTop: 370.5758 })
    flushFrame()
    const root = watchRoot()
    for (let step = 0; step < 10; step++) {
      viewport.move({ type: 'scroll', offsetTop: step % 2 === 0 ? 370 : 370.5758 })
      flushFrame()
    }
    expect(root.writes()).toBe(0)
  })
})
