import { describe, expect, it } from 'vitest'
import type { RepositoryView, ThreadView } from './api.js'
import { LandAttention } from './attention-provider.js'

const revision = (overrides: Partial<ThreadView['unlanded'][number]> = {}): ThreadView['unlanded'][number] => ({
  changeId: 'qpvuntsmwlqtpsluzzsnyyzlmlwvmlnu',
  commitId: 'a'.repeat(40),
  description: 'feat: add a thing',
  conflict: false,
  ...overrides,
})

const thread = (overrides: Partial<ThreadView> = {}): ThreadView => ({
  name: 'thread-abc123',
  path: '/repo-threads/thread-abc123',
  workspaceId: 'ws-1',
  workspaceTitle: 'Fix login',
  sessionIds: ['session-a', 'session-b'],
  finished: false,
  canRebase: true,
  missing: false,
  behind: false,
  unlanded: [revision()],
  ...overrides,
})

const repositories = (...threads: ThreadView[]): RepositoryView[] => [{ repoRoot: '/repo', title: 'repo', workspaceId: 'p', bookmarks: ['main'], threads }]

describe('jj-integration inbox drafts', () => {
  it('states an idle described thread as Ready with Land, about its newest conversation', () => {
    expect(LandAttention.draftsOf(repositories(thread()), new Map())).toEqual({
      blocked: [],
      ready: [
        {
          dedupeKey: '/repo-threads/thread-abc123:ready',
          subject: { kind: 'session', id: 'session-b' },
          reason: '“Fix login” is ready to land: 1 described revision not on the bookmark yet.',
          severity: 'ready',
          verbs: ['Land', 'Open', 'Done', 'Snooze', 'MuteSource'],
        },
      ],
    })
  })

  it('states conflicts as Failed with Retry even while the thread works, and nothing for busy, queued or undescribed work', () => {
    const conflicted = thread({ canRebase: false, unlanded: [revision({ conflict: true })] })
    const drafts = LandAttention.draftsOf(
      repositories(
        conflicted,
        thread({ path: '/busy', canRebase: false }),
        thread({ path: '/unknown', canRebase: undefined }),
        thread({ path: '/queued', integrationQueuedAt: 5 }),
        thread({ path: '/wip', unlanded: [revision({ description: 'wip' })] }),
        thread({ path: '/landed', unlanded: [] }),
        thread({ path: '/gone', missing: true, unlanded: [revision({ conflict: true })] }),
      ),
      new Map(),
    )
    expect(drafts.ready).toEqual([])
    expect(drafts.blocked).toEqual([
      expect.objectContaining({
        dedupeKey: '/repo-threads/thread-abc123:conflict',
        severity: 'failed',
        reason: '“Fix login” has 1 conflicted revision; Land is blocked.',
        verbs: ['Retry', 'Open', 'Done', 'Snooze', 'MuteSource'],
      }),
    ])
  })

  it('states a stopped queued land as Failed until the workspace has nothing left to land', () => {
    const failure = { path: '/repo-threads/thread-abc123', message: 'jj failed: lock held.', at: 1 }
    const failures = new Map([[failure.path, failure]])
    expect(LandAttention.draftsOf(repositories(thread()), failures).blocked).toEqual([
      expect.objectContaining({ dedupeKey: '/repo-threads/thread-abc123:queued-land', severity: 'failed', detail: 'jj failed: lock held. Fix the cause, then Retry.' }),
    ])
    expect(LandAttention.draftsOf(repositories(thread({ unlanded: [] })), failures)).toEqual({ blocked: [], ready: [] })
  })

  it('names a workspace nobody opened by its title', () => {
    expect(LandAttention.draftsOf(repositories(thread({ sessionIds: [] })), new Map()).ready[0]?.subject).toEqual({
      kind: 'workspace',
      id: '/repo-threads/thread-abc123',
      label: 'Fix login',
    })
  })
})
