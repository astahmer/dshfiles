// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Tooltip: ({ children }: { readonly children: ReactNode }) => children }))

const { CodeFold } = await import('../src/code-fold.tsx')

/** The native card's shape as CodeFold reads it: a banner whose last child is the action group, then the `pre`. */
const Card = (props: { readonly code: string; readonly wrap?: boolean; readonly toolbarLabels?: { readonly wrapLabel: string; readonly unwrapLabel: string } }): ReactNode => (
  <div className="md-code-block" data-code-wrap={String(props.wrap === true)}>
    <div data-code-block-banner="">
      <span>ts</span>
      <div>
        <button type="button">Copy</button>
      </div>
    </div>
    <pre>{props.code}</pre>
  </div>
)

const labels = { wrapLabel: 'Wrap lines', unwrapLabel: 'Unwrap lines' }

/** Give the card's `pre` a scroll geometry jsdom does not compute. */
const geometry = (pre: HTMLElement, box: { readonly scrollWidth: number; readonly clientWidth: number; readonly scrollLeft?: number }): void => {
  Object.defineProperty(pre, 'scrollWidth', { configurable: true, value: box.scrollWidth })
  Object.defineProperty(pre, 'clientWidth', { configurable: true, value: box.clientWidth })
  pre.scrollLeft = box.scrollLeft ?? 0
}

/** The card's `pre`, which every rendered card has. */
const preOf = (container: HTMLElement): HTMLElement => {
  const pre = container.querySelector('pre')
  if (pre === null) throw new Error('the card renders no pre')
  return pre
}

afterEach(cleanup)

describe('a code card that overflows (round six C3)', () => {
  it('names the wrap toggle "Wrap" and fades only the trailing edge while the start is in view', () => {
    const { container } = render(<CodeFold block={<Card code="const a = 1" toolbarLabels={labels} />} />)
    const pre = preOf(container)
    const fold = container.querySelector('[data-code-overflow-edges]') ?? container.firstElementChild
    geometry(pre, { scrollWidth: 900, clientWidth: 600 })
    act(() => {
      fireEvent.scroll(pre)
    })
    const wrap = container.querySelector('button[aria-pressed]')
    expect(wrap?.textContent).toBe('Wrap')
    expect(wrap?.getAttribute('aria-label')).toBe('Wrap lines')
    expect(fold?.getAttribute('data-code-overflow-edges')).toBe('end')
  })

  it('fades the leading edge once scrolled, and only that edge at the end', () => {
    const { container } = render(<CodeFold block={<Card code="const a = 1" toolbarLabels={labels} />} />)
    const pre = preOf(container)
    geometry(pre, { scrollWidth: 900, clientWidth: 600, scrollLeft: 100 })
    act(() => {
      fireEvent.scroll(pre)
    })
    expect(container.firstElementChild?.getAttribute('data-code-overflow-edges')).toBe('both')
    geometry(pre, { scrollWidth: 900, clientWidth: 600, scrollLeft: 300 })
    act(() => {
      fireEvent.scroll(pre)
    })
    expect(container.firstElementChild?.getAttribute('data-code-overflow-edges')).toBe('start')
  })

  it('follows the highlighted pre the native card swaps in after it mounts', async () => {
    const { container } = render(<CodeFold block={<Card code="const a = 1" toolbarLabels={labels} />} />)
    const plain = preOf(container)
    geometry(plain, { scrollWidth: 600, clientWidth: 600 })
    const highlighted = document.createElement('pre')
    geometry(highlighted, { scrollWidth: 900, clientWidth: 600 })
    await act(async () => {
      plain.replaceWith(highlighted)
      await Promise.resolve()
    })
    expect(container.firstElementChild?.getAttribute('data-code-overflow-edges')).toBe('end')
    expect(container.querySelector('button[aria-pressed]')?.textContent).toBe('Wrap')
  })

  it('shows the icon alone and fades nothing when every line fits', () => {
    const { container } = render(<CodeFold block={<Card code="return total" toolbarLabels={labels} />} />)
    const pre = preOf(container)
    geometry(pre, { scrollWidth: 600, clientWidth: 600 })
    act(() => {
      fireEvent.scroll(pre)
    })
    expect(container.querySelector('button[aria-pressed]')?.textContent).toBe('')
    expect(container.firstElementChild?.hasAttribute('data-code-overflow-edges')).toBe(false)
  })

  it('fades by the overflow edges, not on every unwrapped card', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/code-fold.module.css'), 'utf8')
    expect(css).not.toMatch(/\.fold :global\(\.md-code-block\[data-code-wrap='false'\]\) pre \{[^}]*mask-image/u)
    expect(css).toMatch(/\.fold\[data-code-overflow-edges='end'\] \{[^}]*--code-overflow-mask: linear-gradient\(to right, black calc\(100% - 16px\), transparent\);/u)
    expect(css).toMatch(/\.fold\[data-code-overflow-edges='start'\] \{[^}]*--code-overflow-mask: linear-gradient\(to left, black calc\(100% - 16px\), transparent\);/u)
    expect(css).toMatch(/\.fold\[data-code-overflow-edges\] :global\(\.md-code-block\[data-code-wrap='false'\]\) pre \{[^}]*mask-image: var\(--code-overflow-mask\);/u)
    // Copy keeps a 44pt target on a touch screen.
    expect(css.slice(css.indexOf('@media (pointer: coarse) {'))).toMatch(/button:not\(\.wrap\)::after \{[^}]*inset: -10px -10px -10px -2px;/u)
    // The label is 12px, beside the 14px icon.
    expect(css).toMatch(/\.wrapLabel \{[^}]*font-size: 12px;/u)
  })
})
