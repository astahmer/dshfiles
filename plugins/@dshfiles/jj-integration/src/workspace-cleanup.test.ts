import { describe, expect, it } from 'vitest'
import { WorkspaceCleanupModel, type CleanupThread } from './workspace-cleanup.js'

const HOUR = 60 * 60_000
const now = 100 * HOUR

const idleThread = (overrides: Partial<CleanupThread> = {}): CleanupThread => ({
  name: 'thread-aaaaaa',
  unlandedCount: 0,
  rebasedAt: undefined,
  sessionIds: ['session-a'],
  integrationQueued: false,
  usedAt: [now - 10 * HOUR],
  ...overrides,
})

const decide = (thread: CleanupThread, options: { readonly archived?: readonly string[]; readonly running?: boolean | undefined } = {}) =>
  WorkspaceCleanupModel.decide({
    thread,
    archived: new Set(options.archived ?? []),
    activity: new Map([['session-a', { running: 'running' in options ? options.running : false, pendingUserQuestion: false }]]),
    now,
    olderThanMs: 6 * HOUR,
    kinds: ['empty', 'integrated'],
  })

describe('WorkspaceCleanupModel.isFinishedWorkspaceReadyToRemove', () => {
  const graceMs = 15 * 60_000

  it('removes only finished, landed workspaces after the grace period since rebase', () => {
    const rebasedAt = now - graceMs
    expect(WorkspaceCleanupModel.isFinishedWorkspaceReadyToRemove({ finished: true, unlandedCount: 0, rebasedAt, now, graceMs })).toBe(true)
    expect(WorkspaceCleanupModel.isFinishedWorkspaceReadyToRemove({ finished: true, unlandedCount: 1, rebasedAt, now, graceMs })).toBe(false)
    expect(WorkspaceCleanupModel.isFinishedWorkspaceReadyToRemove({ finished: false, unlandedCount: 0, rebasedAt, now, graceMs })).toBe(false)
    expect(WorkspaceCleanupModel.isFinishedWorkspaceReadyToRemove({ finished: true, unlandedCount: 0, rebasedAt: undefined, now, graceMs })).toBe(false)
    expect(WorkspaceCleanupModel.isFinishedWorkspaceReadyToRemove({ finished: true, unlandedCount: 0, rebasedAt: now - graceMs + 1, now, graceMs })).toBe(false)
  })
})

describe('WorkspaceCleanupModel.decide', () => {
  it('removes an idle empty workspace unused for longer than the threshold', () => {
    expect(decide(idleThread())).toEqual({ action: 'remove', kind: 'empty', lastUsedAt: now - 10 * HOUR })
  })

  it('classifies a workspace that landed as integrated and dates it by its latest use', () => {
    expect(decide(idleThread({ rebasedAt: now - 7 * HOUR, usedAt: [now - 10 * HOUR, now - 7 * HOUR, undefined] }))).toEqual({
      action: 'remove',
      kind: 'integrated',
      lastUsedAt: now - 7 * HOUR,
    })
  })

  it('keeps unlanded work whatever its age', () => {
    expect(decide(idleThread({ unlandedCount: 1, usedAt: [0] }))).toMatchObject({ action: 'skip', reason: 'has-work' })
  })

  it('keeps a workspace whose live Session is working or unreadable', () => {
    expect(decide(idleThread(), { running: true })).toMatchObject({ action: 'skip', reason: 'busy' })
    expect(decide(idleThread(), { running: undefined })).toMatchObject({ action: 'skip', reason: 'activity-unknown' })
  })

  it('ignores the activity of archived Sessions', () => {
    expect(decide(idleThread(), { archived: ['session-a'], running: undefined })).toMatchObject({ action: 'remove' })
  })

  it('keeps a recently used, queued or unselected workspace', () => {
    expect(decide(idleThread({ usedAt: [now - HOUR] }))).toMatchObject({ action: 'skip', reason: 'too-recent' })
    expect(decide(idleThread({ integrationQueued: true }))).toMatchObject({ action: 'skip', reason: 'queued' })
    expect(
      WorkspaceCleanupModel.decide({ thread: idleThread(), archived: new Set(), activity: new Map(), now, olderThanMs: 0, kinds: ['integrated'] }),
    ).toMatchObject({ action: 'skip', reason: 'activity-unknown' })
    expect(
      WorkspaceCleanupModel.decide({
        thread: idleThread({ sessionIds: [] }),
        archived: new Set(),
        activity: undefined,
        now,
        olderThanMs: 0,
        kinds: ['integrated'],
      }),
    ).toMatchObject({ action: 'skip', reason: 'kind-excluded' })
  })

  it('treats an untracked entry as stale only past the threshold and never younger than an hour', () => {
    const kinds = ['untracked'] as const
    expect(WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: now - 2 * HOUR, now, olderThanMs: HOUR, kinds })).toBe(true)
    expect(WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: now - 2 * HOUR, now, olderThanMs: 6 * HOUR, kinds })).toBe(false)
    expect(WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: now - 30 * 60_000, now, olderThanMs: 0, kinds })).toBe(false)
    expect(WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: 0, now, olderThanMs: 0, kinds: ['empty'] })).toBe(false)
  })
})
