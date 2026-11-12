import { describe, expect, it } from 'vitest'
import { OwnWorkspaceModel } from './own-workspace.js'

const t = ((key: string, params?: Record<string, unknown>) => `${key}${params === undefined ? '' : ` ${JSON.stringify(params)}`}`) as never

describe('OwnWorkspaceModel', () => {
  it('is undefined for a thread in the project checkout', () => {
    expect(OwnWorkspaceModel.of({ registered: undefined, cwd: '/dev/sample', thread: undefined, rebasedAt: undefined, t })).toBeUndefined()
  })

  it('keeps the folder name for the tooltip only, with no state when nothing is pending', () => {
    expect(OwnWorkspaceModel.of({ registered: '/dev/sample-threads/thread-e4fde2', cwd: undefined, thread: undefined, rebasedAt: undefined, t })).toEqual({
      name: 'thread-e4fde2',
      path: '/dev/sample-threads/thread-e4fde2',
      state: undefined,
    })
  })

  it('still finds a workspace whose registration is gone from the Session cwd', () => {
    expect(OwnWorkspaceModel.of({ registered: undefined, cwd: '/dev/sample-threads/thread-a', thread: undefined, rebasedAt: 5, t })?.state).toEqual({
      kind: 'landed',
      text: 'threadSidebarWorkspaceLanded',
      at: 5,
    })
  })

  it('says what is left to land before it says it landed or fell behind', () => {
    const thread = { path: '/dev/sample-threads/thread-a', unlanded: [{}, {}], behindCount: 3, rebasedAt: 1 }
    expect(OwnWorkspaceModel.stateOf({ thread, rebasedAt: 1, t })).toEqual({ kind: 'to-land', text: 'threadSidebarWorkspaceToLand {"count":2}' })
    expect(OwnWorkspaceModel.stateOf({ thread: { ...thread, unlanded: [] }, rebasedAt: undefined, t })?.kind).toBe('landed')
    expect(OwnWorkspaceModel.stateOf({ thread: { ...thread, unlanded: [], rebasedAt: undefined }, rebasedAt: undefined, t })).toEqual({
      kind: 'behind',
      text: 'threadSidebarWorkspaceBehind {"count":3}',
    })
  })
})
