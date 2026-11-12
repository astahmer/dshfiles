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
  workspaceTitle: 'repo · thread-abc123',
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
  it('states an idle described thread as one Ready item named by its thread, with what landing brings', () => {
    const facts = new Map([['/repo-threads/thread-abc123', { threadTitle: 'Add login page', stat: { files: 3, added: 120, removed: 14 } }]])
    expect(LandAttention.draftsOf(repositories(thread()), new Map(), facts)).toEqual({
      blocked: [],
      ready: [
        {
          dedupeKey: '/repo-threads/thread-abc123:ready',
          subject: { kind: 'session', id: 'session-b' },
          reason: '“Add login page” is ready to land.',
          detail: '3 files, +120 −14 · feat: add a thing',
          severity: 'ready',
          verbs: ['Land', 'Open', 'Done', 'Snooze', 'MuteSource'],
        },
      ],
      resolve: [],
    })
  })

  it('names the oldest revision and counts the rest, and falls back to an untitled thread of its project without a thread title or stat', () => {
    const several = thread({
      unlanded: [revision({ description: 'fix: follow-up' }), revision({ description: 'docs: note' }), revision({ description: 'feat: first\n\nbody' })],
    })
    expect(LandAttention.readyDraftOf(several, { stat: { files: 1, added: 2, removed: 0 } }).detail).toBe('1 file, +2 −0 · feat: first · 2 more revisions')
    expect(LandAttention.readyDraftOf(several)).toMatchObject({ reason: '“Untitled thread in repo” is ready to land.', detail: '3 revisions · feat: first' })
  })

  it('reads the summary line of jj diff --stat', () => {
    expect(LandAttention.parseDiffStat('a.ts | 3 ++-\nb.ts | 1 -\n2 files changed, 2 insertions(+), 2 deletions(-)\n')).toEqual({
      files: 2,
      added: 2,
      removed: 2,
    })
    expect(LandAttention.parseDiffStat('1 file changed, 4 insertions(+)')).toEqual({ files: 1, added: 4, removed: 0 })
    expect(LandAttention.parseDiffStat('0 files changed, 0 insertions(+), 0 deletions(-)')).toEqual({ files: 0, added: 0, removed: 0 })
    expect(LandAttention.parseDiffStat('Error: no such revision')).toBeUndefined()
  })

  it('keeps a ready item while its thread is busy, asking, describing or queued, and resolves it only when nothing is left to land', () => {
    expect(LandAttention.readyFateOf(thread())).toBe('publish')
    // Busy, unverified, queued and undescribed work keeps the item as it is: no resolve, so no new occurrence later.
    expect(LandAttention.readyFateOf(thread({ canRebase: false }))).toBe('keep')
    expect(LandAttention.readyFateOf(thread({ canRebase: undefined }))).toBe('keep')
    expect(LandAttention.readyFateOf(thread({ integrationQueuedAt: 5 }))).toBe('keep')
    expect(LandAttention.readyFateOf(thread({ unlanded: [revision({ description: 'wip' })] }))).toBe('keep')
    expect(LandAttention.readyFateOf(thread({ unlanded: [] }))).toBe('resolve')
    expect(LandAttention.readyFateOf(thread({ missing: true }))).toBe('resolve')
    expect(LandAttention.readyFateOf(thread({ unlanded: [revision({ conflict: true })] }))).toBe('resolve')
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
    // The conflicted, landed and gone workspaces resolve their ready item; busy, unknown, queued and wip keep theirs.
    expect(drafts.resolve).toEqual(['/repo-threads/thread-abc123:ready', '/landed:ready', '/gone:ready'])
    expect(drafts.blocked).toEqual([
      expect.objectContaining({
        dedupeKey: '/repo-threads/thread-abc123:conflict',
        severity: 'failed',
        reason: '“Untitled thread in repo” has 1 conflicted revision; Land is blocked.',
        verbs: ['Retry', 'Open', 'Done', 'Snooze', 'MuteSource'],
      }),
    ])
  })

  it('states a stopped queued land as Failed until the workspace has nothing left to land', () => {
    const failure = { path: '/repo-threads/thread-abc123', message: 'jj failed: lock held.', at: 1 }
    const failures = new Map([[failure.path, failure]])
    expect(LandAttention.draftsOf(repositories(thread()), failures).blocked).toEqual([
      expect.objectContaining({
        dedupeKey: '/repo-threads/thread-abc123:queued-land',
        severity: 'failed',
        detail: 'jj failed: lock held. Fix the cause, then Retry.',
      }),
    ])
    expect(LandAttention.draftsOf(repositories(thread()), failures).ready).toEqual([])
    expect(LandAttention.draftsOf(repositories(thread({ unlanded: [] })), failures)).toEqual({
      blocked: [],
      ready: [],
      resolve: ['/repo-threads/thread-abc123:ready'],
    })
  })

  it('names a workspace nobody opened as an untitled thread of its project, never by its folder (b:212a)', () => {
    expect(LandAttention.draftsOf(repositories(thread({ sessionIds: [] })), new Map()).ready[0]?.subject).toEqual({
      kind: 'workspace',
      id: '/repo-threads/thread-abc123',
      label: 'Untitled thread in repo',
    })
    // The thread title wins when its Session has one, for Failed items too.
    const conflicted = thread({ unlanded: [revision({ conflict: true })] })
    const facts = new Map([['/repo-threads/thread-abc123', { threadTitle: 'Fix login' }]])
    expect(LandAttention.draftsOf(repositories(conflicted), new Map(), facts).blocked[0]?.reason).toBe(
      '“Fix login” has 1 conflicted revision; Land is blocked.',
    )
  })
})
