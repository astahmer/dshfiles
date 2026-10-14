import { describe, expect, it } from 'vitest'
import { panelShortcut, recentThreads } from './start-suggestions.js'

const row = (id: string, updatedAt: number, extra: { readonly running?: boolean; readonly blank?: boolean; readonly parentId?: string } = {}) => ({
  id,
  updatedAt,
  running: extra.running ?? false,
  blank: extra.blank ?? false,
  parentId: extra.parentId,
})

describe('recentThreads', () => {
  it('suggests running threads first, then the most recent, skipping blank threads and subagents, five at most', () => {
    const rows = [
      row('old', 1),
      row('blank', 9, { blank: true }),
      row('child', 9, { parentId: 'old' }),
      row('busy', 2, { running: true }),
      ...['a', 'b', 'c', 'd', 'e'].map((id, index) => row(id, 10 + index)),
    ]
    expect(recentThreads(rows, thread => thread.running).map(thread => thread.id)).toEqual(['busy', 'e', 'd', 'c', 'b'])
  })
})

describe('panelShortcut', () => {
  it('shows the bound command named after the panel, and nothing when it has none', () => {
    const catalog = [
      { id: 'jujutsu.open', label: 'Open Jujutsu', keys: ['⌥', '⌘', 'J'], aria: 'Alt+Meta+J' },
      { id: 'memory.toggle', label: 'Memory', keys: [], aria: undefined },
    ]
    expect(panelShortcut(catalog, 'Jujutsu')?.id).toBe('jujutsu.open')
    expect(panelShortcut(catalog, 'Memory')).toBeUndefined()
  })
})
