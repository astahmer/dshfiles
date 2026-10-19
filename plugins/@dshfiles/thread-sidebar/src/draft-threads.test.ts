import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { DraftThreadsModel } from './draft-threads.js'

const session = (
  id: string,
  overrides: Partial<Pick<SessionSummary, 'title' | 'running' | 'blank'>> = {},
): Pick<SessionSummary, 'id' | 'title' | 'running' | 'blank'> => ({
  id: SessionId(id),
  running: false,
  blank: false,
  ...overrides,
})

describe('isDraftThread', () => {
  it('counts an untitled idle thread that is past the blank reuse state', () => {
    expect(DraftThreadsModel.isDraftThread(session('session-a'))).toBe(true)
    expect(DraftThreadsModel.isDraftThread(session('session-a', { title: '   ' }))).toBe(true)
  })

  it('never hides a titled, running or blank thread', () => {
    expect(DraftThreadsModel.isDraftThread(session('session-a', { title: 'Fix the composer' }))).toBe(false)
    expect(DraftThreadsModel.isDraftThread(session('session-a', { running: true }))).toBe(false)
    expect(DraftThreadsModel.isDraftThread(session('session-a', { blank: true }))).toBe(false)
  })
})

describe('draftThreadsOf', () => {
  it('keeps archived, pinned and open drafts where the user put them', () => {
    const drafts = DraftThreadsModel.draftThreadsOf({
      sessions: [session('session-a'), session('session-b'), session('session-c'), session('session-d'), session('session-e', { title: 'Named' })],
      exclusions: {
        archivedSessionIds: new Set(['session-b']),
        pinnedSessionIds: new Set(['session-c']),
        selectedSessionId: 'session-d',
      },
    })
    expect(drafts.map(draft => draft.id)).toEqual(['session-a'])
  })
})

describe('planDraftCleanup', () => {
  const workspaces = [
    { path: '/repo-threads/thread-5bb5a4', sessionIds: [SessionId('session-a')] },
    { path: '/repo-threads/thread-8ea708', sessionIds: [SessionId('session-b'), SessionId('session-real')] },
    { path: '/repo', sessionIds: [SessionId('session-c')] },
    { path: '/repo-threads/thread-fbd01a', sessionIds: [] },
  ]

  it('archives every draft and forgets only a thread workspace that holds nothing else', () => {
    const plan = DraftThreadsModel.planCleanup({
      drafts: [session('session-a'), session('session-b')],
      workspaces,
    })
    expect(plan.sessionIds).toEqual(['session-a', 'session-b'])
    expect(plan.workspacePaths).toEqual(['/repo-threads/thread-5bb5a4'])
  })

  it('keeps a project checkout, an empty workspace and a folder shared with a real thread', () => {
    const plan = DraftThreadsModel.planCleanup({ drafts: [session('session-a')], workspaces })
    expect(plan.workspacePaths).toEqual(['/repo-threads/thread-5bb5a4'])
    expect(DraftThreadsModel.planCleanup({ drafts: [], workspaces }).workspacePaths).toEqual([])
  })
})
