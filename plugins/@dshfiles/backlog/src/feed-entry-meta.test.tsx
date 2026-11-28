// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FeedEntryAuthor, FeedEntryTime } from './feed-view.js'
import { formatClockTime } from '@dshfiles/plugin-ui/lib/format-clock-time'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

test('a feed row prints its time in the leading gutter, 11 px tabular; the id waits in a tooltip (council round 6, D3)', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const createdAt = new Date(2026, 10, 16, 15, 21).getTime()
  act(() =>
    root?.render(
      <TooltipProvider>
        <FeedEntryTime item={{ id: 3, ref: 'w33f', title: 'Feed item', createdAt }} />
      </TooltipProvider>,
    ),
  )
  const gutter = host.querySelector('[data-feed-entry-gutter]')
  const time = formatClockTime(createdAt)
  // The kit clock, so the feed agrees with every other time on screen (council round 5, D4).
  expect(gutter?.textContent).toBe(time)
  expect(gutter?.querySelector('[data-backlog-mention-handle]')?.textContent).toBe(time)
  expect(gutter?.className).toContain('dshx:text-2xs')
  expect(gutter?.className).toContain('dshx:tabular-nums')
  expect(gutter?.className).toContain('dshx:text-muted-foreground')
})

test("a feed with several authors names each row's author as trailing muted meta (council round 2, D2)", () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<FeedEntryAuthor author="user" />))
  const meta = host.querySelector('[data-feed-entry-meta]')
  expect(meta?.textContent).toBe('You')
  expect(meta?.className).toContain('dshx:text-muted-foreground')
  expect(meta?.className).toContain('dshx:shrink-0')
})

test('a row whose time the row above already shows keeps the time as a hover handle (council round 5, D4)', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const createdAt = new Date(2026, 10, 16, 15, 21).getTime()
  act(() =>
    root?.render(
      <TooltipProvider>
        <FeedEntryTime item={{ id: 3, ref: 'w33f', title: 'Feed item', createdAt }} timeShownAbove />
      </TooltipProvider>,
    ),
  )
  const handle = host.querySelector('[data-feed-entry-time]')
  expect(handle?.querySelector('[data-backlog-mention-handle]')).not.toBeNull()
  expect(handle?.className).toContain('dshx:opacity-0')
  expect(handle?.className).toContain('dshx:group-hover/entry:opacity-100')
  expect(handle?.className).toContain('dshx:focus-within:opacity-100')
})
