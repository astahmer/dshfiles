import { describe, expect, it } from 'vitest'
import type { ThreadView } from './api.js'
import { threadIntegrationBlockReason, threadIntegrationState } from './thread-integration-state.js'

const createThread = (overrides: Partial<ThreadView> = {}): ThreadView => ({
  name: 'thread-abcdef',
  path: '/repo-threads/thread-abcdef',
  workspaceId: 'workspace-id',
  sessionIds: [],
  finished: false,
  canRebase: true,
  missing: false,
  behind: false,
  unlanded: [{ changeId: 'change-id', commitId: 'commit-id', description: 'feat: add feature', conflict: false }],
  ...overrides,
})

describe('thread integration state', () => {
  it('only marks described, conflict-free unlanded work ready when Host eligibility allows it', () => {
    expect(threadIntegrationState(createThread())).toBe('ready')
    expect(threadIntegrationState(createThread({ canRebase: false }))).toBe('waiting')
    expect(threadIntegrationState(createThread({ canRebase: undefined }))).toBe('waiting')
    expect(threadIntegrationState(createThread({ missing: true }))).toBe('waiting')
    expect(threadIntegrationState(createThread({ unlanded: [{ changeId: 'change-id', commitId: 'commit-id', description: 'WIP', conflict: false }] }))).toBe(
      'waiting',
    )
  })

  it('prioritizes conflicts over eligibility and excludes already integrated work', () => {
    expect(
      threadIntegrationState(
        createThread({ canRebase: false, missing: true, unlanded: [{ changeId: 'change-id', commitId: 'commit-id', description: 'edit', conflict: true }] }),
      ),
    ).toBe('conflicts')
    expect(threadIntegrationState(createThread({ unlanded: [], rebasedAt: Date.now() }))).toBe('up-to-date')
  })

  it('does not treat being behind the bookmark as readiness to integrate', () => {
    const thread = createThread({ unlanded: [], behind: true, rebasedAt: Date.now() })
    expect(threadIntegrationState(thread)).toBe('waiting')
    expect(
      threadIntegrationBlockReason({ thread, sessionRunning: false, sessionWaitingForInput: false, sessionActivityUnknown: false, state: 'waiting' }),
    ).toBe('behind')
  })

  it('explains each integration blocker with the highest-priority reason', () => {
    const conflicted = createThread({ unlanded: [{ changeId: 'change-id', commitId: 'commit-id', description: 'edit', conflict: true }] })
    expect(
      threadIntegrationBlockReason({
        thread: conflicted,
        sessionRunning: true,
        sessionWaitingForInput: false,
        sessionActivityUnknown: false,
        state: 'conflicts',
      }),
    ).toBe('conflicts')
    expect(
      threadIntegrationBlockReason({
        thread: createThread(),
        sessionRunning: true,
        sessionWaitingForInput: false,
        sessionActivityUnknown: false,
        state: 'waiting',
      }),
    ).toBe('active')
    expect(
      threadIntegrationBlockReason({
        thread: createThread(),
        sessionRunning: false,
        sessionWaitingForInput: true,
        sessionActivityUnknown: false,
        state: 'waiting',
      }),
    ).toBe('question')
  })
})
