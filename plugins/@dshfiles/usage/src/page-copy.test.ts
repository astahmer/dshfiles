import { describe, expect, it } from 'vitest'
import { USAGE_PAGE_DESCRIPTION, indexedLogsLabel } from './page-copy.js'
import { readFileSync } from 'node:fs'

describe('Usage page copy', () => {
  it('keeps the description to one line of at most 72 characters', () => {
    expect(USAGE_PAGE_DESCRIPTION.length).toBeLessThanOrEqual(72)
    expect(USAGE_PAGE_DESCRIPTION).not.toContain('models.dev')
  })
  it('is the description the page renders, with the price caveat left to the cost tooltip', () => {
    const panel = readFileSync(new URL('panel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('description={USAGE_PAGE_DESCRIPTION}')
    expect(panel).not.toContain('logs indexed')
  })
  it('counts one log as one log', () => {
    expect(indexedLogsLabel(1)).toBe('1 log indexed')
    expect(indexedLogsLabel(1204)).toBe(`${(1204).toLocaleString()} logs indexed`)
  })
})

describe('Usage filters on a phone', () => {
  it('scrolls the Purpose chips sideways instead of wrapping them into rows', () => {
    const panel = readFileSync(new URL('panel.tsx', import.meta.url), 'utf8')
    const row = panel.split('\n').find(line => line.includes('aria-label="Purpose"')) ?? ''
    expect(row).toContain('dshx:overflow-x-auto')
    expect(row).not.toContain('dshx:flex-wrap')
  })
})
