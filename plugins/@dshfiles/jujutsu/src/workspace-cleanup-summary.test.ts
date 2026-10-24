import { describe, expect, it } from 'vitest'
import { WorkspaceCleanupSummary } from './workspace-cleanup-summary.js'

describe('WorkspaceCleanupSummary.resolveAgeHours', () => {
  it('uses a selected preset and accepts a positive whole custom hour value', () => {
    expect(WorkspaceCleanupSummary.resolveAgeHours({ presetHours: 6, customHours: '' })).toBe(6)
    expect(WorkspaceCleanupSummary.resolveAgeHours({ presetHours: null, customHours: '12' })).toBe(12)
  })

  it('rejects empty, non-positive and fractional custom values', () => {
    expect(WorkspaceCleanupSummary.resolveAgeHours({ presetHours: null, customHours: '' })).toBeUndefined()
    expect(WorkspaceCleanupSummary.resolveAgeHours({ presetHours: null, customHours: '0' })).toBeUndefined()
    expect(WorkspaceCleanupSummary.resolveAgeHours({ presetHours: null, customHours: '1.5' })).toBeUndefined()
  })
})

describe('WorkspaceCleanupSummary.formatCount', () => {
  it('uses singular and plural labels instead of parenthetical suffixes', () => {
    expect(WorkspaceCleanupSummary.formatCount(1, 'item', 'items')).toBe('1 item')
    expect(WorkspaceCleanupSummary.formatCount(3, 'item', 'items')).toBe('3 items')
  })
})

describe('WorkspaceCleanupSummary.skipLabel', () => {
  it('explains why a secondary workspace was kept', () => {
    expect(WorkspaceCleanupSummary.skipLabel('working-copy-dirty')).toBe('workspace with uncommitted changes')
    expect(WorkspaceCleanupSummary.skipLabel('workspace-state-unknown')).toBe('workspace whose state could not be verified')
  })
})

describe('WorkspaceCleanupSummary.format', () => {
  it('formats zero and singular revisions naturally', () => {
    expect(WorkspaceCleanupSummary.format({ emptyRevisionCount: 0, skippedReasons: [] })).toEqual(['0 empty revisions will be abandoned.'])
    expect(WorkspaceCleanupSummary.format({ emptyRevisionCount: 1, skippedReasons: [] })).toEqual(['1 empty revision will be abandoned.'])
  })

  it('joins two skipped reasons without stray punctuation', () => {
    expect(WorkspaceCleanupSummary.format({ emptyRevisionCount: 0, skippedReasons: ['has-work', 'busy'] })).toEqual([
      '0 empty revisions will be abandoned.',
      'Skipped 2 workspaces: 1 workspace with unlanded work and 1 workspace with a working thread.',
    ])
  })

  it('groups skipped workspaces by reason with readable punctuation', () => {
    expect(
      WorkspaceCleanupSummary.format({
        emptyRevisionCount: 2,
        skippedReasons: ['has-work', 'has-work', 'too-recent', 'busy'],
      }),
    ).toEqual([
      '2 empty revisions will be abandoned.',
      'Skipped 4 workspaces: 2 workspaces with unlanded work, 1 recently used workspace, and 1 workspace with a working thread.',
    ])
  })
})
