import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HostsHeader } from './hosts-header.js'

const source = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('Hosts page header', () => {
  it('says how linking stands in one chip, and nothing while the status is unknown', () => {
    expect(HostsHeader.linkChip(undefined)).toBeNull()
    expect(HostsHeader.linkChip({ enabled: false, listening: false })).toBe('Linking off')
    expect(HostsHeader.linkChip({ enabled: true, listening: true })).toBe('Linking on')
    expect(HostsHeader.linkChip({ enabled: true, listening: false })).toBe('Linking on, not listening')
  })
  it('names the auto destination as header meta', () => {
    expect(HostsHeader.autoChip(undefined)).toBeNull()
    expect(HostsHeader.autoChip(null)).toBe('Auto destination unavailable')
    expect(HostsHeader.autoChip({ hostName: 'Build box' })).toBe('Auto destination: Build box')
  })
  it('opens linking from a header action instead of a form above the list', () => {
    const page = source('hosts-page.tsx')
    expect(page).toContain("id: 'link-this-machine'")
    expect(page).toContain('<LinkThisMachineDialog')
    expect(page).not.toMatch(/<LinkThisMachine\s/u)
    expect(page).not.toContain('<span className="dshx:font-medium">Auto destination</span>')
  })
  it('shows linking as a dialog with one switch for its state, not a badge and a switch', () => {
    const link = source('link-machines.tsx')
    expect(link).toContain('<DialogTitle>Link this machine</DialogTitle>')
    expect(link).not.toContain("{enabled ? 'Not listening' : 'Off'}")
  })
})
