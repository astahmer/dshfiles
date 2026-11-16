import { describe, expect, it } from 'vitest'
import { WorkspaceControlModel } from './workspace-control-model.js'

const described = { description: 'Add the changelog entry', conflict: false }
const ready = { isThread: true, unlanded: [described], canLand: true, queued: false }

describe('the header Land verb', () => {
  it('shows while a thread workspace has described work that can land now', () => {
    expect(WorkspaceControlModel.showsLand(ready)).toBe(true)
  })

  it('is absent when there is nothing to land or the thread edits the project checkout', () => {
    expect(WorkspaceControlModel.showsLand({ ...ready, unlanded: [] })).toBe(false)
    expect(WorkspaceControlModel.showsLand({ ...ready, isThread: false })).toBe(false)
  })

  it('is absent while landing cannot start: a busy thread, a queued land, a conflict or a missing description', () => {
    expect(WorkspaceControlModel.showsLand({ ...ready, canLand: false })).toBe(false)
    expect(WorkspaceControlModel.showsLand({ ...ready, queued: true })).toBe(false)
    expect(WorkspaceControlModel.showsLand({ ...ready, unlanded: [described, { description: 'Fix', conflict: true }] })).toBe(false)
    expect(WorkspaceControlModel.showsLand({ ...ready, unlanded: [{ description: '  ', conflict: false }] })).toBe(false)
  })
})
