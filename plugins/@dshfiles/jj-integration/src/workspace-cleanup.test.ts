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

  it('includes recently integrated workspaces at zero age without bypassing safety checks', () => {
    const recent = idleThread({ rebasedAt: now - 5 * 60_000, usedAt: [now - 5 * 60_000] })
    const input = {
      thread: recent,
      archived: new Set<string>(),
      activity: new Map([['session-a', { running: false, pendingUserQuestion: false }]]),
      now,
      olderThanMs: 0,
      kinds: ['integrated'] as const,
    }
    expect(WorkspaceCleanupModel.decide({ ...input, olderThanMs: HOUR })).toMatchObject({ action: 'skip', reason: 'too-recent' })
    expect(WorkspaceCleanupModel.decide(input)).toMatchObject({ action: 'remove', kind: 'integrated' })
    expect(WorkspaceCleanupModel.decide({ ...input, thread: { ...recent, unlandedCount: 1 } })).toMatchObject({ action: 'skip', reason: 'has-work' })
    expect(WorkspaceCleanupModel.decide({ ...input, thread: { ...recent, integrationQueued: true } })).toMatchObject({ action: 'skip', reason: 'queued' })
    expect(WorkspaceCleanupModel.decide({ ...input, activity: new Map([['session-a', { running: true, pendingUserQuestion: false }]]) })).toMatchObject({
      action: 'skip',
      reason: 'busy',
    })
    expect(WorkspaceCleanupModel.decide({ ...input, activity: new Map([['session-a', { running: false, pendingUserQuestion: true }]]) })).toMatchObject({
      action: 'skip',
      reason: 'busy',
    })
    expect(WorkspaceCleanupModel.decide({ ...input, activity: undefined })).toMatchObject({ action: 'skip', reason: 'activity-unknown' })
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

  it('offers only clean, known, idle secondary workspaces when explicitly selected', () => {
    const secondary = idleThread({ name: 'projection-selector', secondary: true, workingCopyState: 'clean', sessionIds: [] })
    expect(
      WorkspaceCleanupModel.decide({ thread: secondary, archived: new Set(), activity: undefined, now, olderThanMs: 6 * HOUR, kinds: ['secondary'] }),
    ).toEqual({
      action: 'remove',
      kind: 'secondary',
      lastUsedAt: now - 10 * HOUR,
    })
    expect(
      WorkspaceCleanupModel.decide({
        thread: { ...secondary, workingCopyState: 'dirty' },
        archived: new Set(),
        activity: undefined,
        now,
        olderThanMs: 0,
        kinds: ['secondary'],
      }),
    ).toMatchObject({ action: 'skip', reason: 'working-copy-dirty' })
    expect(
      WorkspaceCleanupModel.decide({
        thread: { ...secondary, workingCopyState: 'unknown' },
        archived: new Set(),
        activity: undefined,
        now,
        olderThanMs: 0,
        kinds: ['secondary'],
      }),
    ).toMatchObject({ action: 'skip', reason: 'workspace-state-unknown' })
    expect(
      WorkspaceCleanupModel.decide({
        thread: { ...secondary, usedAt: [] },
        archived: new Set(),
        activity: undefined,
        now,
        olderThanMs: 0,
        kinds: ['secondary'],
      }),
    ).toMatchObject({ action: 'skip', reason: 'workspace-state-unknown' })
    expect(
      WorkspaceCleanupModel.decide({
        thread: { ...secondary, unlandedCount: 1 },
        archived: new Set(),
        activity: undefined,
        now,
        olderThanMs: 0,
        kinds: ['secondary'],
      }),
    ).toMatchObject({ action: 'skip', reason: 'has-work' })
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

  it('removes only explicitly selected secondary workspaces with a clean verified state', () => {
    const secondary = idleThread({
      name: 'projection-selector',
      sessionIds: [],
      secondary: true,
      workingCopyState: 'clean',
      usedAt: [now - 10 * HOUR],
    })
    expect(
      WorkspaceCleanupModel.decide({ thread: secondary, archived: new Set(), activity: undefined, now, olderThanMs: 6 * HOUR, kinds: ['secondary'] }),
    ).toEqual({
      action: 'remove',
      kind: 'secondary',
      lastUsedAt: now - 10 * HOUR,
    })
    expect(
      WorkspaceCleanupModel.decide({ thread: secondary, archived: new Set(), activity: undefined, now, olderThanMs: 6 * HOUR, kinds: ['empty'] }),
    ).toMatchObject({
      action: 'skip',
      reason: 'kind-excluded',
    })
  })

  it('allows explicitly selected missing secondary workspaces when their revisions and activity are verified', () => {
    const missing = idleThread({ secondary: true, missing: true, workingCopyState: 'missing', sessionIds: [] })

    expect(
      WorkspaceCleanupModel.decide({ thread: missing, archived: new Set(), activity: new Map(), now, olderThanMs: 6 * HOUR, kinds: ['secondary'] }),
    ).toMatchObject({ action: 'remove', kind: 'secondary' })
    expect(
      WorkspaceCleanupModel.decide({
        thread: { ...missing, unlandedCount: 1 },
        archived: new Set(),
        activity: new Map(),
        now,
        olderThanMs: 6 * HOUR,
        kinds: ['secondary'],
      }),
    ).toMatchObject({ action: 'skip', reason: 'has-work' })
  })

  it('keeps dirty, unknown, or undated secondary workspaces', () => {
    expect(decide(idleThread({ secondary: true, workingCopyState: 'dirty' }))).toMatchObject({ action: 'skip', reason: 'working-copy-dirty' })
    expect(decide(idleThread({ secondary: true, workingCopyState: 'unknown' }))).toMatchObject({ action: 'skip', reason: 'workspace-state-unknown' })
    expect(decide(idleThread({ secondary: true, workingCopyState: 'clean', usedAt: [undefined] }))).toMatchObject({
      action: 'skip',
      reason: 'workspace-state-unknown',
    })
  })

  it('treats an untracked entry as stale only past the threshold and never younger than an hour', () => {
    const kinds = ['untracked'] as const
    expect(WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: now - 2 * HOUR, now, olderThanMs: HOUR, kinds })).toBe(true)
    expect(WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: now - 2 * HOUR, now, olderThanMs: 6 * HOUR, kinds })).toBe(false)
    expect(WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: now - 30 * 60_000, now, olderThanMs: 0, kinds })).toBe(false)
    expect(WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: 0, now, olderThanMs: 0, kinds: ['empty'] })).toBe(false)
  })
})
