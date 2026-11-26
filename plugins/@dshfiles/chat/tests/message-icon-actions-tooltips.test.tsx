// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageIconActions } from '../src/native/chat/MessageIconActions.tsx'

// The package index pulls icon sets this plugin does not install; the real Tooltip is all this test needs.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => ({
  Tooltip: (await import('@deepseek-ai/dsh-client-ui-primitives/src/Tooltip.tsx')).Tooltip,
  useClipboardCopy: () => ({ copied: false, onCopy: () => undefined }),
}))

// jsdom has no ResizeObserver; the bubble only uses it to re-place itself.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(cleanup)

// SAFETY: the translator only maps a key to its text; an identity function satisfies every key the row asks for.
const t = ((key: string) => key) as Parameters<typeof MessageIconActions>[0]['t']

// b:d5wg: a Workbench pane (`contain: layout paint`) is the containing block of an inline `position: fixed`
// tooltip, which then lands offset by the pane's viewport origin. The row's tooltips render under document.body.
describe('MessageIconActions tooltips', () => {
  it.each(['copy', 'message.more'])('renders the %s tooltip under document.body, outside the pane', name => {
    render(
      <div data-workbench-panel-id="pane">
        <MessageIconActions text="hello" clock="end" onBranch={() => undefined} t={t} />
      </div>,
    )
    fireEvent.focus(screen.getByRole('button', { name }))
    // The bubble stays visibility: hidden until its ResizeObserver places it, which jsdom never does.
    const tooltip = screen.getByRole('tooltip', { hidden: true })
    expect(tooltip.textContent).toBe(name)
    expect(tooltip.parentElement).toBe(document.body)
    expect(tooltip.closest('[data-workbench-panel-id]')).toBeNull()
  })
})

// Council round 15 A2: every overflow trigger draws the kit's one ⋯, 16px at stroke 2 (it drew 14px at 1.5).
describe('MessageIconActions overflow trigger', () => {
  it('draws the kit OverflowGlyph', () => {
    render(<MessageIconActions text="hello" clock="end" onBranch={() => undefined} t={t} />)
    const glyph = screen.getByRole('button', { name: 'message.more' }).querySelector('svg')
    expect(glyph?.getAttribute('data-slot')).toBe('overflow-glyph')
    expect(glyph?.getAttribute('width')).toBe('16')
    expect(glyph?.getAttribute('stroke-width')).toBe('2')
  })
})
