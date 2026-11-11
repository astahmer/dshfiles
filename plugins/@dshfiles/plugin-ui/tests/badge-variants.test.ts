import { describe, expect, it } from 'vitest'
import { badgeVariants } from '../src/components/ui/badge.js'

describe('badge variants', () => {
  it('tints danger like info, success and warning instead of filling it', () => {
    const danger = badgeVariants({ variant: 'danger' }).split(' ')
    expect(danger).toContain('dshx:bg-destructive/15')
    expect(danger).toContain('dshx:text-destructive')
    expect(badgeVariants({ variant: 'warning' }).split(' ')).toContain('dshx:bg-warning/15')
  })
})
