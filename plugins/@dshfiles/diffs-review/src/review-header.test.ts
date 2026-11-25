import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ReviewHeader } from './review-header.js'

describe('the Review page header in plain words', () => {
  it('names the base instead of printing the revset', () => {
    expect(ReviewHeader.rangeLabel('main..@')).toBe('since main')
    expect(ReviewHeader.rangeLabel('trunk..@')).toBe('since trunk')
  })

  it('says which project has no changes', () => {
    expect(ReviewHeader.emptyText({ target: 'sample', base: 'main' })).toBe('No changes since main in sample.')
  })

  it('draws no line stats and no progress bar while nothing changed', () => {
    expect(ReviewHeader.showStats(0)).toBe(false)
    expect(ReviewHeader.showStats(3)).toBe(true)
    const panel = readFileSync(fileURLToPath(new URL('panel.tsx', import.meta.url)), 'utf8')
    expect(panel).toContain("result?.status === 'ok' && ReviewHeader.showStats(result.fileCount)")
    expect(panel).not.toContain('This thread has no changes since')
  })
})
