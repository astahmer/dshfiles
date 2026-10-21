import { describe, expect, it } from 'vitest'

import { StartThreadPlacementPlan } from './start-thread-workspace.js'

const registered = [
  { id: 'ws-first', path: '/Users/astahmer/dev/first' },
  { id: 'ws-dshfiles', path: '/Users/astahmer/dev/dshfiles' },
]

describe('StartThreadPlacementPlan', () => {
  it('keeps the project a caller named, so the thread is cut from it', () => {
    expect(StartThreadPlacementPlan.of({ workspaceId: 'ws-dshfiles', registered, itemProjects: [null] })).toEqual({
      workspaceId: 'ws-dshfiles',
      cwd: undefined,
    })
  })

  it('keeps a bare folder instead of provisioning a workspace for it', () => {
    expect(StartThreadPlacementPlan.of({ cwd: '/Users/astahmer/dev/unregistered', registered, itemProjects: ['/Users/astahmer/dev/dshfiles'] })).toEqual({
      workspaceId: undefined,
      cwd: '/Users/astahmer/dev/unregistered',
    })
  })

  it('uses the first item project a caller did not name', () => {
    expect(StartThreadPlacementPlan.of({ registered, itemProjects: [null, '/Users/astahmer/dev/dshfiles'] })).toEqual({
      workspaceId: 'ws-dshfiles',
      cwd: undefined,
    })
  })

  it('takes a project path no workspace claims as a bare folder', () => {
    expect(StartThreadPlacementPlan.of({ registered, itemProjects: ['/Users/astahmer/dev/unregistered'] })).toEqual({
      workspaceId: undefined,
      cwd: '/Users/astahmer/dev/unregistered',
    })
  })

  it('joins the first registered workspace for an item with no project', () => {
    expect(StartThreadPlacementPlan.of({ registered, itemProjects: [null] })).toEqual({ workspaceId: 'ws-first', cwd: undefined })
  })

  it('leaves the choice to the Host when no workspace is registered at all', () => {
    expect(StartThreadPlacementPlan.of({ registered: [], itemProjects: [null] })).toEqual({ workspaceId: undefined, cwd: undefined })
  })
})
