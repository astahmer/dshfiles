// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ComposerRow } from './composer-row.js'

afterEach(cleanup)

test('draws one leading icon, label, meta and action cluster', () => {
  render(<ComposerRow icon={<svg data-testid="glyph" />} label="2 queued" meta="top runs first" actions={<button type="button">Remove</button>} />)
  expect(screen.getByTestId('glyph').parentElement?.getAttribute('data-slot')).toBe('composer-row-icon')
  expect(screen.getByText('2 queued').getAttribute('data-slot')).toBe('composer-row-label')
  expect(screen.getByText('top runs first').getAttribute('data-slot')).toBe('composer-row-meta')
  expect(screen.getByRole('button', { name: 'Remove' }).parentElement?.getAttribute('data-slot')).toBe('composer-row-actions')
})

test('makes the body a disclosure button and leaves the actions separate', () => {
  const onSelect = vi.fn()
  render(<ComposerRow label="Changes since branching from main" expanded actions={<button type="button">Compare</button>} onSelect={onSelect} />)
  const disclosure = screen.getByRole('button', { name: 'Changes since branching from main' })
  expect(disclosure.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(disclosure)
  expect(onSelect).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Compare' })).toBeDefined()
})

test('plain rows drop the standalone frame', () => {
  const { container } = render(<ComposerRow variant="plain" label="Queued while the job runs" />)
  const row = container.querySelector('[data-slot="composer-row"]')
  expect(row?.getAttribute('data-variant')).toBe('plain')
  expect(container.innerHTML).not.toContain('dshx:border-border')
})
