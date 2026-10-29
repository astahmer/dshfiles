import { describe, expect, it } from 'vitest'
import { WorkspaceLabels } from './workspace-labels.js'

const names = (count: number): string[] => Array.from({ length: count }, (_, index) => `ws-${index}`)

describe('WorkspaceLabels.forRow', () => {
  it('labels the default working copy when jj names no workspace', () => {
    expect(WorkspaceLabels.forRow({ workingCopy: true, workspaces: [] })).toEqual({ shown: ['default'], hidden: [], overflowHint: '' })
  })

  it('shows every workspace while they fit on the row', () => {
    expect(WorkspaceLabels.forRow({ workingCopy: false, workspaces: names(4) })).toEqual({ shown: names(4), hidden: [], overflowHint: '' })
  })

  it('collapses the rest into one chip whose hint names them', () => {
    const row = WorkspaceLabels.forRow({ workingCopy: false, workspaces: names(6) })
    expect(row.shown).toEqual(names(4))
    expect(row.hidden).toEqual(['ws-4', 'ws-5'])
    expect(row.overflowHint).toBe('Also the working copy of ws-4, ws-5')
  })

  it('bounds the hint for hundreds of workspaces', () => {
    const row = WorkspaceLabels.forRow({ workingCopy: false, workspaces: names(400) })
    expect(row.hidden).toHaveLength(396)
    expect(row.overflowHint).toMatch(/^Also the working copy of ws-4, .*ws-23 and 376 more$/)
  })
})
