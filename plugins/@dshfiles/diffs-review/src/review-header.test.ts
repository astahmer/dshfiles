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
    expect(panel).toContain('ReviewHeader.scopeNote(summary ?? scope.summary)')
  })

  it('sets counters and the base field in the UI sans with tabular figures, never monospace', () => {
    const stat = panel.slice(panel.indexOf('const Stat ='), panel.indexOf('/** The page'))
    expect(stat).toContain('dshx:tabular-nums')
    expect(stat).not.toContain('font-mono')
    const base = panel.slice(panel.indexOf('aria-label="Base branch or bookmark"'), panel.indexOf('/>', panel.indexOf('aria-label="Base branch or bookmark"')))
    expect(base).not.toContain('font-mono')
  })

  it('gives each file one reviewed control: a checkbox that reads "Mark reviewed" (council round 5, D3)', () => {
    expect(panel).not.toContain('for batch review')
    expect(panel).toMatch(/<Checkbox\s+aria-label=\{`Reviewed: \$\{path\}`\}/u)
    expect(panel).toMatch(/<span[^>]*>Mark reviewed<\/span>/u)
    expect(panel).toContain('All files reviewed')
  })

  it('lets the diff card hug its files and marks the chosen project with its ProjectMark', () => {
    expect(panel).not.toContain('dshx:min-h-64 dshx:flex-1')
    expect(panel).toMatch(/<ProjectMark name=\{pickerProjectName\} size="dense" \/>/u)
  })
})

describe('the Review page controls (council round 5, D3)', () => {
  const panel = readFileSync(fileURLToPath(new URL('panel.tsx', import.meta.url)), 'utf8')
  const base = panel.slice(panel.indexOf('data-review-base'), panel.indexOf('/>', panel.indexOf('aria-label="Base branch or bookmark"')))

  it('names the base once, in the branch control: "Base: main" in value ink, no "since" chip beside the title', () => {
    expect(panel).not.toContain('ReviewHeader.rangeLabel(result.range)')
    expect(panel).not.toMatch(/<Page[^>]*\smeta=/u)
    expect(base).toMatch(/<span[^>]*>\s*Base:\s*<\/span>/u)
    expect(base).toContain("placeholder={base ?? 'default'}")
    expect(base).toContain('dshx:placeholder:text-foreground')
    expect(base).not.toContain('Base branch (')
  })

  it('keeps every control on the kit control height: no per-control height, no small picker button', () => {
    expect(base).not.toContain('dshx:h-8')
    const picker = panel.slice(
      panel.indexOf('aria-label="Choose project or workspace"'),
      panel.indexOf('>', panel.indexOf('variant="outline"', panel.indexOf('aria-label="Choose project or workspace"'))),
    )
    expect(picker).not.toContain('size="sm"')
  })

  it('shows no review counter or bar for a single file: its header control is the whole review state', () => {
    const toolbar = panel.slice(panel.indexOf('data-review-toolbar'), panel.indexOf('result.truncated'))
    expect(toolbar).toMatch(/result\.fileCount > 1 \? \(\s*<>\s*<Stat label=\{`\$\{totalReviewed\}\/\$\{result\.fileCount\} reviewed`\} \/>/u)
  })

  it('folds Refresh into the overflow menu', () => {
    const refresh = panel.slice(panel.indexOf("id: 'refresh'"), panel.indexOf('}', panel.indexOf("id: 'refresh'")))
    expect(refresh).toContain("placement: 'overflow'")
  })
})

describe('the Review file header (council round 6, D2)', () => {
  const panel = readFileSync(fileURLToPath(new URL('panel.tsx', import.meta.url)), 'utf8')
  const look = readFileSync(fileURLToPath(new URL('review-look.ts', import.meta.url)), 'utf8')

  it('leads with the file-type mark and the path: nothing renders before them', () => {
    expect(panel).not.toContain('renderHeaderPrefix')
    expect(panel).not.toContain('<Badge')
  })

  it('names the scope as quiet trailing text only when it is news: several scopes, or a written summary', () => {
    expect(ReviewHeader.showScope({ scopeCount: 1, summarized: false })).toBe(false)
    expect(ReviewHeader.showScope({ scopeCount: 2, summarized: false })).toBe(true)
    expect(ReviewHeader.showScope({ scopeCount: 1, summarized: true })).toBe(true)
    expect(panel).toMatch(/ReviewHeader\.showScope\(\{ scopeCount: scopes\.length, summarized: summary !== undefined \}\)/u)
    // The label stays its own element ("Docs", "Code"), the note follows it, and the reviewed control ends the header.
    expect(panel).toMatch(
      /data-review-scope-note>\s*<span className="dshx:font-medium">\{scope\.label\}<\/span> · \{ReviewHeader\.scopeNote\(summary \?\? scope\.summary\)\}\s*<\/span>\s*\) : null\}\s*\{reviewControls\(file\.name\)\}/u,
    )
  })

  it("draws Mark reviewed on the fields' 3:1 boundary with a full-ink label", () => {
    const toggle = /REVIEWED_TOGGLE =\s*'([^']*)'/u.exec(look)?.[1] ?? ''
    expect(toggle).toContain('dshx:border-field-border')
    expect(toggle).toContain('dshx:text-foreground')
    expect(toggle).not.toContain('dshx:text-muted-foreground')
    expect(toggle).not.toContain('dshx:border-border')
  })
})

describe('Review page title mark (council round 7, D1)', () => {
  const panel = readFileSync(fileURLToPath(new URL('panel.tsx', import.meta.url)), 'utf8')
  it('marks both Review pages with the Land destination glyph in its nav tone', () => {
    const pages = panel
      .split('<Page')
      .slice(1)
      .map(part => part.slice(0, part.indexOf('heading="Review"')))
    expect(pages).toHaveLength(2)
    for (const page of pages) {
      expect(page).toContain('mark={<GitMerge />}')
      expect(page).toContain('markTone="land"')
    }
  })
})
