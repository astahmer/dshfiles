// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DraftAnnotations } from '../input/draft-annotations.ts'
import { AnnotationsPill } from './AnnotationsPill.tsx'

const container = document.createElement('div')
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

const setText = (field: HTMLTextAreaElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

it('saves an edited comment from an explicit Done button on a phone', () => {
  const annotations = new DraftAnnotations()
  annotations.add({ text: 'quoted passage', source: 'thread' })
  act(() => { root.render(<AnnotationsPill annotations={annotations} t={key => key} />) })
  act(() => { container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.click() })
  act(() => { document.querySelector<HTMLButtonElement>('button[aria-label="annotation.edit"]')?.click() })
  const field = document.querySelector<HTMLTextAreaElement>('textarea')
  expect(field).not.toBeNull()
  if (field === null) return
  act(() => { setText(field, 'looks right') })
  const done = document.querySelector<HTMLButtonElement>('[data-annotation-done]')
  expect(done?.textContent).toBe('annotation.done')
  act(() => { done?.click() })
  expect(annotations.snapshot()[0]?.comment).toBe('looks right')
})
