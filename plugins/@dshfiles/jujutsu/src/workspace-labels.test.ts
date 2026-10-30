import { describe, expect, it } from 'vitest'
import { WorkspaceLabels } from './workspace-labels.js'

const names = (count: number): string[] => Array.from({ length: count }, (_, index) => `ws-${index}`)

describe('WorkspaceLabels.forRow', () => {
  it('labels the default working copy when jj names no workspace', () => {
    expect(WorkspaceLabels.forRow({ workingCopy: true, workspaces: [] })).toEqual({ shown: ['default'], hidden: [] })
  })

  it('shows every workspace while they fit on the row', () => {
    expect(WorkspaceLabels.forRow({ workingCopy: false, workspaces: names(4) })).toEqual({ shown: names(4), hidden: [] })
  })

  it('retains the remaining workspaces in order for the overflow list', () => {
    const row = WorkspaceLabels.forRow({ workingCopy: false, workspaces: names(6) })
    expect(row.shown).toEqual(names(4))
    expect(row.hidden).toEqual(['ws-4', 'ws-5'])
  })

  it('retains every name even with hundreds of workspaces', () => {
    const row = WorkspaceLabels.forRow({ workingCopy: false, workspaces: names(400) })
    expect([...row.shown, ...row.hidden]).toEqual(names(400))
  })
})
