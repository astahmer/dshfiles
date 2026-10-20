import { afterEach, expect, it, vi } from 'vitest'
import { HoverPrefetch } from './hover-prefetch.js'

afterEach(() => {
  vi.useRealTimers()
})

const rowIds = new WeakMap<Event, string | null>()

const over = (root: EventTarget, sessionId: string | null): void => {
  const event = new Event('pointerover')
  rowIds.set(event, sessionId)
  root.dispatchEvent(event)
}

it('warms the row the pointer rests on, once a minute, and nothing the pointer only crosses', () => {
  vi.useFakeTimers()
  const root = new EventTarget()
  const warmed: string[] = []
  const dispose = HoverPrefetch.install({ root, rowIdOf: event => rowIds.get(event) ?? null, warm: id => warmed.push(id), now: () => Date.now() })

  over(root, 'session-a')
  vi.advanceTimersByTime(100)
  over(root, 'session-b')
  vi.advanceTimersByTime(100)
  over(root, null)
  vi.advanceTimersByTime(200)
  expect(warmed).toEqual([])

  over(root, 'session-b')
  vi.advanceTimersByTime(200)
  expect(warmed).toEqual(['session-b'])

  over(root, 'session-b')
  vi.advanceTimersByTime(200)
  expect(warmed).toEqual(['session-b'])
  vi.advanceTimersByTime(60_000)
  over(root, 'session-b')
  vi.advanceTimersByTime(200)
  expect(warmed).toEqual(['session-b', 'session-b'])

  dispose()
  over(root, 'session-c')
  vi.advanceTimersByTime(200)
  expect(warmed).toEqual(['session-b', 'session-b'])
})
