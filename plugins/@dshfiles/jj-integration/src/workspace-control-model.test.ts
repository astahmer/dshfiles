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

  it('names the one reason a requested Land cannot open its confirmation', () => {
    expect(WorkspaceControlModel.landBlock(ready)).toBeUndefined()
    expect(WorkspaceControlModel.landBlock({ ...ready, isThread: false })).toBe('shared-checkout')
    expect(WorkspaceControlModel.landBlock({ ...ready, unlanded: [] })).toBe('nothing-to-land')
    expect(WorkspaceControlModel.landBlock({ ...ready, queued: true, canLand: false })).toBe('queued')
    expect(WorkspaceControlModel.landBlock({ ...ready, unlanded: [{ description: 'Fix', conflict: true }] })).toBe('conflicts')
    expect(WorkspaceControlModel.landBlock({ ...ready, unlanded: [{ description: ' ', conflict: false }] })).toBe('undescribed')
    expect(WorkspaceControlModel.landBlock({ ...ready, canLand: false })).toBe('busy')
  })
})

describe('where the header Land sits', () => {
  it('is beside the workspace chip on a desktop shell and in the phone top bar on a phone, never both', () => {
    expect(WorkspaceControlModel.landSeatShows({ seat: 'header', phone: false })).toBe(true)
    expect(WorkspaceControlModel.landSeatShows({ seat: 'phone-bar', phone: false })).toBe(false)
    // The phone folds the header control into the ⋯ sheet; the top bar's own seat carries the one Land.
    expect(WorkspaceControlModel.landSeatShows({ seat: 'header', phone: true })).toBe(false)
    expect(WorkspaceControlModel.landSeatShows({ seat: 'phone-bar', phone: true })).toBe(true)
  })

  it('is never drawn by a requested Land, which shows only the confirmation', () => {
    expect(WorkspaceControlModel.landSeatShows({ seat: 'request', phone: false })).toBe(false)
    expect(WorkspaceControlModel.landSeatShows({ seat: 'request', phone: true })).toBe(false)
  })
})

describe('the header Landed mark', () => {
  const unseen = WorkspaceControlModel.initialLandedMark('session-a')

  it('does not claim a land it did not see: the first read of an older land shows nothing', () => {
    const first = WorkspaceControlModel.landedMark(unseen, { sessionId: 'session-a', rebasedAt: 100, unlanded: 0 })
    expect(first.shown).toBe(false)
  })

  it('shows Landed once a land finishes while the header is on screen, and keeps it until the thread has work again', () => {
    const before = WorkspaceControlModel.landedMark(unseen, { sessionId: 'session-a', rebasedAt: 100, unlanded: 2 })
    const landed = WorkspaceControlModel.landedMark(before, { sessionId: 'session-a', rebasedAt: 200, unlanded: 0 })
    expect(landed.shown).toBe(true)
    expect(WorkspaceControlModel.landedMark(landed, { sessionId: 'session-a', rebasedAt: 200, unlanded: 0 }).shown).toBe(true)
    expect(WorkspaceControlModel.landedMark(landed, { sessionId: 'session-a', rebasedAt: 200, unlanded: 1 }).shown).toBe(false)
  })

  it('shows Landed at once for a land this header ran, and forgets it for another thread', () => {
    const landed = WorkspaceControlModel.landedMark(unseen, { sessionId: 'session-a', rebasedAt: undefined, unlanded: 0, landedHere: true })
    expect(landed.shown).toBe(true)
    expect(WorkspaceControlModel.landedMark(landed, { sessionId: 'session-b', rebasedAt: 300, unlanded: 0 }).shown).toBe(false)
  })
})

describe('a status read that saw the repository move', () => {
  const thread = { rebasedAt: 100, integrationQueuedAt: undefined }

  it('tells the other views when a land or a queue change happened since the last read', () => {
    expect(WorkspaceControlModel.repositoryMoved(thread, { ...thread, rebasedAt: 200 })).toBe(true)
    expect(WorkspaceControlModel.repositoryMoved(thread, { ...thread, integrationQueuedAt: 5 })).toBe(true)
    expect(WorkspaceControlModel.repositoryMoved(thread, thread)).toBe(false)
  })

  it('stays quiet on the first read, when there is nothing to compare', () => {
    expect(WorkspaceControlModel.repositoryMoved(undefined, thread)).toBe(false)
  })
})

describe('the workspace path label', () => {
  it('keeps the end of the path, where the workspace is named', () => {
    expect(WorkspaceControlModel.pathTail('/private/var/folders/3k/k0xz2zs57sq25lq8bfg2yg480000gn/T/home/projects/sample-threads/thread-31057e')).toBe(
      'sample-threads/thread-31057e',
    )
    expect(WorkspaceControlModel.pathTail('/Users/ada/dev/dshfiles/')).toBe('dev/dshfiles')
    expect(WorkspaceControlModel.pathTail('C:\\Users\\ada\\dev\\sample')).toBe('dev\\sample')
  })

  it('leaves a short path whole', () => {
    expect(WorkspaceControlModel.pathTail('/sample')).toBe('/sample')
    expect(WorkspaceControlModel.pathTail('sample/thread-1')).toBe('sample/thread-1')
  })
})
