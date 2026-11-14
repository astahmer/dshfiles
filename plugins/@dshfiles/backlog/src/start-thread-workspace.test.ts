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

describe('StartThreadPlacementPlan.checkout', () => {
  const project = { workspaceId: 'ws-dshfiles', cwd: undefined }

  it('cuts a new workspace from the main branch when the caller chose nothing, as before', () => {
    expect(StartThreadPlacementPlan.checkout({ placement: project })).toEqual({ ok: true, checkout: { kind: 'own', base: undefined } })
  })

  it('starts the new workspace from the bookmark the caller chose, a remote one included', () => {
    expect(StartThreadPlacementPlan.checkout({ placement: project, base: 'feature@origin' })).toEqual({
      ok: true,
      checkout: { kind: 'own', base: 'feature@origin' },
    })
  })

  it('runs in the project checkout itself when the caller turned isolation off', () => {
    expect(StartThreadPlacementPlan.checkout({ placement: project, isolate: false })).toEqual({ ok: true, checkout: { kind: 'in-place' } })
  })

  it('refuses a starting bookmark for a thread that stays in the project checkout', () => {
    const planned = StartThreadPlacementPlan.checkout({ placement: project, isolate: false, base: 'main' })
    expect(planned.ok).toBe(false)
    expect(planned.ok ? '' : planned.reason).toMatch(/isolate: true/u)
  })

  it('refuses a starting bookmark when the thread has no project to cut a workspace from', () => {
    const planned = StartThreadPlacementPlan.checkout({ placement: { workspaceId: undefined, cwd: '/tmp/folder' }, base: 'main' })
    expect(planned.ok).toBe(false)
    expect(planned.ok ? '' : planned.reason).toMatch(/registered project/u)
  })

  it('ignores isolation for a bare folder, which has no workspace to cut', () => {
    expect(StartThreadPlacementPlan.checkout({ placement: { workspaceId: undefined, cwd: '/tmp/folder' }, isolate: true })).toEqual({
      ok: true,
      checkout: { kind: 'in-place' },
    })
  })
})
