// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from '../src/components/ui/button.js'
import { TooltipProvider } from '../src/components/ui/tooltip.js'

afterEach(cleanup)

const classesOf = (variant: React.ComponentProps<typeof Button>['variant']): readonly string[] => {
  const view = render(<Button variant={variant}>Go</Button>)
  const list = (view.getByRole('button').getAttribute('class') ?? '').split(/\s+/)
  cleanup()
  return list
}

/** DESIGN.md › Motion: controls answer a press within 80ms. */
describe('button press feedback', () => {
  it('washes every pressable variant on :active within the 80ms hover token', () => {
    const wash = {
      default: 'dshx:active:bg-primary/80',
      destructive: 'dshx:active:bg-destructive-solid/80',
      secondary: 'dshx:active:bg-secondary/70',
      outline: 'dshx:active:bg-(--dsw-alias-interactive-bg-active)',
      ghost: 'dshx:active:bg-(--dsw-alias-interactive-bg-active)',
    } as const
    for (const [variant, active] of Object.entries(wash)) {
      // SAFETY: Object.entries of the literal wash table yields only its own keys, each a button variant.
      const list = classesOf(variant as keyof typeof wash)
      expect(list, variant).toContain(active)
      expect(list, variant).toContain('dshx:duration-(--dshx-duration-hover)')
      // Only colour, shadow and the press scale animate: `transition-all` would also animate layout.
      expect(list, variant).not.toContain('dshx:transition-all')
      expect(list, variant).toContain('dshx:transition-[color,background-color,border-color,box-shadow,scale]')
    }
  })

  it('scales a pressed button only under a coarse pointer, and never under reduced motion', () => {
    const list = classesOf('default')
    expect(list).toContain('dshx:pointer-coarse:motion-safe:active:scale-[0.97]')
    expect(list.filter(token => token.includes('scale-') && !token.includes('pointer-coarse:'))).toEqual([])
  })
})

describe('tooltip timing', () => {
  it('waits 400ms before the first tooltip and 300ms of grace between neighbours', () => {
    // SAFETY: TooltipProvider returns the Radix Provider element with the timing props it forwarded.
    const element = TooltipProvider({ children: null }) as React.ReactElement<{ delayDuration: number; skipDelayDuration: number }>
    expect(element.props.delayDuration).toBe(400)
    expect(element.props.skipDelayDuration).toBe(300)
    // SAFETY: as above, the returned element carries the delay the caller passed.
    const instant = TooltipProvider({ delayDuration: 0, children: null }) as React.ReactElement<{ delayDuration: number }>
    expect(instant.props.delayDuration).toBe(0)
  })
})
