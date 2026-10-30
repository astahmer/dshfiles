import { describe, expect, it } from 'vitest'
import { WorkspaceLabels } from './workspace-labels.js'

const names = (count: number): string[] => Array.from({ length: count }, (_, index) => `ws-${index}`)

describe('WorkspaceLabels.forRow', () => {
  it('labels the default workspace only on its canonical working-copy revision', () => {
    expect(WorkspaceLabels.forRow({ commitId: 'default', workspaces: [] }, 'default')).toEqual({ shown: ['default'], hidden: [] })
    expect(WorkspaceLabels.forRow({ commitId: 'other', workspaces: [] }, 'default')).toEqual({ shown: [], hidden: [] })
    expect(WorkspaceLabels.forRow({ commitId: 'other', workspaces: ['default'] }, 'default')).toEqual({ shown: [], hidden: [] })
    expect(WorkspaceLabels.forRow({ commitId: 'other', workspaces: ['default'] }, null)).toEqual({ shown: ['default'], hidden: [] })
  })

  it('shows every workspace while they fit on the row', () => {
    expect(WorkspaceLabels.forRow({ commitId: 'revision', workspaces: names(4) }, null)).toEqual({ shown: names(4), hidden: [] })
  })

  it('retains the remaining workspaces in order for the overflow list', () => {
    const row = WorkspaceLabels.forRow({ commitId: 'revision', workspaces: names(6) }, null)
    expect(row.shown).toEqual(names(4))
    expect(row.hidden).toEqual(['ws-4', 'ws-5'])
  })

  it('retains every name even with hundreds of workspaces', () => {
    const row = WorkspaceLabels.forRow({ commitId: 'revision', workspaces: names(400) }, null)
    expect([...row.shown, ...row.hidden]).toEqual(names(400))
  })
})
