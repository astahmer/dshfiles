import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LandStatusModel } from './land-status.js'

describe('land categories in the shared status vocabulary', () => {
  it('draws Ready as the ink dot and keeps colour for conflicts and blocked work', () => {
    expect(LandStatusModel.glyph('ready')).toBe('ready')
    expect(LandStatusModel.glyph('conflicts')).toBe('failed')
    expect(LandStatusModel.glyph('blocked')).toBe('needs-you')
    expect(LandStatusModel.glyph('unknown')).toBe('stale')
    expect(LandStatusModel.glyph('integrating')).toBe('working')
    expect(LandStatusModel.glyph('integrated')).toBe('done')
    expect(LandStatusModel.glyph('no-changes')).toBe('done')
  })
})

describe('land filters', () => {
  const filters = ['attention', 'ready', 'blocked', 'conflicts', 'integrating', 'completed', 'all'] as const
  const none = { attention: 0, ready: 0, blocked: 0, conflicts: 0, integrating: 0, completed: 0, all: 0 }

  it('hides every filter that counts nothing, keeping Needs you and All', () => {
    expect(LandStatusModel.visibleFilters({ filters, counts: { ...none, all: 3, completed: 3 }, selected: 'attention' })).toEqual(['attention', 'completed', 'all'])
    expect(LandStatusModel.visibleFilters({ filters, counts: none, selected: 'attention' })).toEqual(['attention', 'all'])
  })

  it('keeps the selected filter on screen when its last row leaves', () => {
    expect(LandStatusModel.visibleFilters({ filters, counts: { ...none, all: 1, completed: 1 }, selected: 'ready' })).toEqual([
      'attention',
      'ready',
      'completed',
      'all',
    ])
  })
})

// DESIGN.md › Layout, counts: the heading counts what the unfiltered list shows, and a zero is not drawn.
describe('Workspaces counts', () => {
  it('counts the heading from the All filter and draws no zero', () => {
    expect(LandStatusModel.drawnCount(2)).toBe(2)
    expect(LandStatusModel.drawnCount(0)).toBeUndefined()
  })

  it('takes the heading count from the All filter, counted once from the list', () => {
    const panel = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'panel.tsx'), 'utf8')
    expect(panel).toContain('const headerCount = LandStatusModel.drawnCount(counts.all)')
    expect(panel).not.toMatch(/count: threads\.length/u)
  })

  it('names what could not be read when the destination lookup fails', () => {
    const locales = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'locales.ts'), 'utf8')
    expect(locales).toContain(`workspaceDestinationUnavailable: "Could not read the project's workspaces.",`)
  })
})
