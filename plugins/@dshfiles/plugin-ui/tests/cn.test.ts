import { describe, expect, it } from 'vitest'
import { cn } from '../src/lib/utils.ts'

const tokens = (value: string): readonly string[] => value.split(/\s+/u)

describe('cn knows the kit type scale (council round 4)', () => {
  it.each(['2xs', 'title', 'heading', 'display', 'query'])('keeps text-%s as a size beside a text colour', step => {
    expect(tokens(cn(`dshx:text-${step}`, 'dshx:text-foreground'))).toEqual([`dshx:text-${step}`, 'dshx:text-foreground'])
    expect(tokens(cn('dshx:text-muted-foreground', `dshx:text-${step}`))).toEqual(['dshx:text-muted-foreground', `dshx:text-${step}`])
  })

  it('still lets a later size replace an earlier one', () => {
    expect(cn('dshx:text-sm', 'dshx:text-heading')).toBe('dshx:text-heading')
    expect(cn('dshx:text-heading', 'dshx:text-xs')).toBe('dshx:text-xs')
    expect(cn('dshx:text-foreground', 'dshx:text-muted-foreground')).toBe('dshx:text-muted-foreground')
  })

  it('treats the kit weights as weights', () => {
    expect(cn('dshx:font-medium', 'dshx:font-title')).toBe('dshx:font-title')
    expect(cn('dshx:font-selected', 'dshx:font-semibold')).toBe('dshx:font-semibold')
    expect(tokens(cn('dshx:font-title', 'dshx:font-mono'))).toEqual(['dshx:font-title', 'dshx:font-mono'])
  })
})
