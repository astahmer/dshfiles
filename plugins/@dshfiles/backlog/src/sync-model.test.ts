import { describe, expect, test } from 'vitest'
import { FilesMapping } from './provider-files.js'
import { GithubMapping } from './provider-github.js'
import { LinearMapping } from './provider-linear.js'
import type { ProviderCapabilities } from './provider-port.js'
import { BacklogSyncModel, type SyncConflictPolicy, type SyncSnapshot } from './sync-model.js'

const snapshot = (fields: Partial<SyncSnapshot> = {}): SyncSnapshot => ({ title: 'Title', body: 'Body', status: 'todo', tags: ['ui'], ...fields })

const history = (changedAt = 50) => ({
  createdAt: 0,
  events: [{ at: changedAt, actor: 'user', kind: 'edited' as const, detail: '', fieldChanges: [{ field: 'title' as const, before: '', after: '' }] }],
})

const everyField = BacklogSyncModel.fieldFlows({
  binding: { direction: 'two-way', fieldMap: BacklogSyncModel.defaultFieldMap() },
  capabilities: LinearMapping.descriptor.capabilities,
})

const plan = (input: {
  readonly local?: Partial<SyncSnapshot>
  readonly remote?: Partial<SyncSnapshot>
  readonly base?: { readonly local: SyncSnapshot; readonly remote: SyncSnapshot } | null
  readonly changedAt?: number
  readonly equivalents?: readonly ('inbox' | 'todo' | 'doing' | 'done' | 'dropped')[]
  readonly policy?: SyncConflictPolicy
  readonly flows?: ReturnType<typeof BacklogSyncModel.fieldFlows>
}) =>
  BacklogSyncModel.plan({
    item: history(input.changedAt),
    local: snapshot(input.local),
    remote: snapshot(input.remote),
    remoteStatusEquivalents: input.equivalents ?? [],
    remoteUpdatedAt: 100,
    base: input.base === undefined ? { local: snapshot(), remote: snapshot() } : input.base,
    flows: input.flows ?? everyField,
    policy: input.policy ?? 'lww',
    at: 1,
  })

describe('sync conflict policy', () => {
  test('a field only one side changed flows to the other side', () => {
    expect(plan({ local: { title: 'Local' }, remote: { body: 'Remote body' } })).toEqual({
      pull: { body: 'Remote body' },
      push: { title: 'Local' },
      conflicts: [],
      flagged: [],
    })
  })

  test('last writer wins keeps the side that changed last, with the other value kept as a conflict', () => {
    const localNewer = plan({ local: { title: 'Local' }, remote: { title: 'Remote' }, changedAt: 500 })
    expect(localNewer.push).toEqual({ title: 'Local' })
    expect(localNewer.conflicts).toEqual([{ field: 'title', at: 1, kept: 'local', local: 'Local', remote: 'Remote' }])
    const remoteNewer = plan({ local: { title: 'Local' }, remote: { title: 'Remote' }, changedAt: 50 })
    expect(remoteNewer.pull).toEqual({ title: 'Remote' })
    expect(remoteNewer.conflicts[0]?.kept).toBe('remote')
  })

  test.each([
    ['local-wins', { push: { title: 'Local' }, pull: {}, kept: 'local' }],
    ['remote-wins', { push: {}, pull: { title: 'Remote' }, kept: 'remote' }],
    ['flag', { push: {}, pull: {}, kept: 'none' }],
  ] as const)('%s settles a two-sided change its own way', (policy, expected) => {
    const result = plan({ local: { title: 'Local' }, remote: { title: 'Remote' }, policy, changedAt: 500 })
    expect({ push: result.push, pull: result.pull, kept: result.conflicts[0]?.kept }).toEqual(expected)
    expect(result.flagged).toEqual(policy === 'flag' ? ['title'] : [])
  })

  test('both sides making the same change is no conflict', () => {
    expect(plan({ local: { title: 'Same' }, remote: { title: 'Same' } })).toEqual({ pull: {}, push: {}, conflicts: [], flagged: [] })
  })

  test('a lossy remote status never reads as a change against its own base', () => {
    const base = { local: snapshot({ status: 'doing' }), remote: snapshot({ status: 'todo' }) }
    expect(plan({ base, local: { status: 'doing' }, remote: { status: 'todo' }, equivalents: ['inbox', 'todo', 'doing'] })).toEqual({
      pull: {},
      push: {},
      conflicts: [],
      flagged: [],
    })
  })

  test('linking keeps a local status the remote status stands for: doing survives GitHub open', () => {
    const linked = plan({ base: null, local: { status: 'doing' }, remote: { status: 'todo' }, equivalents: GithubMapping.statusOf('open', null).equivalents })
    expect(linked.pull).toEqual({})
    const closed = plan({
      base: null,
      local: { status: 'doing' },
      remote: { status: 'done' },
      equivalents: GithubMapping.statusOf('closed', 'completed').equivalents,
    })
    expect(closed.pull).toEqual({ status: 'done' })
  })

  test('the first sync adopts the remote side and merges both sides’ tags', () => {
    const result = plan({ base: null, local: { title: 'Local', tags: ['mine'] }, remote: { tags: ['ui'] } })
    expect(result.pull).toEqual({ title: 'Title', tags: ['mine', 'ui'] })
    expect(result.push).toEqual({ tags: ['mine', 'ui'] })
  })

  test('a field missing from an older base is adopted like a first sync, not read as a local change', () => {
    const result = plan({ local: { priority: 'none', parent: null, links: [] }, remote: { priority: 'high', parent: 'issue-9', links: ['blocks:issue-3'] } })
    expect(result.pull).toEqual({ priority: 'high', parent: 'issue-9', links: ['blocks:issue-3'] })
    expect(result.push).toEqual({})
  })
})

describe('field flows', () => {
  const readOnly: ProviderCapabilities = { ...LinearMapping.descriptor.capabilities, write: false }

  test('a read-only provider never pushes, and a pull binding never pushes', () => {
    const readOnlyFlows = BacklogSyncModel.fieldFlows({
      binding: { direction: 'two-way', fieldMap: BacklogSyncModel.defaultFieldMap() },
      capabilities: readOnly,
    })
    expect(plan({ local: { title: 'Local' }, flows: readOnlyFlows }).push).toEqual({})
    const pullOnly = BacklogSyncModel.fieldFlows({
      binding: { direction: 'pull', fieldMap: BacklogSyncModel.defaultFieldMap() },
      capabilities: LinearMapping.descriptor.capabilities,
    })
    expect([...pullOnly.values()].every(flow => !flow.push)).toBe(true)
  })

  test('a field the provider cannot carry, or the field map leaves out, never flows', () => {
    const github = BacklogSyncModel.fieldFlows({
      binding: { direction: 'two-way', fieldMap: BacklogSyncModel.defaultFieldMap() },
      capabilities: GithubMapping.descriptor.capabilities,
    })
    expect(github.get('priority')).toEqual({ pull: false, push: false })
    const titleOnly = BacklogSyncModel.fieldFlows({
      binding: { direction: 'two-way', fieldMap: [{ field: 'title', direction: 'push', values: [] }] },
      capabilities: FilesMapping.descriptor.capabilities,
    })
    expect(titleOnly.get('title')).toEqual({ pull: false, push: true })
    expect(titleOnly.get('body')).toEqual({ pull: false, push: false })
  })

  test('a status value map reads a remote state name as the local status it maps to', () => {
    const record = LinearMapping.toCanonical({
      id: 'a',
      identifier: 'ENG-1',
      url: 'u',
      title: 't',
      description: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      state: { type: 'started', name: 'In Review' },
      labels: { nodes: [] },
    })
    const remote = BacklogSyncModel.remoteSnapshot({
      record,
      rules: [{ field: 'status', direction: 'two-way', values: [{ local: 'done', remote: 'in review' }] }],
    })
    expect(remote.status).toBe('done')
  })
})

describe('provider mappings', () => {
  test('reads Linear workflow-state types, priorities and identifiers', () => {
    expect(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'other'].map(LinearMapping.statusOfType)).toEqual([
      'inbox',
      'todo',
      'todo',
      'doing',
      'done',
      'dropped',
      null,
    ])
    expect([0, 1, 2, 3, 4].map(LinearMapping.priorityOf)).toEqual(['none', 'urgent', 'high', 'medium', 'low'])
    expect(LinearMapping.identifierOf('eng-12')).toBe('ENG-12')
    expect(LinearMapping.identifierOf('https://linear.app/acme/issue/ENG-12/some-title')).toBe('ENG-12')
    expect(LinearMapping.identifierOf('https://evil.example/issue/ENG-12')).toBeUndefined()
  })

  test('reads Linear relations from the issue’s own side', () => {
    const relations = LinearMapping.relationsOf({
      id: 'a',
      identifier: 'ENG-1',
      url: 'u',
      title: 't',
      description: null,
      updatedAt: '',
      state: null,
      labels: { nodes: [] },
      relations: {
        nodes: [
          { id: 'r1', type: 'blocks', relatedIssue: { id: 'b' } },
          { id: 'r2', type: 'duplicate', relatedIssue: { id: 'c' } },
        ],
      },
      inverseRelations: { nodes: [{ id: 'r3', type: 'blocks', issue: { id: 'd' } }] },
    })
    expect(relations).toEqual([
      { relation: 'blocks', key: 'b' },
      { relation: 'duplicates', key: 'c' },
      { relation: 'depends-on', key: 'd' },
    ])
  })

  test('reads GitHub issue references only within the configured repository, and keys name the repository', () => {
    expect(GithubMapping.numberOf('acme/app', '42')).toBe(42)
    expect(GithubMapping.numberOf('acme/app', '#7')).toBe(7)
    expect(GithubMapping.numberOf('acme/app', 'acme/app#9')).toBe(9)
    expect(GithubMapping.numberOf('acme/app', 'https://github.com/acme/app/issues/3')).toBe(3)
    expect(GithubMapping.numberOf('acme/app', 'https://github.com/other/app/issues/3')).toBeUndefined()
    expect(GithubMapping.parseKey(GithubMapping.keyOf('acme/app', 3))).toEqual({ repository: 'acme/app', number: 3 })
    expect(
      [GithubMapping.statusOf('open', null), GithubMapping.statusOf('closed', 'completed'), GithubMapping.statusOf('closed', 'not_planned')].map(
        status => status.category,
      ),
    ).toEqual(['todo', 'done', 'dropped'])
  })
})
