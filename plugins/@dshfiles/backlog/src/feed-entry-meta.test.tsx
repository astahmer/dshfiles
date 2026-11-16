// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { FeedEntryMeta } from './feed-view.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

test('a feed row names author, time and id in one trailing muted line', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const createdAt = new Date(2026, 10, 16, 15, 21).getTime()
  act(() => root?.render(<FeedEntryMeta item={{ id: 3, ref: 'w33f', title: 'Feed item', createdAt }} author="user" />))
  const meta = host.querySelector('[data-feed-entry-meta]')
  const time = new Date(createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  expect(meta?.textContent).toBe(`You ·${time}·b:w33f`)
  expect(meta?.className).toContain('dshx:text-muted-foreground')
  expect(meta?.className).toContain('dshx:shrink-0')
})
