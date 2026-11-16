import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')

describe('inbox page layout', () => {
  it('fills its pane: no centred max-width column on the page (DESIGN.md, Layout)', () => {
    const pages = panel.match(/<Page\b[^>]*>/gu) ?? []
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) expect(page).not.toMatch(/mx-auto|max-w-/u)
  })

  it('keeps a readable measure on the text of a row instead', () => {
    expect(InboxView.TEXT_MEASURE).toBe('dshx:max-w-[72ch]')
    expect(panel).toContain('InboxView.TEXT_MEASURE')
  })
})
