// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ComposerSnippets } from '../../../composer-snippets.ts'
import { ReferenceChip } from './ReferenceChip.tsx'

const container = document.createElement('div')
let root: Root
const reference = ComposerSnippets.reference({ kind: 'terminal-excerpt', text: 'first\nsecond', label: 'Terminal 3-4' })

const render = (): void => {
  act(() => {
    root.render(<ReferenceChip label={reference.label} invalid={false} source="composer-snippet" reference={reference.ref} />)
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

it('names the chip after the terminal lines it quotes', () => {
  render()
  expect(container.querySelector('button')?.textContent).toContain('Terminal 3-4')
  expect(container.textContent).not.toContain('first')
})

it('reveals the captured output the draft will send', () => {
  render()
  const button = container.querySelector('button')
  act(() => button?.click())
  expect(button?.getAttribute('aria-expanded')).toBe('true')
  expect(container.textContent).toContain('first\nsecond')
  act(() => button?.click())
  expect(button?.getAttribute('aria-expanded')).toBe('false')
  expect(container.textContent).not.toContain('first')
})

it('collapses on Escape so the editor keeps its keyboard path', () => {
  render()
  const button = container.querySelector('button')
  act(() => button?.click())
  act(() => { button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(button?.getAttribute('aria-expanded')).toBe('false')
})
