import { describe, expect, test } from 'vitest'
import { GithubMapping } from './sync-github.js'
import { LinearMapping } from './sync-linear.js'
import { BacklogSyncModel, type RemoteIssue, type SyncSnapshot } from './sync-model.js'

const remote = (fields: Partial<RemoteIssue> = {}): RemoteIssue => ({
  id: 'r1',
  key: 'ENG-1',
  url: 'https://linear.app/acme/issue/ENG-1',
  title: 'Title',
  body: 'Body',
  status: 'todo',
  tags: ['ui'],
  updatedAt: 100,
  comments: [],
  ...fields,
})

const snapshot = (fields: Partial<SyncSnapshot> = {}): SyncSnapshot => ({ title: 'Title', body: 'Body', status: 'todo', tags: ['ui'], ...fields })

const item = (
  fields: Partial<{ title: string; body: string; status: 'inbox' | 'todo' | 'doing' | 'done' | 'dropped'; tags: string[] }> = {},
  changedAt = 50,
) => ({
  title: 'Title',
  body: 'Body',
  status: 'todo' as const,
  tags: ['ui'],
  createdAt: 0,
  events: [{ at: changedAt, actor: 'user', kind: 'edited' as const, detail: '', fieldChanges: [{ field: 'title' as const, before: '', after: '' }] }],
  ...fields,
})

describe('sync conflict policy', () => {
  test('a field only one side changed flows to the other side', () => {
    const base = { local: snapshot(), remote: snapshot() }
    const plan = BacklogSyncModel.plan({ item: item({ title: 'Local' }), remote: remote({ body: 'Remote body' }), base, at: 1 })
    expect(plan).toEqual({ pull: { body: 'Remote body' }, push: { title: 'Local' }, conflicts: [] })
  })

  test('a field both sides changed goes to the side that changed last, with the other value kept as a conflict', () => {
    const base = { local: snapshot(), remote: snapshot() }
    const localNewer = BacklogSyncModel.plan({ item: item({ title: 'Local' }, 500), remote: remote({ title: 'Remote', updatedAt: 100 }), base, at: 1 })
    expect(localNewer.push).toEqual({ title: 'Local' })
    expect(localNewer.conflicts).toEqual([{ field: 'title', at: 1, kept: 'local', local: 'Local', remote: 'Remote' }])
    const remoteNewer = BacklogSyncModel.plan({ item: item({ title: 'Local' }, 50), remote: remote({ title: 'Remote', updatedAt: 100 }), base, at: 1 })
    expect(remoteNewer.pull).toEqual({ title: 'Remote' })
    expect(remoteNewer.conflicts[0]?.kept).toBe('remote')
  })

  test('both sides making the same change is no conflict', () => {
    const base = { local: snapshot(), remote: snapshot() }
    expect(BacklogSyncModel.plan({ item: item({ title: 'Same' }), remote: remote({ title: 'Same' }), base, at: 1 })).toEqual({
      pull: {},
      push: {},
      conflicts: [],
    })
  })

  test('a lossy remote status never reads as a change against its own base', () => {
    // GitHub reads every open issue as todo; an item in progress against an open issue is in sync.
    const base = { local: snapshot({ status: 'doing' }), remote: snapshot({ status: 'todo' }) }
    expect(BacklogSyncModel.plan({ item: item({ status: 'doing' }), remote: remote({ status: 'todo' }), base, at: 1 })).toEqual({
      pull: {},
      push: {},
      conflicts: [],
    })
  })

  test('the first sync adopts the issue and merges both sides’ tags', () => {
    const plan = BacklogSyncModel.plan({ item: item({ title: 'Local', tags: ['mine'] }), remote: remote({ tags: ['ui'] }), base: null, at: 1 })
    expect(plan.pull).toEqual({ title: 'Title', tags: ['mine', 'ui'] })
    expect(plan.push).toEqual({ tags: ['mine', 'ui'] })
  })
})

describe('remote mappings', () => {
  test('reads Linear workflow-state types and identifiers', () => {
    expect(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'other'].map(LinearMapping.statusOfType)).toEqual([
      'inbox',
      'todo',
      'todo',
      'doing',
      'done',
      'dropped',
      null,
    ])
    expect(LinearMapping.identifierOf('eng-12')).toBe('ENG-12')
    expect(LinearMapping.identifierOf('https://linear.app/acme/issue/ENG-12/some-title')).toBe('ENG-12')
    expect(LinearMapping.identifierOf('https://evil.example/issue/ENG-12')).toBeUndefined()
  })

  test('reads GitHub issue references only within the configured repository', () => {
    expect(GithubMapping.numberOf('acme/app', '42')).toBe(42)
    expect(GithubMapping.numberOf('acme/app', '#7')).toBe(7)
    expect(GithubMapping.numberOf('acme/app', 'acme/app#9')).toBe(9)
    expect(GithubMapping.numberOf('acme/app', 'https://github.com/acme/app/issues/3')).toBe(3)
    expect(GithubMapping.numberOf('acme/app', 'https://github.com/other/app/issues/3')).toBeUndefined()
    expect([GithubMapping.statusOf('open', null), GithubMapping.statusOf('closed', 'completed'), GithubMapping.statusOf('closed', 'not_planned')]).toEqual([
      'todo',
      'done',
      'dropped',
    ])
  })
})
