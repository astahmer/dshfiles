import { BacklogProviderFailed, BacklogProviders, type ProviderConnection, type ProviderScope } from '@dshfiles/backlog/backlog-provider'
import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Layer } from 'effect'
import { HttpClient } from 'effect/http'
import { TestClock } from 'effect/testing'
import { NotionClient } from './notion-client.js'
import { fakeNotion } from './notion-fake.js'
import { NotionMapping } from './notion-mapping.js'
import { makeNotionPlugin, NotionPlugin } from './notion-plugin.js'
import { makeNotionProvider } from './notion-provider.js'

const connection: ProviderConnection = { instanceId: 'notion', kind: 'notion', label: 'Notion', credential: 'secret:NOTION_KEY', baseUrl: '' }

const setup = (fake: ReturnType<typeof fakeNotion>) =>
  Layer.mergeAll(
    NotionClient.layer({ minIntervalMs: 0 }).pipe(
      Layer.provide(Layer.mergeAll(Layer.succeed(HttpClient.HttpClient, fake.client), SecretReferenceResolver.layerTest({ resolve: async () => fake.key }))),
    ),
  )

const run = <A, E>(fake: ReturnType<typeof fakeNotion>, body: (provider: Effect.Success<ReturnType<typeof makeNotionProvider>>) => Effect.Effect<A, E>) =>
  Effect.flatMap(makeNotionProvider(), body).pipe(Effect.provide(setup(fake)))

const scopeOf = (fake: ReturnType<typeof fakeNotion>, options?: ProviderScope['options']): ProviderScope => ({
  connection,
  container: fake.dataSourceId,
  project: null,
  ...(options !== undefined && { options }),
})

const allFields = ['title', 'body', 'status', 'tags', 'priority', 'parent'] as const

describe('the Notion provider', () => {
  it.effect('names the bot and discovers data sources, pinning the API version on every request', () => {
    const fake = fakeNotion()
    return run(fake, provider =>
      Effect.gen(function* () {
        const identity = yield* provider.identity(connection)
        expect(identity).toEqual({ account: 'Backlog sync (Acme)', credentialSource: 'reference', containers: [{ key: fake.dataSourceId, name: 'Roadmap' }] })
        expect(fake.requests.map(request => `${request.method} ${request.path}`)).toEqual(['GET /users/me', 'POST /search'])
        expect(fake.requests.every(request => request.version === '2026-03-11' && request.authorized)).toBe(true)
        expect(fake.requests[1]?.json).toMatchObject({ filter: { property: 'object', value: 'data_source' } })
      }),
    )
  })

  it.effect('binds a database URL to its only data source and refuses a wrongly typed property', () => {
    const fake = fakeNotion()
    fake.add({ title: 'One', status: 'Not started' })
    return run(fake, provider =>
      Effect.gen(function* () {
        const databaseUrl = `https://www.notion.so/acme/Roadmap-${fake.databaseId.replace(/-/gu, '')}?v=1`
        const page = yield* provider.pull({ ...scopeOf(fake), container: databaseUrl, cursor: null, page: null, fields: ['title'], openOnly: false })
        expect(page.records.map(record => record.title)).toEqual(['One'])
        const wrong = yield* Effect.flip(
          provider.pull({ ...scopeOf(fake, { tagsProperty: 'Priority' }), cursor: null, page: null, fields: ['title'], openOnly: false }),
        )
        expect(wrong).toMatchObject({ code: 'target-missing' })
        expect(wrong.message).toContain('Priority')
      }),
    )
  })

  it.effect('pulls in pages with a last_edited_time checkpoint and still sees an edit within the same minute', () => {
    const fake = fakeNotion()
    for (let index = 0; index < 52; index += 1) fake.add({ title: `Item ${String(index)}`, status: 'Not started', markdown: `Body ${String(index)}` })
    return run(fake, provider =>
      Effect.gen(function* () {
        const first = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: null, fields: ['title', 'body', 'status'], openOnly: false })
        expect(first.records).toHaveLength(50)
        expect(first.records[0]).toMatchObject({ title: 'Item 0', body: 'Body 0', displayKey: 'TASK-1' })
        expect(first.checkpoint).toBeNull()
        const second = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: first.nextPage, fields: ['title', 'body', 'status'], openOnly: false })
        expect(second.records.map(record => record.title)).toEqual(['Item 50', 'Item 51'])
        expect(second).toMatchObject({ nextPage: null, checkpoint: fake.iso(52), complete: true })

        const changed = [...fake.pages.values()][3]
        if (changed === undefined) return
        yield* provider.push({ ...scopeOf(fake), key: changed.id, patch: { title: 'Renamed' } })
        const since = yield* provider.pull({ ...scopeOf(fake), cursor: second.checkpoint, page: null, fields: ['title', 'body'], openOnly: false })
        // `on_or_after` reads the checkpoint's own minute again: Notion rounds `last_edited_time` to the minute.
        expect(since.records.map(record => record.title)).toEqual(['Item 51', 'Renamed'])
        expect(since).toMatchObject({ checkpoint: fake.iso(53), complete: false })

        fake.state.sameMinute = true
        const before = since.records[0]?.version
        yield* provider.push({ ...scopeOf(fake), key: changed.id, patch: { body: 'Edited within the minute' } })
        const again = yield* provider.pull({ ...scopeOf(fake), cursor: since.checkpoint, page: null, fields: ['title', 'body'], openOnly: false })
        expect(again.records[0]?.body).toBe('Edited within the minute')
        expect(again.records[0]?.version.startsWith(fake.iso(53))).toBe(true)
        expect(again.records[0]?.version).not.toBe(before)
      }),
    )
  })

  it.effect('reads status groups, tags, priority and parent, and writes them back through the same options', () => {
    const fake = fakeNotion()
    const parent = fake.add({ title: 'Epic', status: 'In progress' })
    const child = fake.add({ title: 'Task', status: 'Not started', tags: ['Bug'], priority: 'P0', parent: parent.id })
    const canceled = fake.add({ title: 'Gone', status: 'Canceled' })
    return run(fake, provider =>
      Effect.gen(function* () {
        const read = yield* provider.fetch({ ...scopeOf(fake), key: child.id, fields: allFields })
        expect(read).toMatchObject({
          status: { category: 'todo', label: 'Not started', equivalents: ['todo', 'inbox'] },
          tags: ['Bug'],
          priority: 'urgent',
          parentKey: parent.id,
        })
        expect((yield* provider.fetch({ ...scopeOf(fake), key: parent.id, fields: allFields })).status).toEqual({
          category: 'doing',
          label: 'In progress',
          equivalents: ['doing'],
        })
        expect((yield* provider.fetch({ ...scopeOf(fake), key: canceled.id, fields: allFields })).status?.category).toBe('dropped')

        const pushed = yield* provider.push({
          ...scopeOf(fake),
          key: child.id,
          patch: { status: 'dropped', tags: ['bug', 'docs'], priority: 'high', parentKey: null },
        })
        expect(pushed).toMatchObject({ status: { category: 'dropped', label: 'Canceled' }, tags: ['Bug', 'docs'], priority: 'high', parentKey: null })
        expect(child.properties['Priority']).toMatchObject({ select: { name: 'P1' } })
        expect((yield* provider.push({ ...scopeOf(fake), key: child.id, patch: { status: 'inbox', priority: 'none' } })).status?.label).toBe('Inbox')
        expect(child.properties['Priority']).toMatchObject({ select: null })
        expect((yield* provider.push({ ...scopeOf(fake), key: child.id, patch: { status: 'done', statusLabel: 'Canceled' } })).status?.label).toBe('Canceled')

        const custom = scopeOf(fake, { statusProperty: 'Stage', priorityValues: 'urgent=Critical' })
        const staged = yield* provider.push({ ...custom, key: child.id, patch: { status: 'doing', priority: 'urgent' } })
        expect(child.properties['Stage']).toMatchObject({ select: { name: 'Doing' } })
        expect(staged).toMatchObject({ status: { category: 'doing', label: 'Doing' }, priority: 'urgent' })
      }),
    )
  })

  it.effect('round-trips the markdown body with a targeted edit, and refuses to rewrite a truncated page whole', () => {
    const fake = fakeNotion()
    const page = fake.add({ title: 'Doc', markdown: '# Plan\n\n- step one\n- step two\n\n<unknown url="https://notion.so/x#y" />' })
    const huge = fake.add({ title: 'Huge', markdown: 'same\nsame\n<unknown url="https://notion.so/a#b" />', truncated: true })
    return run(fake, provider =>
      Effect.gen(function* () {
        const read = yield* provider.fetch({ ...scopeOf(fake), key: page.id, fields: allFields })
        expect(read.body).toBe(page.markdown)
        yield* provider.push({ ...scopeOf(fake), key: page.id, patch: { body: read.body.replace('step two', 'step two, done') } })
        const edit = fake.requests.find(request => request.method === 'PATCH' && request.path.endsWith('/markdown'))
        expect(edit?.json).toEqual({
          markdown_version: 'v2',
          type: 'update_content',
          update_content: { content_updates: [{ old_str: '- step two', new_str: '- step two, done' }] },
        })
        expect(page.markdown).toContain('<unknown url="https://notion.so/x#y" />')

        const refused = yield* Effect.flip(provider.push({ ...scopeOf(fake), key: huge.id, patch: { body: 'rewritten' } }))
        expect(refused).toMatchObject({ code: 'unsupported' })
        expect(huge.markdown).toContain('same')
      }),
    )
  })

  it('chooses the smallest unique markdown edit', () => {
    expect(NotionMapping.bodyEdit({ current: 'a\nb\nc', next: 'a\nb\nc', truncated: false })).toBe('unchanged')
    expect(NotionMapping.bodyEdit({ current: 'a\nb\nc', next: 'a\nB\nc', truncated: false })).toEqual({
      type: 'update_content',
      update_content: { content_updates: [{ old_str: 'b', new_str: 'B' }] },
    })
    expect(NotionMapping.bodyEdit({ current: 'x\nx\ny', next: 'x\nz\ny', truncated: true })).toEqual({
      type: 'update_content',
      update_content: { content_updates: [{ old_str: 'x\ny', new_str: 'z\ny' }] },
    })
    expect(NotionMapping.bodyEdit({ current: '', next: 'new', truncated: false })).toEqual({ type: 'replace_content', replace_content: { new_str: 'new' } })
    expect(NotionMapping.bodyEdit({ current: 'x\n<unknown url="u" />', next: 'y', truncated: true })).toBeNull()
    expect(NotionMapping.bodyEdit({ current: 'x\n<unknown url="u" />', next: 'y\n<unknown url="u" />', truncated: false })).toEqual({
      type: 'update_content',
      update_content: { content_updates: [{ old_str: 'x', new_str: 'y' }] },
    })
    expect(NotionMapping.bodyEdit({ current: '', next: 'y', truncated: true })).toBeNull()
  })

  it.effect('reads and adds page comments', () => {
    const fake = fakeNotion()
    const page = fake.add({ title: 'Discussed' })
    return run(fake, provider =>
      Effect.gen(function* () {
        const added = yield* provider.comment({ ...scopeOf(fake), key: page.id, body: 'Looks **good**' })
        expect(added).toMatchObject({ id: 'c-1', body: 'Looks **good**', author: 'Backlog sync' })
        expect(fake.requests.at(-1)?.json).toEqual({ parent: { page_id: page.id }, markdown: 'Looks **good**', markdown_version: 'v2' })
        const read = yield* provider.fetch({ ...scopeOf(fake), key: page.id, fields: ['title'] })
        expect(read.comments?.map(comment => comment.body)).toEqual(['Looks **good**'])
      }),
    )
  })

  it.effect('waits for Retry-After on a 429, then gives up after three retries', () => {
    const fake = fakeNotion()
    fake.state.rateLimitNext = 1
    fake.state.retryAfter = '2'
    return run(fake, provider =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(provider.identity(connection))
        yield* TestClock.adjust('1 second')
        expect(fake.requests).toHaveLength(1)
        yield* TestClock.adjust('1 second')
        const identity = yield* Fiber.join(fiber)
        expect(identity.account).toBe('Backlog sync (Acme)')
        expect(fake.requests.map(request => request.path)).toEqual(['/users/me', '/users/me', '/search'])

        fake.state.rateLimitNext = 10
        fake.state.retryAfter = '1'
        const stuck = yield* Effect.forkChild(Effect.flip(provider.identity(connection)))
        yield* TestClock.adjust('10 seconds')
        expect(yield* Fiber.join(stuck)).toMatchObject({ code: 'rejected', status: 429 })
      }),
    )
  })

  it.effect('creates a page in the data source with properties and markdown, then trashes it', () => {
    const fake = fakeNotion()
    return run(fake, provider =>
      Effect.gen(function* () {
        const created = yield* provider.create({
          ...scopeOf(fake),
          patch: { title: 'From the backlog', body: 'Details', status: 'doing', tags: ['bug'], priority: 'low' },
        })
        expect(created).toMatchObject({ title: 'From the backlog', body: 'Details', status: { category: 'doing' }, tags: ['Bug'], priority: 'low' })
        const post = fake.requests.find(request => request.method === 'POST' && request.path === '/pages')
        expect(post?.json).toMatchObject({
          parent: { type: 'data_source_id', data_source_id: fake.dataSourceId },
          markdown: 'Details',
          markdown_version: 'v2',
        })

        yield* provider.remove({ ...scopeOf(fake), key: created.key })
        expect(fake.pages.get(created.key)?.inTrash).toBe(true)
        expect(fake.requests.at(-1)?.json).toEqual({ in_trash: true })
        expect((yield* provider.fetch({ ...scopeOf(fake), key: created.key, fields: ['title'] })).deleted).toBe(true)
        const page = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: null, fields: ['title'], openOnly: false })
        expect(page.records).toEqual([])
      }),
    )
  })

  it.effect('resolves notion.so URLs and bare ids, and reports a refused key with its recovery', () => {
    const fake = fakeNotion()
    const page = fake.add({ title: 'Linked' })
    const hex = page.id.replace(/-/gu, '')
    return run(fake, provider =>
      Effect.gen(function* () {
        expect((yield* provider.resolve({ ...scopeOf(fake), reference: `https://www.notion.so/acme/Linked-${hex}` })).title).toBe('Linked')
        expect((yield* provider.resolve({ ...scopeOf(fake), reference: hex })).key).toBe(page.id)
        expect((yield* Effect.flip(provider.resolve({ ...scopeOf(fake), reference: 'https://example.com/x' }))).code).toBe('not-found')
      }),
    )
  })

  it.effect('reports a refused key with its recovery and never echoes it', () => {
    const fake = fakeNotion()
    const wrongKey = NotionClient.layer({ minIntervalMs: 0 }).pipe(
      Layer.provide(Layer.mergeAll(Layer.succeed(HttpClient.HttpClient, fake.client), SecretReferenceResolver.layerTest({ resolve: async () => 'ntn_wrong' }))),
    )
    return Effect.gen(function* () {
      const provider = yield* makeNotionProvider()
      const refused = yield* Effect.flip(provider.identity(connection))
      expect(refused).toMatchObject({ code: 'rejected', status: 401 })
      expect(refused.message).toContain('check that the connection')
      expect(refused.message).not.toContain('ntn_wrong')
    }).pipe(Effect.provide(wrongKey))
  })

  it.effect('answers the backlog over its Host API with the failure code, status and recovery intact', () =>
    Effect.gen(function* () {
      const fake = fakeNotion()
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        testHost => Effect.promise(() => testHost.dispose()),
      )
      const services = (key: string) =>
        Layer.mergeAll(Layer.succeed(HttpClient.HttpClient, fake.client), SecretReferenceResolver.layerTest({ resolve: async () => key }))
      yield* Effect.promise(() =>
        host.mount(makeNotionPlugin({ services: services(fake.key), client: { minIntervalMs: 0 } }), { packageId: NotionPlugin.owner }),
      )
      const apis = yield* Effect.provide(
        HostApis,
        HostApis.layer.pipe(Layer.provide(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/backlog' })))),
      )
      const notion = apis.typed(BacklogProviders.contract(NotionPlugin.owner), { errors: [BacklogProviderFailed] })
      const missing = yield* Effect.flip(notion.resolve({ ...scopeOf(fake), reference: '0123456789abcdef0123456789abcdef' }))
      expect(missing).toBeInstanceOf(BacklogProviderFailed)
      expect(missing).toMatchObject({ provider: 'Notion', code: 'not-found' })
      expect(missing.message).toContain('Notion has no item matching that reference')
      expect(missing.message).toContain('share the page or database with the integration')
      expect(missing.message).not.toContain('refused')

      const otherHost = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        testHost => Effect.promise(() => testHost.dispose()),
      )
      yield* Effect.promise(() =>
        otherHost.mount(makeNotionPlugin({ services: services('ntn_wrong'), client: { minIntervalMs: 0 } }), { packageId: NotionPlugin.owner }),
      )
      const wrongKey = (yield* Effect.provide(
        HostApis,
        HostApis.layer.pipe(Layer.provide(Layer.succeed(HostContext, HostContext.of({ ctx: otherHost.ctx, packageId: '@dshfiles/backlog' })))),
      )).typed(BacklogProviders.contract(NotionPlugin.owner), { errors: [BacklogProviderFailed] })
      const refused = yield* Effect.flip(wrongKey.identity({ connection }))
      expect(refused).toMatchObject({ code: 'rejected', status: 401 })
      expect(refused.message).toContain("check that the connection's key is valid")
      expect(JSON.stringify(refused)).not.toContain('ntn_wrong')
    }).pipe(Effect.scoped),
  )

  it.effect('records one notion request span per call, with the operation and status only', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      const fake = fakeNotion()
      yield* run(fake, provider => provider.identity(connection))
      const span = recorder.span('notion request')
      expect(span.attributes['notion.operation']).toBe('retrieve-bot-user')
      expect(span.attributes['http.response.status_code']).toBe(200)
      expect(JSON.stringify(span.attributes)).not.toContain(fake.key)
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )
})
