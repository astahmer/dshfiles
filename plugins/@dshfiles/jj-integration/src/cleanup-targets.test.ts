import { describe, expect, it } from 'vitest'
import { filterCleanupTargets } from './cleanup-targets.js'

describe('filterCleanupTargets', () => {
  const workspaces = [
    { repoRoot: '/repo', name: 'empty-one', kind: 'empty' as const },
    { repoRoot: '/repo', name: 'landed-one', kind: 'integrated' as const },
  ]
  const untracked = [{ repoRoot: '/repo', name: 'stray-folder' }]

  it('keeps legacy all-candidates behavior when targets are omitted', () => {
    expect(filterCleanupTargets({ workspaces, untracked })).toEqual({ workspaces, untracked })
  })

  it('limits each type to explicitly selected repository/name/kind tuples', () => {
    expect(
      filterCleanupTargets({
        workspaces,
        untracked,
        targets: [
          { repoRoot: '/repo', name: 'landed-one', kind: 'integrated' },
          { repoRoot: '/repo', name: 'stray-folder', kind: 'untracked' },
          { repoRoot: '/elsewhere', name: 'empty-one', kind: 'empty' },
        ],
      }),
    ).toEqual({ workspaces: [workspaces[1]], untracked })
  })

  it('treats an explicit empty selection as selecting nothing', () => {
    expect(filterCleanupTargets({ workspaces, untracked, targets: [] })).toEqual({ workspaces: [], untracked: [] })
  })
})
