import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isTruncated } from '../src/picker-atoms.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

describe('tooltips only when they add something (council picker N3)', () => {
  it('opens a name tooltip only for a truncated name', () => {
    expect(isTruncated({ scrollWidth: 240, clientWidth: 180 })).toBe(true)
    expect(isTruncated({ scrollWidth: 180, clientWidth: 180 })).toBe(false)
    expect(isTruncated({ scrollWidth: 181, clientWidth: 180 })).toBe(false)
    expect(isTruncated(null)).toBe(false)
  })

  it('waits 500 ms before any picker tooltip opens', () => {
    expect(source('model-effort-picker.tsx')).toContain('<TooltipProvider delayDuration={500}>')
  })

  it('wraps the row name and the service label in the truncation-only tooltip, placed below so the search stays clear', () => {
    expect(source('model-row.tsx')).toMatch(/<TruncatedTooltip content=\{props\.model\.id\}>/u)
    expect(source('model-row.tsx')).not.toMatch(/<Tooltip>/u)
    const atoms = source('picker-atoms.tsx')
    expect(atoms.slice(atoms.indexOf('export const ProviderLabel'))).toMatch(/^[^]*?<TruncatedTooltip/u)
    expect(atoms.slice(atoms.indexOf('export const TruncatedTooltip'), atoms.indexOf('export const ProviderLabel'))).toMatch(/side="bottom"/u)
  })
})
