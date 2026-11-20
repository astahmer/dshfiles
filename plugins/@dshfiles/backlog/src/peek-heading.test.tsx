// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { PeekHeading } from './peek-heading.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

test('the item detail is headed by the item title, with its id as a trailing muted chip', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<PeekHeading item={{ id: 7, ref: 'w33f', title: 'Feed item to close', project: null, freshness: 'fresh' }} />))
  const heading = host.querySelector('nav[aria-label="Breadcrumb"]')
  expect(heading?.textContent).toBe('Feed item to closeb:w33f')
  const handle = heading?.querySelector('[data-backlog-mention-handle]')
  expect(handle?.textContent).toBe('b:w33f')
  expect(handle?.className).toContain('dshx:text-muted-foreground')
  expect(heading?.querySelector('[data-peek-title]')?.className).toContain('dshx:text-foreground')
})
