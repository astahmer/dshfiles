import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { FilesMapping } from './provider-files.js'
import { BacklogStore } from './store.js'
import { fakeGithub } from './sync-fakes.js'
import { BacklogSync } from './sync-service.js'
import { syncTestLayer } from './sync-test-support.js'

const user = { kind: 'user' } as const

const frontmatterOf = (path: string) => FilesMapping.splitFile(readFileSync(path, 'utf8'))

describe('the files provider', () => {
  it.effect('round-trips items through markdown files: create, an editor change, a local change, a new file, a removed file and a delete', () => {
    const project = mkdtempSync(join(tmpdir(), 'dshfiles-backlog-files-'))
    const folder = join(project, 'backlog')
    return Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const store = yield* BacklogStore
      const sync = yield* BacklogSync
      yield* sync.saveConnection({ connection: { instanceId: 'files', kind: 'files', label: 'Repo files', credential: '', baseUrl: '' } })
      yield* sync.saveBinding({ binding: { id: 'repo', connectionId: 'files', scope: project, importNew: true } })
      const tested = yield* sync.testConnection({ connection: 'files' })
      expect(tested).toMatchObject({ ok: true, credential: 'none' })

      const created = yield* store.capture({ text: 'Fix login #auth !2', project, status: 'todo', actor: user })
      const ref = created.item.ref ?? ''
      const linked = yield* sync.link({ id: created.item.id, binding: 'repo', create: true, actor: user })
      expect(linked.item).toMatchObject({ bindingId: 'repo', remoteKey: `${ref}-fix-login.md`, state: 'synced' })
      const path = join(folder, `${ref}-fix-login.md`)
      expect(frontmatterOf(path).data).toMatchObject({ ref, title: 'Fix login', status: 'todo', priority: 'high', tags: ['auth'], kind: 'task' })

      const edited = frontmatterOf(path)
      writeFileSync(path, FilesMapping.joinFile({ ...edited.data, title: 'Fix login on Safari', status: 'done' }, 'Edited in an editor.'))
      const pulled = yield* sync.syncNow({ binding: 'repo' })
      expect(pulled.results.map(result => [...result.pulled].sort())).toEqual([['body', 'status', 'title']])
      const pass = recorder.span('backlog sync').attributes
      expect(pass).toMatchObject({
        'dshx.backlog.sync.binding': 'repo',
        'dshx.backlog.sync.provider': 'files',
        'dshx.backlog.sync.records': 1,
        'dshx.backlog.sync.items': 1,
      })
      expect(recorder.named('backlog files scan').map(span => span.attributes['dshx.backlog.files.count'])).toContain(1)
      const afterPull = yield* store.get(created.item.id)
      expect(afterPull.ok && afterPull.value.item).toMatchObject({ title: 'Fix login on Safari', status: 'done', body: 'Edited in an editor.' })
      expect(afterPull.ok && afterPull.value.item.events.at(-1)?.origin).toBe('remote:repo')
      expect((yield* sync.syncNow({ binding: 'repo' })).results).toEqual([])

      yield* store.update({ id: created.item.id, tags: ['auth', 'safari'], priority: 'urgent', actor: user })
      const pushed = yield* sync.syncNow({ id: created.item.id })
      expect([...(pushed.results[0]?.pushed ?? [])].sort()).toEqual(['priority', 'tags'])
      expect(frontmatterOf(path).data).toMatchObject({ tags: ['auth', 'safari'], priority: 'urgent', title: 'Fix login on Safari' })

      writeFileSync(join(folder, 'from-editor.md'), FilesMapping.joinFile({ title: 'Written by hand', status: 'todo', parent: ref }, 'Typed in vim.'))
      const imported = yield* sync.syncNow({ binding: 'repo' })
      expect(imported.passes[0]).toMatchObject({ created: 1, complete: true })
      const items = (yield* store.list({ freshness: 'all', limit: 50 })).items
      const handWritten = items.find(item => item.title === 'Written by hand')
      expect(handWritten).toMatchObject({ project, status: 'todo' })
      const handDetail = yield* store.get(handWritten?.id ?? 0)
      expect(handDetail.ok && handDetail.value.item.parent).toBe(ref)

      rmSync(join(folder, 'from-editor.md'))
      const removed = yield* sync.syncNow({ binding: 'repo' })
      expect(removed.passes[0]?.removed).toBe(1)
      const afterRemoval = yield* store.get(handWritten?.id ?? 0)
      expect(afterRemoval.ok && afterRemoval.value.item.status).toBe('dropped')
      expect((yield* sync.status({})).items.map(item => item.itemId)).toEqual([created.item.id])

      yield* sync.deleteItem({ id: created.item.id })
      expect(frontmatterOf(path).data).toMatchObject({ status: 'dropped' })
      expect(readdirSync(folder)).toEqual([`${ref}-fix-login.md`])
      expect((yield* sync.syncNow({ binding: 'repo' })).passes[0]?.created).toBe(0)
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer), Effect.provide(syncTestLayer({ client: fakeGithub().client })))
  })
})
