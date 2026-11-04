import { act, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PresenceList } from '../src/components/motion/presence-list.js'
import { RollingNumber } from '../src/components/motion/text.js'
import { motionSafe, springs } from '../src/motion/index.js'

const setReducedMotion = (reduced: boolean) => {
  vi.stubGlobal('matchMedia', (query: string): Pick<MediaQueryList, 'matches' | 'media' | 'addEventListener' | 'removeEventListener'> => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('motion layer', () => {
  it('ends animations instantly under reduced motion', () => {
    setReducedMotion(true)
    expect(motionSafe({ ...springs.smooth, delay: 0.2 })).toMatchObject({ duration: 0, delay: 0, type: undefined })
    setReducedMotion(false)
    expect(motionSafe(springs.smooth)).toEqual(springs.smooth)
  })

  it('keeps a removed PresenceList item until its exit ends, hidden from assistive tech', async () => {
    setReducedMotion(true)
    const items = (keys: readonly string[]) => keys.map(key => ({ key, node: <span>{key}</span> }))
    const { rerender } = render(<PresenceList items={items(['a', 'b'])} />)
    rerender(<PresenceList items={items(['a'])} />)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.queryByText('b')).toBeNull()
  })

  it('exposes the plain value of a RollingNumber to screen readers', () => {
    setReducedMotion(true)
    const { container, rerender } = render(<RollingNumber value={1280} />)
    rerender(<RollingNumber value={1310} />)
    expect(container.querySelector('.dshx\\:sr-only')?.textContent).toBe((1310).toLocaleString())
  })
})

void React
