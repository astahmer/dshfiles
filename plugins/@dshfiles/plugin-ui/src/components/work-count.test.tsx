// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { workCountParts } from '../lib/work-count.js'
import { WorkCountText } from './work-count.js'

afterEach(cleanup)

const words = {
  calls: (count: number) => `${String(count)} calls`,
  working: (count: number) => `${String(count)} working`,
  failed: (count: number) => `${String(count)} failed`,
  notStarted: (count: number) => `${String(count)} didn't start`,
}

test('the failed clause leads with one ✕ and reads in the failed ink', () => {
  const { container } = render(<WorkCountText parts={workCountParts({ calls: 8, working: 6, failed: 1, notStarted: 1 }, words)} />)
  const root = container.querySelector('[data-slot="work-count"]')
  expect(root?.textContent).toBe("8 calls · 6 working · 1 failed · 1 didn't start")
  const failed = [...container.querySelectorAll('[data-work-count-tone="failed"]')]
  expect(failed.map(part => part.textContent)).toEqual(['1 failed', "1 didn't start"])
  expect(failed.every(part => part.className.includes('dshx:text-destructive'))).toBe(true)
  // One cross, before the first failed clause's text; the plain clauses carry none.
  expect(container.querySelectorAll('[data-status="failed"]')).toHaveLength(1)
  expect(failed[0]?.firstElementChild?.getAttribute('data-status')).toBe('failed')
  expect(failed[1]?.querySelector('[data-status]')).toBeNull()
  const plain = container.querySelector('[data-work-count-tone="plain"]')
  expect(plain?.className ?? '').not.toContain('dshx:text-destructive')
  expect(plain?.querySelector('[data-status]')).toBeNull()
})

test('a count with no failure draws no cross, and an empty one draws nothing', () => {
  const { container, rerender } = render(<WorkCountText parts={workCountParts({ working: 3 }, words)} />)
  expect(container.textContent).toBe('3 working')
  expect(container.querySelector('[data-status]')).toBeNull()
  rerender(<WorkCountText parts={[]} />)
  expect(container.innerHTML).toBe('')
})

test('a count that continues a line starts with the separator', () => {
  const { container } = render(<WorkCountText leadingSeparator parts={workCountParts({ working: 6, failed: 2 }, words)} />)
  expect(container.textContent).toBe(' · 6 working · 2 failed')
})
