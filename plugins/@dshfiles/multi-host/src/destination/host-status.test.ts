import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hostGlyph, stepGlyph } from './host-status.js'

const source = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('host status', () => {
  it('maps onto the shared glyphs: a connected host is quiet, only a failed one is coloured', () => {
    expect(hostGlyph('online')).toBe('idle')
    expect(hostGlyph('idle')).toBe('stale')
    expect(hostGlyph('error')).toBe('failed')
  })
  it('draws a passed connection step as a muted check, not a green one', () => {
    expect(stepGlyph(true)).toBe('done')
    expect(stepGlyph(false)).toBe('failed')
    expect(source('connection-test-steps.tsx')).toContain('<StatusGlyph')
  })
  it('names no palette colour for a host state, and no native title on the destination chip', () => {
    for (const file of ['connection-test-steps.tsx', 'hosts-dialog.tsx', 'host-chip.tsx']) expect(source(file), file).not.toMatch(/emerald|bg-success/u)
    expect(source('host-chip.tsx')).not.toMatch(/\stitle=\{/u)
  })
})
