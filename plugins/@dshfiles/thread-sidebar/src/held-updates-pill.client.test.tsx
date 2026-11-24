// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeldUpdatesPill } from './held-updates-pill.js'

afterEach(cleanup)

const label = (count: number): string => `${count} update(s)`
const pill = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>('[data-held-updates]')
  if (element === null) throw new Error('no held-updates pill')
  return element
}

describe('HeldUpdatesPill', () => {
  it('floats over the list in a zero-height seat, so it never moves the rows it holds', () => {
    // The pill sat in flow (sticky, 32 px) and pushed the first row down by its height.
    render(<HeldUpdatesPill count={2} label={label} hint="Show the new order." onShow={vi.fn()} />)
    const seat = pill().parentElement
    expect(seat?.className).toContain('dshx:h-0')
    expect(pill().className).toContain('dshx:absolute')
    expect(pill().getAttribute('data-state')).toBe('open')
  })

  it('fades out with its last count, hidden from the keyboard and the pointer', () => {
    const onShow = vi.fn()
    const { rerender } = render(<HeldUpdatesPill count={3} label={label} hint="Show the new order." onShow={onShow} />)
    fireEvent.click(pill())
    expect(onShow).toHaveBeenCalledOnce()
    rerender(<HeldUpdatesPill count={0} label={label} hint="Show the new order." onShow={onShow} />)
    expect(pill().getAttribute('data-state')).toBe('closed')
    expect(pill().textContent).toBe('3 update(s)')
    expect(pill().getAttribute('aria-hidden')).toBe('true')
    expect(pill().tabIndex).toBe(-1)
  })
})
