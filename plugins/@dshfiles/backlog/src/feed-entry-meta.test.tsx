// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
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

test('a feed row names author and time in one trailing muted line; the id waits in a tooltip', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const createdAt = new Date(2026, 10, 16, 15, 21).getTime()
  act(() =>
    root?.render(
      <TooltipProvider>
        <FeedEntryMeta item={{ id: 3, ref: 'w33f', title: 'Feed item', createdAt }} author="user" />
      </TooltipProvider>,
    ),
  )
  const meta = host.querySelector('[data-feed-entry-meta]')
  const time = new Date(createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  expect(meta?.textContent).toBe(`You ·${time}`)
  expect(meta?.querySelector('[data-backlog-mention-handle]')?.textContent).toBe(time)
  expect(meta?.className).toContain('dshx:text-muted-foreground')
  expect(meta?.className).toContain('dshx:shrink-0')
})

test('a feed whose rows share one author names no author on any row (council round 2, D2)', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const createdAt = new Date(2026, 10, 16, 15, 21).getTime()
  act(() =>
    root?.render(
      <TooltipProvider>
        <FeedEntryMeta item={{ id: 3, ref: 'w33f', title: 'Feed item', createdAt }} author="user" showAuthor={false} />
      </TooltipProvider>,
    ),
  )
  const meta = host.querySelector('[data-feed-entry-meta]')
  expect(meta?.textContent).toBe(new Date(createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
})
