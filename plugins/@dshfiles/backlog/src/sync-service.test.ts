import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, beforeEach, describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogStore } from './store.js'
import { fakeGithub, fakeLinear } from './sync-fakes.js'
import { BacklogSync } from './sync-service.js'
import { BacklogSyncModel } from './sync-model.js'
import { SyncSources } from './sync-sources.js'
import { legacyGithubRow, legacyLinearRow, syncTestLayer } from './sync-test-support.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const user = { kind: 'user' } as const

beforeEach(() => {
  for (const name of ['LINEAR_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN']) vi.stubEnv(name, '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('BacklogSync with Linear', () => {
  it.effect('creates a Linear issue from an item, maps status, labels and priority, and records its spans', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'bug: sync drops labels #ui #local-only !2', status: 'doing', actor: user })

      const linked = yield* sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user })

      const issue = linear.find('ENG-1')
      expect(issue?.title).toBe('sync drops labels')
      expect(linear.typeOfIssue('ENG-1')).toBe('started')
      expect(issue?.priority).toBe(2)
      expect(issue?.labelIds.sort()).toEqual(['l-bug', 'l-ui'])
      expect(linked.item).toMatchObject({
        remoteKey: 'ENG-1',
        bindingId: 'linear-eng',
        backend: 'linear',
        state: 'synced',
        url: 'https://linear.app/acme/issue/ENG-1/slug',
      })
      const item = yield* store.get(created.item.id)
      expect(item.ok && item.value.item.links.some(link => link.type === 'url' && link.target === 'https://linear.app/acme/issue/ENG-1/slug')).toBe(true)
      expect(linear.state.requests.every(request => request.authorization === 'lin_test_key')).toBe(true)
      expect(recorder.span('linear request').attributes['dshx.backlog.sync.provider']).toBe('linear')
      expect(recorder.span('backlog sync item').attributes['dshx.backlog.item_id']).toBe(created.item.id)
      expect(recorder.span('backlog sync item').attributes['dshx.backlog.sync.outcome']).toBe('synced')
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer), Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('links an existing issue, then syncs title, status and new comments both ways without echoes', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const issue = linear.seed({ title: 'Remote title', description: 'Remote body', type: 'unstarted', labels: ['sync'] })
      const created = yield* store.capture({ text: 'Local title #mine', actor: user })

      yield* sync.link({ id: created.item.id, provider: 'linear', reference: 'https://linear.app/acme/issue/ENG-1/remote-title', actor: user })
      const adopted = yield* store.get(created.item.id)
      expect(adopted.ok && adopted.value.item).toMatchObject({ title: 'Remote title', body: 'Remote body', status: 'todo' })
      expect(adopted.ok && [...adopted.value.item.tags].sort()).toEqual(['mine', 'sync'])

      yield* TestClock.adjust('1 minute')
      yield* store.update({ id: created.item.id, title: 'Renamed here', actor: user })
      yield* store.comment({ id: created.item.id, text: 'Local progress note', actor: user })
      linear.state.now = 200_000
      linear.setType(issue, 'completed')
      linear.remoteComment(issue, 'Shipped in v2')

      const pass = yield* sync.syncNow({ id: created.item.id })

      expect(pass.results[0]).toMatchObject({ state: 'synced', pulled: ['status'], pushed: ['title'], commentsPulled: 1, commentsPushed: 1 })
      expect(linear.find('ENG-1')?.title).toBe('Renamed here')
      expect(linear.find('ENG-1')?.comments.map(comment => comment.body)).toEqual(['Shipped in v2', expect.stringContaining('Local progress note')])
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.status).toBe('done')
      const comments = after.ok ? after.value.item.events.filter(event => event.kind === 'commented') : []
      expect(comments.map(event => event.detail)).toEqual(['Local progress note', 'Linear · Ada: Shipped in v2'])
      expect(comments[1]?.origin).toBe('remote:linear-eng')
      const moved = after.ok ? after.value.item.events.find(event => event.kind === 'moved') : undefined
      expect(moved?.origin).toBe('remote:linear-eng')

      const again = yield* sync.syncNow({ id: created.item.id })
      expect(again.results[0]).toMatchObject({ state: 'synced', pulled: [], pushed: [], commentsPulled: 0, commentsPushed: 0 })
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('keeps agent comments off the issue unless the binding pushes them, and always posts the user comments', () => {
    const agent = { kind: 'agent', sessionId: 'session-agent1' } as const
    const pushedBodies = (pushAgentComments: boolean) => {
      const linear = fakeLinear()
      return Effect.gen(function* () {
        const store = yield* BacklogStore
        const sync = yield* BacklogSync
        yield* sync.saveBinding({ binding: { id: 'linear-eng', pushAgentComments } })
        linear.seed({ title: 'Remote title', description: '', type: 'unstarted', labels: [] })
        const created = yield* store.capture({ text: 'Local title', actor: user })
        yield* sync.link({ id: created.item.id, provider: 'linear', reference: 'ENG-1', actor: user })
        yield* TestClock.adjust('1 minute')
        yield* store.comment({ id: created.item.id, text: 'Agent progress note', actor: agent })
        yield* store.comment({ id: created.item.id, text: 'User decision', actor: user })
        const pass = yield* sync.syncNow({ id: created.item.id })
        return { pushed: pass.results[0]?.commentsPushed, bodies: linear.find('ENG-1')?.comments.map(comment => comment.body) ?? [] }
      }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
    }
    return Effect.gen(function* () {
      const byDefault = yield* pushedBodies(false)
      expect(byDefault.pushed).toBe(1)
      expect(byDefault.bodies).toEqual([expect.stringContaining('User decision')])
      const pushing = yield* pushedBodies(true)
      expect(pushing.pushed).toBe(2)
    })
  })

  it.effect('settles a field both sides changed by last writer wins and leaves a conflict note', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'Original', actor: user })
      yield* sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user })

      yield* TestClock.adjust('1 minute')
      yield* store.update({ id: created.item.id, title: 'Local edit', actor: user })
      const issue = linear.find('ENG-1')
      if (issue === undefined) throw new Error('issue missing')
      issue.title = 'Remote edit'
      issue.updatedAt = 120_000

      const pass = yield* sync.syncNow({ id: created.item.id })

      expect(pass.results[0]).toMatchObject({
        state: 'conflict',
        pulled: ['title'],
        conflicts: [{ field: 'title', kept: 'remote', local: 'Local edit', remote: 'Remote edit' }],
      })
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.title).toBe('Remote edit')
      expect(after.ok && after.value.item.events.at(-1)?.detail).toContain('kept the Linear value. The local value was: Local edit')
      expect((yield* sync.status({ ids: [created.item.id] })).items[0]?.state).toBe('conflict')

      yield* store.update({ id: created.item.id, title: 'Local edit', actor: user })
      const resolved = yield* sync.syncNow({ id: created.item.id })
      expect(resolved.results[0]).toMatchObject({ state: 'synced', pushed: ['title'] })
      expect(linear.find('ENG-1')?.title).toBe('Local edit')
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('flags a conflict without writing either side under the flag policy, until both sides agree', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      yield* sync.saveBinding({ binding: { id: 'linear-eng', conflictPolicy: 'flag' } })
      const created = yield* store.capture({ text: 'Original', actor: user })
      yield* sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user })
      yield* TestClock.adjust('1 minute')
      yield* store.update({ id: created.item.id, title: 'Local edit', actor: user })
      const issue = linear.find('ENG-1')
      if (issue === undefined) throw new Error('issue missing')
      issue.title = 'Remote edit'
      issue.updatedAt = 120_000

      const flagged = yield* sync.syncNow({ id: created.item.id })
      expect(flagged.results[0]).toMatchObject({ state: 'conflict', pulled: [], pushed: [], conflicts: [{ field: 'title', kept: 'none' }] })
      expect(linear.find('ENG-1')?.title).toBe('Remote edit')
      const still = yield* sync.syncNow({ id: created.item.id })
      expect(still.results[0]?.state).toBe('conflict')

      yield* store.update({ id: created.item.id, title: 'Remote edit', actor: user })
      const agreed = yield* sync.syncNow({ id: created.item.id })
      expect(agreed.results[0]).toMatchObject({ state: 'synced', conflicts: [] })
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('imports a Linear issue as a linked item with its status, labels, priority and comments, once', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      const issue = linear.seed({ title: 'Crash on save', description: 'Steps…', type: 'started', labels: ['Bug', 'ui'], priority: 1 })
      linear.remoteComment(issue, 'Seen on macOS')

      const imported = yield* sync.importRemote({ provider: 'linear', reference: 'ENG-1', project: '/work/app', actor: user })

      expect(imported.created).toBe(true)
      expect(imported.detail.item).toMatchObject({
        title: 'Crash on save',
        body: 'Steps…',
        status: 'doing',
        kind: 'bug',
        project: '/work/app',
        priority: 'urgent',
      })
      expect([...imported.detail.item.tags].sort()).toEqual(['bug', 'ui'])
      expect(imported.detail.item.events[0]?.origin).toBe('remote:linear-eng')
      expect(imported.detail.item.events.some(event => event.kind === 'commented' && event.detail === 'Linear · Ada: Seen on macOS')).toBe(true)
      const again = yield* sync.importRemote({ provider: 'linear', reference: 'eng-1', actor: user })
      expect(again).toMatchObject({ created: false, detail: { item: { id: imported.detail.item.id } } })
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('imports every open issue of a binding once, with priority, parents and relations, and pulls later changes since its cursor', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      yield* sync.saveBinding({ binding: { id: 'linear-eng', fieldMap: BacklogSyncModel.defaultFieldMap() } })
      const epic = linear.seed({ title: 'Epic', priority: 2 })
      const child = linear.seed({ title: 'Child', parentId: epic.id })
      const blocked = linear.seed({ title: 'Blocked' })
      linear.seed({ title: 'Already done', type: 'completed' })
      linear.relate({ from: child, to: blocked, type: 'blocks' })

      const first = yield* sync.importAll({ binding: 'linear-eng', actor: user })
      expect(first).toMatchObject({ created: 3, complete: false })
      const items = (yield* store.list({ freshness: 'all', limit: 50 })).items
      const byTitle = (title: string) => items.find(item => item.title === title)
      expect(byTitle('Already done')).toBeUndefined()
      const epicItem = yield* store.get(byTitle('Epic')?.id ?? 0)
      const childItem = yield* store.get(byTitle('Child')?.id ?? 0)
      const blockedItem = yield* store.get(byTitle('Blocked')?.id ?? 0)
      if (!epicItem.ok || !childItem.ok || !blockedItem.ok) throw new Error('imports missing')
      expect(epicItem.value.item.priority).toBe('high')
      expect(childItem.value.item.parent).toBe(epicItem.value.item.ref)
      expect(childItem.value.item.links).toContainEqual(expect.objectContaining({ type: 'item', target: blockedItem.value.item.ref, relation: 'blocks' }))
      expect(blockedItem.value.item.links).toContainEqual(expect.objectContaining({ type: 'item', target: childItem.value.item.ref, relation: 'depends-on' }))

      const again = yield* sync.importAll({ binding: 'linear-eng', actor: user })
      expect(again.created).toBe(0)

      linear.state.now = 900_000
      const epicIssue = linear.find(epic.id)
      if (epicIssue === undefined) throw new Error('epic missing')
      epicIssue.title = 'Epic renamed'
      epicIssue.updatedAt = 900_000
      const pass = yield* sync.syncNow({ binding: 'linear-eng' })
      expect(pass.passes[0]?.records).toBe(1)
      expect(pass.results.map(result => result.pulled)).toEqual([['title']])

      yield* TestClock.adjust('1 minute')
      yield* store.update({ id: childItem.value.item.id, priority: 'low', parent: null, actor: user })
      const pushed = yield* sync.syncNow({ id: childItem.value.item.id })
      expect(pushed.results[0]?.pushed).toEqual(['priority', 'parent'])
      expect(linear.find(child.id)).toMatchObject({ priority: 4, parentId: null })
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('writes a mapped workflow state through the binding status value map', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const binding = (yield* sync.status({})).bindings[0]?.binding
      if (binding === undefined) throw new Error('binding missing')
      yield* sync.saveBinding({
        binding: {
          id: binding.id,
          fieldMap: binding.fieldMap.map(rule => (rule.field === 'status' ? { ...rule, values: [{ local: 'doing', remote: 'In Review' }] } : rule)),
        },
      })
      const created = yield* store.capture({ text: 'Needs review', status: 'doing', actor: user })
      yield* sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user })
      expect(linear.stateNameOf('ENG-1')).toBe('In Review')
      const pass = yield* sync.syncNow({ id: created.item.id })
      expect(pass.results[0]).toMatchObject({ pulled: [], pushed: [] })
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('records a refused key on the item with a recovery path, and recovers on the next pass', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'Needs a key', actor: user })
      yield* sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user })

      linear.state.status = 401
      const failed = yield* sync.syncNow({ id: created.item.id })
      expect(failed.results[0]?.state).toBe('error')
      expect(failed.results[0]?.error?.message).toContain("check that the connection's key is valid")
      expect((yield* sync.status({})).items[0]).toMatchObject({ state: 'error', lastError: { code: 'BacklogProviderFailed' } })

      linear.state.status = 200
      const recovered = yield* sync.syncNow({ id: created.item.id })
      expect(recovered.results[0]).toMatchObject({ state: 'synced', error: null })
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('names the setting to fix when no binding serves the project', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'Orphan', project: '/work/other', actor: user })
      const unconfigured = yield* Effect.flip(sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user }))
      expect(unconfigured._tag).toBe('SyncBindingMissing')
      expect(unconfigured.message).toContain('Backlog settings › Remote sync')
      expect(linear.state.requests).toEqual([])
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [{ ...legacyLinearRow, project: '/work/app' }] })))
  })

  it.effect('unlinks without touching either side, and the item can be linked again', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'Reversible link', actor: user })
      yield* sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user })

      yield* sync.link({ id: created.item.id, provider: 'linear', remove: true, actor: user })

      expect((yield* sync.status({})).items).toEqual([])
      const item = yield* store.get(created.item.id)
      expect(item.ok && item.value.item.links.some(link => link.type === 'url')).toBe(false)
      expect(linear.find('ENG-1')?.title).toBe('Reversible link')
      const relinked = yield* sync.link({ id: created.item.id, provider: 'linear', reference: 'ENG-1', actor: user })
      expect(relinked.item?.state).toBe('synced')
      const twice = yield* Effect.flip(sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user }))
      expect(twice._tag).toBe('SyncAlreadyLinked')
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('keeps a deleted item’s link as a tombstone, so a pull never imports its issue again; an explicit import still can', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      yield* sync.saveBinding({ binding: { id: 'linear-eng', importNew: true } })
      const created = yield* store.capture({ text: 'Linked then deleted', actor: user })
      yield* sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user })

      expect(yield* sync.deleteItem({ id: created.item.id })).toEqual({ ok: true, value: undefined })
      expect((yield* sync.status({})).items).toEqual([])
      expect(linear.find('ENG-1')?.title).toBe('Linked then deleted')

      const pass = yield* sync.syncNow({ binding: 'linear-eng' })
      expect(pass.passes[0]?.created).toBe(0)
      const reimported = yield* sync.importRemote({ provider: 'linear', reference: 'ENG-1', actor: user })
      expect(reimported.created).toBe(true)
      expect(yield* sync.deleteItem({ id: created.item.id })).toEqual({ ok: false, reason: 'not-found' })
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect('keeps items, connections and links across a Host restart', () => {
    const linear = fakeLinear()
    const storage = backlogRows()
    return Effect.gen(function* () {
      const id = yield* Effect.gen(function* () {
        const created = yield* (yield* BacklogStore).capture({ text: 'Survives restarts', actor: user })
        yield* (yield* BacklogSync).link({ id: created.item.id, provider: 'linear', create: true, actor: user })
        return created.item.id
      }).pipe(Effect.provide(syncTestLayer({ client: linear.client, storage, rows: [legacyLinearRow] })))

      const status = yield* Effect.gen(function* () {
        return yield* (yield* BacklogSync).status({ ids: [id] })
      }).pipe(Effect.provide(syncTestLayer({ client: linear.client, storage, rows: [legacyLinearRow, legacyGithubRow] })))
      expect(status.items[0]).toMatchObject({ itemId: id, remoteKey: 'ENG-1', state: 'synced' })
      expect(status.connections.map(view => view.connection.instanceId)).toEqual(['linear'])
    })
  })
})

describe('Remote sync setup', () => {
  it.effect('migrates settings rows and per-item mappings to connections, bindings and refs once, keeping every link', () => {
    const linear = fakeLinear()
    const github = fakeGithub()
    const storage = backlogRows()
    const rows = [
      legacyLinearRow,
      { ...legacyGithubRow, project: '/work/app', autoSyncMinutes: 15, pushAgentComments: true },
      { ...legacyGithubRow, project: '/work/site', target: 'acme/site', enabled: false },
    ]
    return Effect.gen(function* () {
      const ids = yield* Effect.gen(function* () {
        const store = yield* BacklogStore
        const repo = yield* BacklogRepo
        const onApp = yield* store.capture({ text: 'On app', project: '/work/app', actor: user })
        const onLinear = yield* store.capture({ text: 'On linear', actor: user })
        const base = { title: 'On app', body: '', status: 'inbox' as const, tags: [] }
        const mapping = {
          linkedAt: 1,
          lastSyncedAt: 2,
          remoteUpdatedAt: 2,
          localSyncedAt: 2,
          base: { local: base, remote: { ...base, status: 'todo' as const } },
          comments: [{ local: 'c1', remote: '901' }],
          pushCommentsSince: 1,
          state: 'synced' as const,
          conflicts: [],
          lastError: null,
        }
        yield* repo.mappings.put(String(onApp.item.id), {
          ...mapping,
          itemId: onApp.item.id,
          backend: 'github',
          remoteId: '7',
          remoteKey: 'acme/app#7',
          url: 'https://github.com/acme/app/issues/7',
        })
        yield* repo.mappings.put(String(onLinear.item.id), {
          ...mapping,
          itemId: onLinear.item.id,
          backend: 'linear',
          remoteId: 'issue-uuid',
          remoteKey: 'ENG-9',
          url: 'https://linear.app/acme/issue/ENG-9',
        })
        return { app: onApp.item.id, linear: onLinear.item.id }
      }).pipe(Effect.provide(backlogStoreLayer({ rows: storage })))

      const migrated = yield* Effect.gen(function* () {
        const sync = yield* BacklogSync
        const sources = yield* SyncSources
        return { status: yield* sync.status({}), refs: yield* sources.refs }
      }).pipe(Effect.provide(syncTestLayer({ client: linear.client, storage, rows })))

      expect(
        migrated.status.connections.map(view => ({ id: view.connection.instanceId, kind: view.connection.kind, credential: view.connection.credential })),
      ).toEqual([
        { id: 'linear', kind: 'linear', credential: 'secret:LINEAR_KEY' },
        { id: 'github', kind: 'github', credential: 'secret:GITHUB_KEY' },
      ])
      expect(
        migrated.status.bindings.map(view => ({
          id: view.binding.id,
          connection: view.binding.connectionId,
          container: view.binding.container,
          scope: view.binding.scope,
          poll: view.binding.pollEverySec,
          agents: view.binding.pushAgentComments,
          enabled: view.binding.enabled,
          fields: view.binding.fieldMap.map(rule => rule.field),
        })),
      ).toEqual([
        {
          id: 'linear-eng',
          connection: 'linear',
          container: 'ENG',
          scope: null,
          poll: 0,
          agents: false,
          enabled: true,
          fields: ['title', 'body', 'status', 'tags'],
        },
        {
          id: 'github-acme-app',
          connection: 'github',
          container: 'acme/app',
          scope: '/work/app',
          poll: 900,
          agents: true,
          enabled: true,
          fields: ['title', 'body', 'status', 'tags'],
        },
        {
          id: 'github-acme-site',
          connection: 'github',
          container: 'acme/site',
          scope: '/work/site',
          poll: 0,
          agents: false,
          enabled: false,
          fields: ['title', 'body', 'status', 'tags'],
        },
      ])
      expect(
        migrated.refs.map(entry => ({ itemId: entry.itemId, binding: entry.ref.bindingId, key: entry.ref.key, comments: entry.ref.comments.length })),
      ).toEqual([
        { itemId: ids.app, binding: 'github-acme-app', key: 'acme/app#7', comments: 1 },
        { itemId: ids.linear, binding: 'linear-eng', key: 'issue-uuid', comments: 1 },
      ])

      const reopened = yield* Effect.gen(function* () {
        return yield* (yield* BacklogSync).status({})
      }).pipe(Effect.provide(syncTestLayer({ client: github.client, storage, rows: [] })))
      expect(reopened.bindings).toHaveLength(3)
      expect(reopened.items.map(item => item.bindingId).sort()).toEqual(['github-acme-app', 'linear-eng'])
    })
  })

  it.effect('tests a connection without sending its key back: account, containers and where the key came from', () => {
    const linear = fakeLinear()
    linear.state.teams = [
      { key: 'ENG', name: 'Engineering' },
      { key: 'OPS', name: 'Operations' },
    ]
    vi.stubEnv('LINEAR_API_KEY', 'lin_env_key')
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      const report = yield* sync.testConnection({ draft: { kind: 'linear', credential: '', baseUrl: '' } })
      expect(report).toEqual({
        ok: true,
        credential: 'environment',
        account: 'Ada',
        containers: [
          { key: 'ENG', name: 'Engineering' },
          { key: 'OPS', name: 'Operations' },
        ],
        error: null,
      })
      expect(JSON.stringify(report)).not.toContain('lin_env_key')

      yield* sync.saveConnection({ connection: { instanceId: 'linear', kind: 'linear', label: 'Linear', credential: '', baseUrl: '' } })
      yield* sync.saveBinding({ binding: { connectionId: 'linear' } })
      const store = yield* BacklogStore
      const created = yield* store.capture({ text: 'Which team?', actor: user })
      const failed = yield* Effect.flip(sync.link({ id: created.item.id, provider: 'linear', create: true, actor: user }))
      expect(failed.message).toContain('several teams')
      const tested = yield* sync.testSaved
      expect(tested.results[0]?.connection.identity?.account).toBe('Ada')
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client })))
  })

  it.effect('refuses an unknown provider kind and renames a connection with its bindings', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      const unknown = yield* Effect.flip(sync.saveConnection({ connection: { instanceId: 'jira', kind: 'jira', label: 'Jira', credential: '', baseUrl: '' } }))
      expect(unknown._tag).toBe('SyncProviderUnknown')
      yield* sync.saveConnection({
        connection: { instanceId: 'linear-work', kind: 'linear', label: 'Linear – work', credential: 'secret:LINEAR_KEY', baseUrl: '' },
        previousInstanceId: 'linear',
      })
      const status = yield* sync.status({})
      expect(status.connections.map(view => view.connection.label)).toEqual(['Linear – work'])
      expect(status.bindings[0]?.binding.connectionId).toBe('linear-work')
      yield* sync.removeConnection({ instanceId: 'linear-work' })
      expect((yield* sync.status({})).bindings).toEqual([])
    }).pipe(Effect.provide(syncTestLayer({ client: linear.client, rows: [legacyLinearRow] })))
  })

  it.effect("takes the GitHub repository from the project's git remote and the token from the gh CLI", () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      const report = yield* sync.testConnection({ draft: { kind: 'github', credential: '', baseUrl: '' } })
      expect(report).toMatchObject({ ok: true, credential: 'cli', account: 'octocat', containers: [{ key: 'acme/app' }] })
      expect((yield* sync.status({})).connections[0]?.credential).toBe('fallback')

      const store = yield* BacklogStore
      const created = yield* store.capture({ text: 'Detected repo', project: '/work/app', actor: user })
      yield* sync.link({ id: created.item.id, provider: 'github', create: true, actor: user })
      expect(github.state.issues.get(1)?.title).toBe('Detected repo')
      expect(github.state.requests.every(request => request.authorization === 'Bearer gh_cli_token')).toBe(true)
    }).pipe(
      Effect.provide(
        syncTestLayer({
          client: github.client,
          rows: [{ ...legacyGithubRow, target: '', secret: '' }],
          probes: { repository: 'acme/app', cliToken: 'gh_cli_token' },
        }),
      ),
    )
  })

  it.effect('names the missing key with its fix', () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const noKey = yield* (yield* BacklogSync).testConnection({ draft: { kind: 'github', credential: '', baseUrl: '' } })
      expect(noKey).toMatchObject({ ok: false, credential: 'missing', error: { code: 'BacklogProviderFailed' } })
      expect(noKey.error?.message).toContain('GITHUB_TOKEN or GH_TOKEN')
      expect(github.state.requests).toEqual([])
    }).pipe(Effect.provide(syncTestLayer({ client: github.client })))
  })

  it.effect('imports by URL or identifier without naming the provider, and refuses text no provider recognizes', () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      github.seed({ title: 'From a URL' })
      const imported = yield* sync.importRemote({ reference: 'https://github.com/acme/app/issues/1', actor: user })
      expect(imported.detail.item.title).toBe('From a URL')
      const unknown = yield* Effect.flip(sync.importRemote({ reference: 'not an issue', actor: user }))
      expect(unknown._tag).toBe('SyncReferenceUnrecognized')
      expect(unknown.message).toContain('ENG-12')
    }).pipe(Effect.provide(syncTestLayer({ client: github.client, rows: [{ ...legacyGithubRow, target: '' }] })))
  })
})

describe('BacklogSync with GitHub Issues', () => {
  it.effect('creates, closes and comments on a GitHub issue, keeps doing against an open issue, and records its spans', () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'bug: flaky upload #infra', status: 'doing', actor: user })
      yield* sync.link({ id: created.item.id, provider: 'github', create: true, actor: user })
      expect(github.state.issues.get(1)).toMatchObject({ title: 'flaky upload', state: 'open', labels: ['infra', 'bug'] })
      expect((yield* sync.syncNow({ id: created.item.id })).results[0]).toMatchObject({ pulled: [], pushed: [] })
      const doing = yield* store.get(created.item.id)
      expect(doing.ok && doing.value.item.status).toBe('doing')

      yield* TestClock.adjust('1 minute')
      yield* store.update({ id: created.item.id, status: 'dropped', actor: user })
      yield* store.comment({ id: created.item.id, text: 'Not reproducible', actor: user })
      const pass = yield* sync.syncNow({ id: created.item.id })

      expect(pass.results[0]).toMatchObject({ state: 'synced', pushed: ['status'], commentsPushed: 1 })
      expect(github.state.issues.get(1)).toMatchObject({ state: 'closed', state_reason: 'not_planned' })
      expect(github.state.requests.every(request => request.authorization === 'Bearer gh_test_token')).toBe(true)
      expect(recorder.span('github request').attributes['dshx.backlog.sync.provider']).toBe('github')

      const issue = github.state.issues.get(1)
      if (issue === undefined) throw new Error('issue missing')
      issue.state = 'open'
      issue.state_reason = null
      issue.updated_at = 500_000
      const reopened = yield* sync.syncNow({ id: created.item.id })
      expect(reopened.results[0]?.pulled).toEqual(['status'])
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.status).toBe('todo')
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer), Effect.provide(syncTestLayer({ client: github.client, rows: [legacyGithubRow] })))
  })

  it.effect('imports an issue by URL and refuses one from another repository', () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      github.seed({ title: 'Docs typo', body: 'In README', labels: ['docs'] })
      const imported = yield* sync.importRemote({ provider: 'github', reference: 'https://github.com/acme/app/issues/1', actor: user })
      expect(imported.detail.item).toMatchObject({ title: 'Docs typo', body: 'In README', status: 'todo', tags: ['docs'] })
      const elsewhere = yield* Effect.flip(sync.importRemote({ provider: 'github', reference: 'https://github.com/other/repo/issues/1', actor: user }))
      expect(elsewhere._tag).toBe('BacklogProviderFailed')
    }).pipe(Effect.provide(syncTestLayer({ client: github.client, rows: [legacyGithubRow] })))
  })

  it.effect('syncs sub-issues as parents and dependencies as depends-on links both ways', () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      yield* sync.saveBinding({
        binding: {
          id: 'github-acme-app',
          fieldMap: [
            ...((yield* sync.status({})).bindings[0]?.binding.fieldMap ?? []),
            { field: 'parent', direction: 'two-way', values: [] },
            { field: 'links', direction: 'two-way', values: [] },
          ],
        },
      })
      const parent = github.seed({ title: 'Parent' })
      const child = github.seed({ title: 'Child' })
      const blocker = github.seed({ title: 'Blocker' })
      child.parent = parent.number
      child.blockedBy = [blocker.number]

      const imported = yield* sync.importAll({ binding: 'github-acme-app', actor: user })
      expect(imported.created).toBe(3)
      const items = (yield* store.list({ freshness: 'all', limit: 50 })).items
      const refOf = (title: string) => items.find(item => item.title === title)?.ref
      const childItem = items.find(item => item.title === 'Child')
      const childDetail = yield* store.get(childItem?.id ?? 0)
      if (!childDetail.ok) throw new Error('child missing')
      expect(childDetail.value.item.parent).toBe(refOf('Parent'))
      expect(childDetail.value.item.links).toContainEqual(expect.objectContaining({ type: 'item', target: refOf('Blocker'), relation: 'depends-on' }))

      yield* TestClock.adjust('1 minute')
      const blockerItem = items.find(item => item.title === 'Blocker')
      yield* store.update({ id: childDetail.value.item.id, parent: null, actor: user })
      yield* store.link({
        id: childDetail.value.item.id,
        link: { type: 'item', target: refOf('Blocker') ?? '', relation: 'depends-on' },
        remove: true,
        actor: user,
      })
      const pushed = yield* sync.syncNow({ id: childDetail.value.item.id })
      expect(pushed.results[0]?.pushed).toEqual(['parent', 'links'])
      expect(github.state.issues.get(child.number)).toMatchObject({ parent: null, blockedBy: [] })
      expect(blockerItem).toBeDefined()

      const etagPass = yield* sync.syncNow({ binding: 'github-acme-app' })
      const second = yield* sync.syncNow({ binding: 'github-acme-app' })
      expect(etagPass.passes[0]?.complete).toBe(false)
      expect(second.passes[0]?.records).toBe(0)
      expect(github.state.requests.some(request => request.url.includes('/issues?') && request.method === 'GET')).toBe(true)
    }).pipe(Effect.provide(syncTestLayer({ client: github.client, rows: [legacyGithubRow] })))
  })

  it.effect('keeps two GitHub accounts apart: each binding uses its own key, and a duplicate link is refused per binding', () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      yield* sync.saveConnection({
        connection: { instanceId: 'github-work', kind: 'github', label: 'GitHub – work', credential: 'secret:GITHUB_WORK', baseUrl: '' },
      })
      yield* sync.saveConnection({
        connection: { instanceId: 'github-perso', kind: 'github', label: 'GitHub – perso', credential: 'secret:GITHUB_PERSO', baseUrl: '' },
      })
      yield* sync.saveBinding({ binding: { id: 'work', connectionId: 'github-work', container: 'acme/app' } })
      yield* sync.saveBinding({ binding: { id: 'perso', connectionId: 'github-perso', container: 'acme/app', scope: '/home/perso' } })
      github.seed({ title: 'Shared issue' })
      const first = yield* store.capture({ text: 'Work copy', actor: user })
      const second = yield* store.capture({ text: 'Perso copy', project: '/home/perso', actor: user })
      const third = yield* store.capture({ text: 'Another work copy', actor: user })

      yield* sync.link({ id: first.item.id, binding: 'work', reference: '#1', actor: user })
      const perso = yield* sync.link({ id: second.item.id, binding: 'perso', reference: '#1', actor: user })
      expect(perso.item).toMatchObject({ bindingId: 'perso', connectionLabel: 'GitHub – perso' })
      const duplicate = yield* Effect.flip(sync.link({ id: third.item.id, binding: 'work', reference: '#1', actor: user }))
      expect(duplicate._tag).toBe('SyncAlreadyLinked')
      const tokens = new Set(github.state.requests.map(request => request.authorization))
      expect(tokens).toEqual(new Set(['Bearer work_token', 'Bearer perso_token']))
      const identity = yield* sync.testConnection({ connection: 'github-perso' })
      expect(identity.account).toBe('octo-perso')
    }).pipe(Effect.provide(syncTestLayer({ client: github.client, secrets: { GITHUB_WORK: 'work_token', GITHUB_PERSO: 'perso_token' } })))
  })
})
