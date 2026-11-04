import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { HttpClient } from 'effect/http'
import { TestClock } from 'effect/testing'
import type { BacklogSettings } from './settings.js'
import { BacklogStore } from './store.js'
import { fakeGithub, fakeLinear } from './sync-fakes.js'
import type { SyncMapping } from './sync-model.js'
import { BacklogSync, RemoteBackends } from './sync-service.js'
import { BacklogSyncTables } from './sync-tables.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

type Row = BacklogSettings['syncBackends'][number]

const linearRow: Row = { project: '', backend: 'linear', enabled: true, target: 'ENG', secret: 'secret:LINEAR_KEY', autoSyncMinutes: 0 }
const githubRow: Row = { project: '', backend: 'github', enabled: true, target: 'acme/app', secret: 'secret:GITHUB_KEY', autoSyncMinutes: 0 }

const syncLayer = (input: {
  readonly client: HttpClient.HttpClient
  readonly rows?: readonly Row[]
  readonly secret?: string | undefined
  readonly storage?: { readonly items: ReturnType<typeof backlogRows>; readonly mappings: Map<string, SyncMapping> }
}) => {
  const storage = input.storage ?? { items: backlogRows(), mappings: new Map<string, SyncMapping>() }
  return BacklogSync.layer.pipe(
    Layer.provideMerge(RemoteBackends.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        backlogStoreLayer({ rows: storage.items, settings: { syncBackends: [...(input.rows ?? [linearRow])] } }),
        BacklogSyncTables.layerMemory(storage.mappings),
        Layer.succeed(HttpClient.HttpClient, input.client),
        SecretReferenceResolver.layerTest({ resolve: async () => input.secret ?? 'lin_test_key' }),
      ),
    ),
  )
}

describe('BacklogSync with Linear', () => {
  it.effect('creates a Linear issue from an item, maps status and labels, and records its spans', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'bug: sync drops labels #ui #local-only', status: 'doing', actor: { kind: 'user' } })

      const linked = yield* sync.link({ id: created.item.id, backend: 'linear', create: true, actor: { kind: 'user' } })

      const issue = linear.find('ENG-1')
      expect(issue?.title).toBe('sync drops labels')
      expect(linear.typeOfIssue('ENG-1')).toBe('started')
      expect(issue?.labelIds.sort()).toEqual(['l-bug', 'l-ui'])
      expect(linked.item).toMatchObject({ remoteKey: 'ENG-1', state: 'synced', url: 'https://linear.app/acme/issue/ENG-1/slug' })
      const item = yield* store.get(created.item.id)
      expect(item.ok && item.value.item.links.some(link => link.type === 'url' && link.target === 'https://linear.app/acme/issue/ENG-1/slug')).toBe(true)
      expect(linear.state.requests.every(request => request.authorization === 'lin_test_key')).toBe(true)
      expect(recorder.span('linear request').attributes['dshx.backlog.sync.backend']).toBe('linear')
      expect(recorder.span('backlog sync').attributes['dshx.backlog.item_id']).toBe(created.item.id)
      expect(recorder.span('backlog sync').attributes['dshx.backlog.sync.outcome']).toBe('synced')
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer), Effect.provide(syncLayer({ client: linear.client })))
  })

  it.effect('links an existing issue, then syncs title, status and new comments both ways without echoes', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const issue = linear.seed({ title: 'Remote title', description: 'Remote body', type: 'unstarted', labels: ['sync'] })
      const created = yield* store.capture({ text: 'Local title #mine', actor: { kind: 'user' } })

      yield* sync.link({ id: created.item.id, backend: 'linear', reference: 'https://linear.app/acme/issue/ENG-1/remote-title', actor: { kind: 'user' } })
      const adopted = yield* store.get(created.item.id)
      expect(adopted.ok && adopted.value.item).toMatchObject({ title: 'Remote title', body: 'Remote body', status: 'todo' })
      expect(adopted.ok && [...adopted.value.item.tags].sort()).toEqual(['mine', 'sync'])

      yield* TestClock.adjust('1 minute')
      yield* store.update({ id: created.item.id, title: 'Renamed here', actor: { kind: 'user' } })
      yield* store.comment({ id: created.item.id, text: 'Local progress note', actor: { kind: 'user' } })
      linear.state.now = 200_000
      linear.setType(issue, 'completed')
      linear.remoteComment(issue, 'Shipped in v2')

      const pass = yield* sync.syncNow({ id: created.item.id })

      expect(pass.results[0]).toMatchObject({ state: 'synced', pulled: ['status'], pushed: ['title'], commentsPulled: 1, commentsPushed: 1 })
      expect(linear.find('ENG-1')?.title).toBe('Renamed here')
      expect(linear.find('ENG-1')?.comments.map(comment => comment.body)).toEqual(['Shipped in v2', expect.stringContaining('Local progress note')])
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.status).toBe('done')
      expect(after.ok && after.value.item.events.filter(event => event.kind === 'commented').map(event => event.detail)).toEqual([
        'Local progress note',
        'Linear · Ada: Shipped in v2',
      ])

      const again = yield* sync.syncNow({ id: created.item.id })
      expect(again.results[0]).toMatchObject({ state: 'synced', pulled: [], pushed: [], commentsPulled: 0, commentsPushed: 0 })
    }).pipe(Effect.provide(syncLayer({ client: linear.client })))
  })

  it.effect('settles a field both sides changed by last writer wins and leaves a conflict note', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'Original', actor: { kind: 'user' } })
      yield* sync.link({ id: created.item.id, backend: 'linear', create: true, actor: { kind: 'user' } })

      yield* TestClock.adjust('1 minute')
      yield* store.update({ id: created.item.id, title: 'Local edit', actor: { kind: 'user' } })
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
      expect(after.ok && after.value.item.events.at(-1)?.detail).toContain('kept the Linear value (changed last). The local value was: Local edit')
      const status = yield* sync.status({ ids: [created.item.id] })
      expect(status.items[0]?.state).toBe('conflict')

      yield* store.update({ id: created.item.id, title: 'Local edit', actor: { kind: 'user' } })
      expect((yield* sync.status({ ids: [created.item.id] })).items[0]?.state).toBe('conflict')
      const resolved = yield* sync.syncNow({ id: created.item.id })
      expect(resolved.results[0]).toMatchObject({ state: 'synced', pushed: ['title'] })
      expect(linear.find('ENG-1')?.title).toBe('Local edit')
    }).pipe(Effect.provide(syncLayer({ client: linear.client })))
  })

  it.effect('imports a Linear issue as a linked item with its status, labels and comments, once', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      const issue = linear.seed({ title: 'Crash on save', description: 'Steps…', type: 'started', labels: ['Bug', 'ui'] })
      linear.remoteComment(issue, 'Seen on macOS')

      const imported = yield* sync.importRemote({ backend: 'linear', reference: 'ENG-1', project: '/work/app', actor: { kind: 'user' } })

      expect(imported.created).toBe(true)
      expect(imported.detail.item).toMatchObject({ title: 'Crash on save', body: 'Steps…', status: 'doing', kind: 'bug', project: '/work/app' })
      expect([...imported.detail.item.tags].sort()).toEqual(['bug', 'ui'])
      expect(imported.detail.item.events.some(event => event.kind === 'commented' && event.detail === 'Linear · Ada: Seen on macOS')).toBe(true)
      const again = yield* sync.importRemote({ backend: 'linear', reference: 'eng-1', actor: { kind: 'user' } })
      expect(again).toMatchObject({ created: false, detail: { item: { id: imported.detail.item.id } } })
    }).pipe(Effect.provide(syncLayer({ client: linear.client })))
  })

  it.effect('records a refused key on the item with a recovery path, and recovers on the next pass', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'Needs a key', actor: { kind: 'user' } })
      yield* sync.link({ id: created.item.id, backend: 'linear', create: true, actor: { kind: 'user' } })

      linear.state.status = 401
      const failed = yield* sync.syncNow({ id: created.item.id })
      expect(failed.results[0]?.state).toBe('error')
      expect(failed.results[0]?.error?.message).toContain('Check that the key is valid')
      expect((yield* sync.status({})).items[0]).toMatchObject({ state: 'error', lastError: { code: 'SyncRemoteRejected' } })

      linear.state.status = 200
      const recovered = yield* sync.syncNow({ id: created.item.id })
      expect(recovered.results[0]).toMatchObject({ state: 'synced', error: null })
    }).pipe(Effect.provide(syncLayer({ client: linear.client })))
  })

  it.effect('names the setting to fix when no backend serves the project or no key resolves', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'Orphan', project: '/work/other', actor: { kind: 'user' } })
      const unconfigured = yield* Effect.flip(sync.link({ id: created.item.id, backend: 'github', create: true, actor: { kind: 'user' } }))
      expect(unconfigured._tag).toBe('SyncBackendUnconfigured')
      expect(unconfigured.message).toContain('Backlog settings › Remote sync')
      expect(linear.state.requests).toEqual([])
    }).pipe(Effect.provide(syncLayer({ client: linear.client, rows: [{ ...linearRow, project: '/work/app' }] })))
  })

  it.effect('unlinks without touching either side, and the item can be linked again', () => {
    const linear = fakeLinear()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'Reversible link', actor: { kind: 'user' } })
      yield* sync.link({ id: created.item.id, backend: 'linear', create: true, actor: { kind: 'user' } })

      yield* sync.link({ id: created.item.id, backend: 'linear', remove: true, actor: { kind: 'user' } })

      expect((yield* sync.status({})).items).toEqual([])
      const item = yield* store.get(created.item.id)
      expect(item.ok && item.value.item.links.some(link => link.type === 'url')).toBe(false)
      expect(linear.find('ENG-1')?.title).toBe('Reversible link')
      const relinked = yield* sync.link({ id: created.item.id, backend: 'linear', reference: 'ENG-1', actor: { kind: 'user' } })
      expect(relinked.item?.state).toBe('synced')
      const twice = yield* Effect.flip(sync.link({ id: created.item.id, backend: 'linear', create: true, actor: { kind: 'user' } }))
      expect(twice._tag).toBe('SyncAlreadyLinked')
    }).pipe(Effect.provide(syncLayer({ client: linear.client })))
  })

  it.effect('keeps items and mappings across a Host restart', () => {
    const linear = fakeLinear()
    const storage = { items: backlogRows(), mappings: new Map<string, SyncMapping>() }
    return Effect.gen(function* () {
      const id = yield* Effect.gen(function* () {
        const created = yield* (yield* BacklogStore).capture({ text: 'Survives restarts', actor: { kind: 'user' } })
        yield* (yield* BacklogSync).link({ id: created.item.id, backend: 'linear', create: true, actor: { kind: 'user' } })
        return created.item.id
      }).pipe(Effect.provide(syncLayer({ client: linear.client, storage })))

      const status = yield* Effect.gen(function* () {
        return yield* (yield* BacklogSync).status({ ids: [id] })
      }).pipe(Effect.provide(syncLayer({ client: linear.client, storage })))
      expect(status.items[0]).toMatchObject({ itemId: id, remoteKey: 'ENG-1', state: 'synced' })
      expect(storage.items.items.has(String(id))).toBe(true)
    })
  })
})

describe('BacklogSync with GitHub Issues', () => {
  it.effect('creates, closes and comments on a GitHub issue through the REST API and records its spans', () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      const created = yield* store.capture({ text: 'bug: flaky upload #infra', actor: { kind: 'user' } })
      yield* sync.link({ id: created.item.id, backend: 'github', create: true, actor: { kind: 'user' } })
      expect(github.state.issues.get(1)).toMatchObject({ title: 'flaky upload', state: 'open', labels: ['infra', 'bug'] })

      yield* TestClock.adjust('1 minute')
      yield* store.update({ id: created.item.id, status: 'dropped', actor: { kind: 'user' } })
      yield* store.comment({ id: created.item.id, text: 'Not reproducible', actor: { kind: 'user' } })
      const pass = yield* sync.syncNow({ id: created.item.id })

      expect(pass.results[0]).toMatchObject({ state: 'synced', pushed: ['status'], commentsPushed: 1 })
      expect(github.state.issues.get(1)).toMatchObject({ state: 'closed', state_reason: 'not_planned' })
      expect(github.state.requests.every(request => request.authorization === 'Bearer gh_test_token')).toBe(true)
      expect(recorder.span('github request').attributes['dshx.backlog.sync.backend']).toBe('github')

      const issue = github.state.issues.get(1)
      if (issue === undefined) throw new Error('issue missing')
      issue.state = 'open'
      issue.state_reason = null
      issue.updated_at = 500_000
      const reopened = yield* sync.syncNow({ id: created.item.id })
      expect(reopened.results[0]?.pulled).toEqual(['status'])
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.status).toBe('todo')
    }).pipe(
      Effect.scoped,
      Effect.provide(DshxEffect.tracerLayer),
      Effect.provide(syncLayer({ client: github.client, rows: [githubRow], secret: 'gh_test_token' })),
    )
  })

  it.effect('imports an issue by URL and refuses one from another repository', () => {
    const github = fakeGithub()
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      github.seed({ title: 'Docs typo', body: 'In README', labels: ['docs'] })
      const imported = yield* sync.importRemote({ backend: 'github', reference: 'https://github.com/acme/app/issues/1', actor: { kind: 'user' } })
      expect(imported.detail.item).toMatchObject({ title: 'Docs typo', body: 'In README', status: 'todo', tags: ['docs'] })
      const elsewhere = yield* Effect.flip(
        sync.importRemote({ backend: 'github', reference: 'https://github.com/other/repo/issues/1', actor: { kind: 'user' } }),
      )
      expect(elsewhere._tag).toBe('SyncRemoteNotFound')
    }).pipe(Effect.provide(syncLayer({ client: github.client, rows: [githubRow], secret: 'gh_test_token' })))
  })
})
