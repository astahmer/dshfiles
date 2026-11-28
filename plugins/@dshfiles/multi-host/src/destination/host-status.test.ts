import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HostStatus } from './host-status.js'

const source = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('host status', () => {
  it('shows a host as one health dot: green connected, a faint ring idle or never connected, red on error', () => {
    expect(HostStatus.health('online')).toBe('ok')
    expect(HostStatus.health('idle')).toBe('off')
    expect(HostStatus.health('error')).toBe('down')
  })
  it('draws the health dot on the chip, the picker and the Hosts page instead of a work-status glyph', () => {
    expect(source('hosts-dialog.tsx')).toMatch(/<HealthDot[^>]*health=\{HostStatus\.health\(/u)
    expect(source('hosts-page.tsx')).toMatch(/<HealthDot[^>]*health=\{health\}/u)
    expect(source('hosts-page.tsx')).not.toMatch(/status=\{hostWorkStatus|StatusGlyph/u)
    expect(source('hosts-page.tsx')).toContain('healthTextClass[health]')
  })
  it('draws a passed connection step as a muted check, not a green one', () => {
    expect(HostStatus.stepGlyph(true)).toBe('done')
    expect(HostStatus.stepGlyph(false)).toBe('failed')
    expect(source('connection-test-steps.tsx')).toContain('<StatusGlyph')
  })
  it('names no palette colour for a host state, and no native title on the destination chip', () => {
    for (const file of ['connection-test-steps.tsx', 'hosts-dialog.tsx', 'host-chip.tsx']) expect(source(file), file).not.toMatch(/emerald|bg-success/u)
    expect(source('host-chip.tsx')).not.toMatch(/\stitle=\{/u)
  })
})
