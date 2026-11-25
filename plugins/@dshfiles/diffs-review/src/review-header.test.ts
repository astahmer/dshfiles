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

describe('the Review page controls (council round 2, D3)', () => {
  const panel = readFileSync(fileURLToPath(new URL('panel.tsx', import.meta.url)), 'utf8')

  it('drops the full stop a one-sentence scope note ends with, and keeps a longer summary as written', () => {
    expect(ReviewHeader.scopeNote('Source changes.')).toBe('Source changes')
    expect(ReviewHeader.scopeNote('Rounds tax per line. Adds a test.')).toBe('Rounds tax per line. Adds a test.')
    expect(ReviewHeader.scopeNote('Docs')).toBe('Docs')
    expect(panel).toContain('ReviewHeader.scopeNote(aiSummaries?.[scope.key] ?? scope.summary)')
  })

  it('sets counters and the base field in the UI sans with tabular figures, never monospace', () => {
    const stat = panel.slice(panel.indexOf('const Stat ='), panel.indexOf('/** The page'))
    expect(stat).toContain('dshx:tabular-nums')
    expect(stat).not.toContain('font-mono')
    const base = panel.slice(panel.indexOf('aria-label="Base branch or bookmark"'), panel.indexOf('/>', panel.indexOf('aria-label="Base branch or bookmark"')))
    expect(base).not.toContain('font-mono')
  })

  it('gives each file one reviewed control: a checkbox labelled "Reviewed"', () => {
    expect(panel).not.toContain('Mark reviewed')
    expect(panel).not.toContain('for batch review')
    expect(panel).toMatch(/<Checkbox\s+aria-label=\{`Reviewed: \$\{path\}`\}/u)
    expect(panel).toMatch(/<span[^>]*>Reviewed<\/span>/u)
    expect(panel).toContain('All files reviewed')
  })

  it('lets the diff card hug its files and marks the chosen project with its ProjectMark', () => {
    expect(panel).not.toContain('dshx:min-h-64 dshx:flex-1')
    expect(panel).toMatch(/<ProjectMark name=\{pickerProjectName\} size="dense" \/>/u)
  })
})
