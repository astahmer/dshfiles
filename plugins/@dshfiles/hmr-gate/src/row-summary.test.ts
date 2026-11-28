import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { IDLE_SUMMARY, rowSummary } from './row-summary.js'

describe('the HMR updates row summary (council round 17, D3)', () => {
  it('describes the row in plain words while nothing waits', () => {
    expect(rowSummary([])).toBe('See which rebuilt plugins wait for a DSH restart.')
  })

  it('names what a restart applies while something waits', () => {
    expect(rowSummary(['@dshfiles/usage'])).toBe('@dshfiles/usage applies after DSH restarts.')
    expect(rowSummary(['a', 'b'])).toBe('2 plugins apply after DSH restarts.')
  })

  it('is what the row renders as its summary, always', () => {
    const client = readFileSync(fileURLToPath(new URL('client.tsx', import.meta.url)), 'utf8')
    const row = client.slice(client.indexOf('const HmrGateRow ='), client.indexOf('export default defineClient'))
    expect(row).toContain('rowSummary(packages.map(entry => entry.id))')
    expect(row).not.toContain('summary === undefined ? null')
    expect(IDLE_SUMMARY.endsWith('.')).toBe(true)
  })
})
