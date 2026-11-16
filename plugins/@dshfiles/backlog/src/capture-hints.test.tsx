// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { CaptureHints } from './capture-hints.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  Reflect.set(globalThis, 'ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

test('the capture box keeps one standing hint and lists the rest only when asked', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<CaptureHints />))
  expect(host.textContent).toBe('↵ add')
  expect(document.body.textContent).not.toContain('Set the kind')
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Capture shortcuts"]')?.click())
  for (const hint of ['New line', 'Set the kind', 'Add a tag', 'Link an item, a thread or a project', 'Set the project', 'Start from a template', 'Attach a file']) {
    expect(document.body.textContent).toContain(hint)
  }
})
