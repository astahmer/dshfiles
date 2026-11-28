// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { HeaderLiveSignal } from './header-live-activity.js'

afterEach(cleanup)

it('keeps the clock and the step out of any live region and says only the status word', () => {
  const { container } = render(
    <HeaderLiveSignal turn={{ startedAt: Date.now() - 5_000, step: 'Running pnpm test' }} labels={{ working: 'Working', needsYou: 'Needs you' }} />,
  )
  const live = [...container.querySelectorAll('[role="status"], [aria-live="polite"], [aria-live="assertive"]')]
  expect(live.map(node => node.textContent)).toEqual(['Working'])
  for (const node of live) expect(node.querySelector('[data-live-elapsed]')).toBeNull()
})
