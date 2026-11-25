import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Backlog nav glyph (council round 6, D3)', () => {
  it("draws the Work destination's list glyph, the one its rail item and tab draw, not a board of its own", () => {
    const entry = read('client-entry.tsx')
    const glyph = entry.slice(entry.indexOf('const PanelGlyph = '))
    expect(glyph).toContain('<ListTodoIcon')
    expect(glyph).toContain('strokeWidth={1.5}')
    expect(glyph).not.toContain('<rect')
    // The Work destination (rail and tab) is the list-todo glyph in thread-sidebar and workbench.
    expect(read('../../thread-sidebar/src/destinations.ts')).toMatch(/id: 'work',[^}]*icon: 'list-todo'/u)
    expect(entry).toContain("{ name: 'sidebar.panellist', id: PANEL_ID, order: 3, label: 'Backlog' }, PanelGlyph")
  })
})
