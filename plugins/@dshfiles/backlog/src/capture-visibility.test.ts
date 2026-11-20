import { expect, test } from 'vitest'
import { captureVisible } from './capture-visibility.js'

test('the capture box stays on Feed and shows elsewhere only when asked for', () => {
  expect(captureVisible({ view: 'feed', requested: false })).toBe(true)
  for (const view of ['inbox', 'items', 'board', 'projects', 'shipped', 'ready'] as const) {
    expect(captureVisible({ view, requested: false })).toBe(false)
    expect(captureVisible({ view, requested: true })).toBe(true)
  }
})
