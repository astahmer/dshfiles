// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useTextInteraction } from '../src/native/chat/text-interaction.ts'
import type { TextInteractionBinding } from '../src/native/chat/text-interaction.ts'

// The primitives bundle needs browser-only packages; only its phone check is used here.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ isMobileDevice: () => true }))

// jsdom has no layout: every box is the phone viewport, a selection is one line near the top.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  window.matchMedia ??= (query: string) => ({
    matches: query === '(pointer: coarse)',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })
  HTMLElement.prototype.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 390, height: 700 })
  Range.prototype.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 100, width: 200, height: 20 })
  Range.prototype.getClientRects = function getClientRects() {
    const rect = DOMRect.fromRect({ x: 10, y: 100, width: 200, height: 20 })
    return Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) })
  }
})
afterEach(cleanup)

const ids = ['quote']
const dispatch = (): string => 'quote'

const Harness = ({ onActive }: { readonly onActive: (active: TextInteractionBinding['active']) => void }) => {
  const root = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const interaction = useTextInteraction(root, surface, dispatch, ids)
  onActive(interaction.active)
  return (
    <div ref={root}>
      <p data-text-interaction-source="">Four helpers are now running: phone speed, the JJ panel and composer images.</p>
      <div ref={surface} data-text-interaction-surface="">
        {interaction.active !== null && <button type="button">Quote text</button>}
      </div>
    </div>
  )
}

const select = (end: number): void => {
  const text = document.querySelector('p')?.firstChild
  if (!(text instanceof Text)) throw new Error('no paragraph text')
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, end)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

describe('useTextInteraction on touch', () => {
  it('keeps the Quote action shown and mounted while selection handles drag', () => {
    const actives: TextInteractionBinding['active'][] = []
    render(<Harness onActive={active => actives.push(active)} />)
    const surface = document.querySelector<HTMLElement>('[data-text-interaction-surface]')
    act(() => {
      document.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true }), { pointerType: 'touch' }))
      select(4)
    })
    expect(surface?.style.visibility).toBe('visible')
    const first = actives.at(-1)
    const hiddenDuringDrag: number[] = []
    act(() => {
      // A handle drag reaches the page only as selectionchange events, with no pointer events.
      for (let end = 8; end <= 60; end += 4) {
        select(end)
        if (surface?.style.visibility !== 'visible') hiddenDuringDrag.push(end)
      }
    })
    expect(hiddenDuringDrag).toEqual([])
    expect(surface?.style.visibility).toBe('visible')
    expect(actives.at(-1)).toBe(first)
    expect(surface?.textContent).toBe('Quote text')
  })
})
