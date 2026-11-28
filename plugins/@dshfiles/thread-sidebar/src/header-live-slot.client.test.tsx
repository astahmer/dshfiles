// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HeaderLiveSlot } from './header-live-activity.js'
import { WORKING_STATUS_ORDER } from './working-status-item.js'

afterEach(cleanup)

describe('reserved seats for marks that come and go', () => {
  it('keeps the header live line one fixed width, working or not', () => {
    // The line sized to its text, and the workspace chip beside it moved 157 px as the step grew (F12).
    const { container, rerender } = render(<HeaderLiveSlot>{null}</HeaderLiveSlot>)
    const slot = (): Element | null => container.querySelector('[data-header-live-slot]')
    expect(slot()?.className).toContain('dshx:w-64')
    expect(slot()?.className).not.toContain('max-w-64')
    rerender(
      <HeaderLiveSlot>
        <span>Running pnpm test · 1m 12s</span>
      </HeaderLiveSlot>,
    )
    expect(slot()?.className).toContain('dshx:w-64')
  })

  it('seats "N working" after the accounts chip (order 20), so its arrival moves no steady item', () => {
    expect(WORKING_STATUS_ORDER).toBeGreaterThan(20)
    expect(WORKING_STATUS_ORDER).toBeLessThan(90)
  })
})
