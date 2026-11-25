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
import { GiteaClient } from './gitea-client.js'
import { fakeGitea } from './gitea-fake.js'
import { GiteaMapping } from './gitea-mapping.js'
import { GiteaPlugin, makeGiteaPlugin } from './gitea-plugin.js'
import { GiteaProvider, makeGiteaProvider } from './gitea-provider.js'

type Fake = ReturnType<typeof fakeGitea>

const connectionOf = (fake: Fake, baseUrl = `${fake.site}/`): ProviderConnection => ({
  instanceId: 'gitea',
  kind: 'gitea',
  label: 'Gitea',
  credential: 'secret:GITEA_TOKEN',
  baseUrl,
})

const services = (fake: Fake, token: string = fake.token) =>
  Layer.mergeAll(Layer.succeed(HttpClient.HttpClient, fake.client), SecretReferenceResolver.layerTest({ resolve: async () => token }))

const run = <A, E>(fake: Fake, body: (provider: Effect.Success<ReturnType<typeof makeGiteaProvider>>) => Effect.Effect<A, E>, token?: string) =>
  Effect.flatMap(makeGiteaProvider(), body).pipe(Effect.provide(GiteaClient.layer.pipe(Layer.provide(services(fake, token)))))

const scopeOf = (fake: Fake, options?: ProviderScope['options']): ProviderScope => ({
  connection: connectionOf(fake),
  container: fake.repository,
  project: null,
  ...(options !== undefined && { options }),
})

const fields = GiteaProvider.allFields

describe('the Gitea provider', () => {
  it.effect('names the account and discovers repositories with issues, and still works without read:user', () => {
    const fake = fakeGitea()
    return run(fake, provider =>
      Effect.gen(function* () {
        const identity = yield* provider.identity(connectionOf(fake))
        expect(identity).toEqual({
          account: 'ada',
          credentialSource: 'reference',
          containers: [{ key: 'acme/app', name: 'acme/app', url: 'https://git.example.com/acme/app' }],
        })
        expect(fake.requests.every(request => request.authorized)).toBe(true)
        fake.state.userScope = false
        const limited = yield* provider.identity(connectionOf(fake))
        expect(limited.account).toBe('token without read:user scope')
        expect(limited.containers).toHaveLength(1)
      }),
    )
  })

  it.effect('accepts the base URL with /api/v1, and refuses public plain http, a bad repository and a foreign reference before any request', () => {
    const fake = fakeGitea()
    return run(fake, provider =>
      Effect.gen(function* () {
        yield* provider.identity(connectionOf(fake, `${fake.site}/api/v1/`))
        expect(fake.requests[0]?.path).toBe('/user')
        fake.requests.length = 0
        const plain = yield* Effect.flip(provider.identity(connectionOf(fake, 'http://git.example.com')))
        expect(plain).toMatchObject({ code: 'target-missing' })
        expect(plain.message).toContain('https')
        const repository = yield* Effect.flip(provider.pull({ ...scopeOf(fake), container: '../admin', cursor: null, page: null, fields, openOnly: false }))
        expect(repository).toMatchObject({ code: 'target-missing' })
        const foreign = yield* Effect.flip(provider.resolve({ ...scopeOf(fake), reference: 'https://evil.example/acme/app/issues/1' }))
        expect(foreign).toMatchObject({ code: 'not-found' })
        const traversal = yield* Effect.flip(provider.fetch({ ...scopeOf(fake), key: 'acme/app#1/../../admin', fields }))
        expect(traversal).toMatchObject({ code: 'not-found' })
        expect(fake.requests).toEqual([])
      }),
    )
  })

  it.effect('asks for the instance URL by name, requires it, and reads a bare host as https', () => {
    const fake = fakeGitea()
    expect(BacklogProviders.baseUrlField(GiteaProvider.descriptor)).toEqual({ label: 'Instance URL', placeholder: 'https://gitea.example.com', required: true })
    return run(fake, provider =>
      Effect.gen(function* () {
        const missing = yield* Effect.flip(provider.identity(connectionOf(fake, '  ')))
        expect(missing).toMatchObject({ code: 'target-missing' })
        expect(missing.message).toContain('instance URL')
        expect(fake.requests).toEqual([])
        const bare = yield* provider.identity(connectionOf(fake, 'git.example.com'))
        expect(bare.account).toBe('ada')
        expect(fake.requests[0]?.path).toBe('/user')
      }),
    )
  })

  it('allows plain http only for private hosts', () => {
    for (const host of ['git.corp.internal', '100.101.102.103', '10.0.0.4', '192.168.1.2', 'localhost', 'box.example-tailnet.ts.net', 'nas.local'])
      expect(GiteaClient.isPrivateHost(host), host).toBe(true)
    for (const host of ['git.example.com', '8.8.8.8', '100.200.0.1', 'internal.example.com']) expect(GiteaClient.isPrivateHost(host), host).toBe(false)
  })

  it.effect('pulls every page whatever the order, skips pull requests, and checkpoints the newest update', () => {
    const fake = fakeGitea()
    for (let index = 0; index < 52; index += 1) fake.add({ title: `Issue ${String(index)}`, body: `Body ${String(index)}`, labels: index === 0 ? ['Bug'] : [] })
    fake.add({ title: 'A pull request', isPull: true })
    return run(fake, provider =>
      Effect.gen(function* () {
        const first = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: null, fields: ['title'], openOnly: false })
        expect(first.records).toHaveLength(50)
        expect(first.checkpoint).toBeNull()
        expect(fake.requests.at(-1)?.query).toMatchObject({ state: 'all', type: 'issues', limit: '50', page: '1' })
        const second = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: first.nextPage, fields: ['title'], openOnly: false })
        const all = [...first.records, ...second.records]
        expect(all.map(record => record.title).sort()).toHaveLength(52)
        expect(all.some(record => record.title === 'A pull request')).toBe(false)
        const bug = all.find(record => record.title === 'Issue 0')
        expect(bug).toMatchObject({ key: 'acme/app#1', displayKey: 'acme/app#1', url: 'https://git.example.com/acme/app/issues/1', tags: ['bug'] })
        expect(bug?.status).toEqual({ category: 'todo', label: 'open', equivalents: ['inbox', 'todo', 'doing'] })
        expect(second.nextPage).toBeNull()
        // The pull request (minute 53) is filtered out by type=issues, so the newest issue is minute 52.
        expect(second.checkpoint).toBe(new Date(fake.minute(52)).toISOString())

        const changed = fake.issues.get(4)
        if (changed === undefined) return
        yield* provider.push({ ...scopeOf(fake), key: 'acme/app#4', patch: { title: 'Renamed', status: 'done' } })
        const since = yield* provider.pull({ ...scopeOf(fake), cursor: second.checkpoint, page: null, fields: ['title'], openOnly: false })
        expect(fake.requests.findLast(request => request.path === '/repos/acme/app/issues')?.query['since']).toBe(second.checkpoint)
        // `since` is inclusive: the issue at the checkpoint comes back once with an unchanged version, so no same-second edit is lost.
        expect(since.records.map(record => record.title)).toEqual(['Renamed', 'Issue 51'])
        expect(since.records[1]?.version).toBe(all.find(record => record.title === 'Issue 51')?.version)
        expect(since.records[0]?.status).toEqual({ category: 'done', label: 'closed', equivalents: ['done', 'dropped'] })
        const open = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: null, fields: ['title'], openOnly: true })
        expect(fake.requests.at(-1)?.query['state']).toBe('open')
        expect(open.records.some(record => record.title === 'Renamed')).toBe(false)
      }),
    )
  })

  it.effect('writes title, body, status and labels, creating a missing label unless the binding says no', () => {
    const fake = fakeGitea()
    fake.label('Backend')
    const issue = fake.add({ title: 'Task' })
    return run(fake, provider =>
      Effect.gen(function* () {
        const record = yield* provider.push({
          ...scopeOf(fake),
          key: 'acme/app#1',
          patch: { body: 'New body', status: 'dropped', tags: ['backend', 'urgent'] },
        })
        expect(record).toMatchObject({ body: 'New body', tags: ['backend', 'urgent'], status: { category: 'done' } })
        expect(issue.state).toBe('closed')
        expect([...fake.labels.values()].map(label => label.name)).toEqual(['Backend', 'urgent'])
        const created = fake.requests.find(request => request.method === 'POST' && request.path === '/repos/acme/app/labels')
        expect(created?.json).toMatchObject({ name: 'urgent', color: GiteaMapping.labelColor('urgent') })

        const strict = yield* provider.push({ ...scopeOf(fake, { createLabels: 'no' }), key: '#1', patch: { tags: ['backend', 'new-one'], status: 'doing' } })
        expect(strict.tags).toEqual(['backend'])
        expect(strict.status?.category).toBe('todo')
        expect([...fake.labels.values()].map(label => label.name)).not.toContain('new-one')
      }),
    )
  })

  it.effect('reads and writes dependencies as depends-on and blocks, and reads none when dependencies are off', () => {
    const fake = fakeGitea()
    const task = fake.add({ title: 'Task' })
    const blocker = fake.add({ title: 'Blocker' })
    const follower = fake.add({ title: 'Follower' })
    task.dependsOn.add(blocker.number)
    return run(fake, provider =>
      Effect.gen(function* () {
        const read = yield* provider.fetch({ ...scopeOf(fake), key: 'acme/app#1', fields })
        expect(read.relations).toEqual([{ relation: 'depends-on', key: 'acme/app#2' }])
        const written = yield* provider.push({
          ...scopeOf(fake),
          key: 'acme/app#1',
          patch: { relations: [{ relation: 'blocks', key: 'acme/app#3' }] },
        })
        expect(written.relations).toEqual([{ relation: 'blocks', key: 'acme/app#3' }])
        expect(task.dependsOn.size).toBe(0)
        expect(follower.dependsOn.has(task.number)).toBe(true)
        const removal = fake.requests.find(request => request.method === 'DELETE')
        expect(removal).toMatchObject({ path: '/repos/acme/app/issues/1/dependencies', json: { owner: 'acme', repo: 'app', index: 2 } })

        fake.state.dependenciesEnabled = false
        expect((yield* provider.fetch({ ...scopeOf(fake), key: 'acme/app#1', fields })).relations).toEqual([])
        const page = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: null, fields, openOnly: false })
        expect(page.records.every(record => (record.relations ?? []).length === 0)).toBe(true)
      }),
    )
  })

  it.effect('creates an issue with its labels, kind and closed state, then its dependencies, in the only repository when the binding names none', () => {
    const fake = fakeGitea()
    fake.add({ title: 'Existing' })
    return run(fake, provider =>
      Effect.gen(function* () {
        const created = yield* provider.create({ ...scopeOf(fake), patch: { title: 'New', body: 'Details', tags: ['ops'], kind: 'bug', status: 'done' } })
        expect(created).toMatchObject({ key: 'acme/app#2', title: 'New', body: 'Details', status: { category: 'done' } })
        expect([...created.tags].sort()).toEqual(['bug', 'ops'])
        expect(fake.requests.find(request => request.method === 'POST' && request.path === '/repos/acme/app/issues')?.json).toMatchObject({ closed: true })

        const linked = yield* provider.create({ ...scopeOf(fake), patch: { title: 'Linked', relations: [{ relation: 'depends-on', key: 'acme/app#1' }] } })
        expect(linked.relations).toEqual([{ relation: 'depends-on', key: 'acme/app#1' }])
        // No repository on the binding: the only repository with issues the token sees, else a request to pick one.
        const defaulted = yield* provider.create({ ...scopeOf(fake), container: '', patch: { title: 'Defaulted' } })
        expect(defaulted.key).toBe('acme/app#4')
        fake.state.secondRepository = true
        const ambiguous = yield* Effect.flip(provider.create({ ...scopeOf(fake), container: '', patch: { title: 'Nowhere' } }))
        expect(ambiguous).toMatchObject({ code: 'target-missing' })
        expect(ambiguous.message).toContain('sees 2 repositories')
      }),
    )
  })

  it.effect('reads comments with fetch and adds one', () => {
    const fake = fakeGitea()
    fake.add({ title: 'Task' })
    return run(fake, provider =>
      Effect.gen(function* () {
        const comment = yield* provider.comment({ ...scopeOf(fake), key: 'acme/app#1', body: 'Looks good' })
        expect(comment).toMatchObject({ body: 'Looks good', author: 'ada' })
        const record = yield* provider.fetch({ ...scopeOf(fake), key: 'acme/app#1', fields })
        expect(record.comments?.map(entry => entry.body)).toEqual(['Looks good'])
      }),
    )
  })

  it.effect('resolves numbers, owner/repo#n and issue URLs on the instance, and refuses pull requests', () => {
    const fake = fakeGitea()
    fake.add({ title: 'First' })
    fake.add({ title: 'A pull', isPull: true })
    return run(fake, provider =>
      Effect.gen(function* () {
        for (const reference of ['1', '#1', 'acme/app#1', 'https://git.example.com/acme/app/issues/1'])
          expect((yield* provider.resolve({ ...scopeOf(fake), reference })).title, reference).toBe('First')
        expect((yield* Effect.flip(provider.resolve({ ...scopeOf(fake), reference: '#2' }))).code).toBe('not-found')
        const missing = yield* Effect.flip(provider.resolve({ ...scopeOf(fake), reference: '#99' }))
        expect(missing.message).toContain('check the repository and number')
        expect(BacklogProviders.recognizes(GiteaProvider.descriptor, 'acme/app#12')).toBe(true)
        expect(BacklogProviders.recognizes(GiteaProvider.descriptor, 'http://git.corp.internal/team/sdk/issues/3')).toBe(true)
        expect(BacklogProviders.recognizes(GiteaProvider.descriptor, 'ENG-12')).toBe(false)
      }),
    )
  })

  it.effect('waits for Retry-After on a 429, then gives up after three retries', () => {
    const fake = fakeGitea()
    fake.state.rateLimitNext = 1
    fake.state.retryAfter = '2'
    return run(fake, provider =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(provider.identity(connectionOf(fake)))
        yield* TestClock.adjust('2 seconds')
        expect((yield* Fiber.join(fiber)).account).toBe('ada')
        expect(fake.requests.map(request => request.path).slice(0, 2)).toEqual(['/user', '/user'])

        fake.state.rateLimitNext = 10
        fake.state.retryAfter = '1'
        const stuck = yield* Effect.forkChild(Effect.flip(provider.identity(connectionOf(fake))))
        yield* TestClock.adjust('10 seconds')
        const failure = yield* Fiber.join(stuck)
        expect(failure).toMatchObject({ code: 'rejected', status: 429 })
      }),
    )
  })

  it.effect('reports a refused token with its recovery and never echoes the token', () => {
    const fake = fakeGitea()
    return run(
      fake,
      provider =>
        Effect.gen(function* () {
          const refused = yield* Effect.flip(provider.identity(connectionOf(fake)))
          expect(refused).toMatchObject({ code: 'rejected', status: 401 })
          expect(refused.message).toContain("check that the connection's key is valid")
          expect(`${refused.message}${JSON.stringify(refused)}`).not.toContain('gitea_wrong_token')
        }),
      'gitea_wrong_token',
    )
  })

  it.effect('answers the backlog over its Host API with the failure code intact', () =>
    Effect.gen(function* () {
      const fake = fakeGitea()
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        testHost => Effect.promise(() => testHost.dispose()),
      )
      yield* Effect.promise(() => host.mount(makeGiteaPlugin({ services: services(fake) }), { packageId: GiteaPlugin.owner }))
      const apis = yield* Effect.provide(
        HostApis,
        HostApis.layer.pipe(Layer.provide(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/backlog' })))),
      )
      const gitea = apis.typed(BacklogProviders.contract(GiteaPlugin.owner), { errors: [BacklogProviderFailed] })
      expect((yield* gitea.describe({})).providers.map(provider => provider.kind)).toEqual(['gitea'])
      const missing = yield* Effect.flip(gitea.resolve({ ...scopeOf(fake), reference: '#404' }))
      expect(missing).toBeInstanceOf(BacklogProviderFailed)
      expect(missing).toMatchObject({ provider: 'Gitea', code: 'not-found' })
    }).pipe(Effect.scoped),
  )

  it.effect('records one gitea request span per call, with the operation and status only', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      const fake = fakeGitea()
      yield* run(fake, provider => provider.identity(connectionOf(fake)))
      const span = recorder.span('gitea request')
      expect(span.attributes['gitea.operation']).toBe('get-user')
      expect(span.attributes['http.response.status_code']).toBe(200)
      const attributes = JSON.stringify(span.attributes)
      expect(attributes).not.toContain(fake.token)
      expect(attributes).not.toContain('git.example.com')
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )
})
