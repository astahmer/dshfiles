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
import { JiraClient } from './jira-client.js'
import { fakeJira } from './jira-fake.js'
import { JiraPlugin, makeJiraPlugin } from './jira-plugin.js'
import { makeJiraProvider, JiraProvider } from './jira-provider.js'

type Fake = ReturnType<typeof fakeJira>

const connectionOf = (fake: Fake): ProviderConnection => ({
  instanceId: 'jira',
  kind: 'jira',
  label: 'Jira',
  credential: 'secret:JIRA_TOKEN',
  baseUrl: 'https://acme.atlassian.net/',
  options: { email: fake.email },
})

const services = (fake: Fake, token: string = fake.token) =>
  Layer.mergeAll(Layer.succeed(HttpClient.HttpClient, fake.client), SecretReferenceResolver.layerTest({ resolve: async () => token }))

const run = <A, E>(fake: Fake, body: (provider: Effect.Success<ReturnType<typeof makeJiraProvider>>) => Effect.Effect<A, E>, token?: string) =>
  Effect.flatMap(makeJiraProvider(), body).pipe(Effect.provide(JiraClient.layer({ minIntervalMs: 0 }).pipe(Layer.provide(services(fake, token)))))

const scopeOf = (fake: Fake, options?: ProviderScope['options']): ProviderScope => ({
  connection: connectionOf(fake),
  container: fake.project.key,
  project: null,
  ...(options !== undefined && { options }),
})

const fields = JiraProvider.allFields

describe('the Jira provider', () => {
  it.effect('names the account and discovers its projects with Basic auth, never the email', () => {
    const fake = fakeJira()
    return run(fake, provider =>
      Effect.gen(function* () {
        const identity = yield* provider.identity(connectionOf(fake))
        expect(identity).toEqual({
          account: 'Ada Lovelace',
          credentialSource: 'reference',
          containers: [{ key: 'ENG', name: 'Engineering', url: 'https://acme.atlassian.net/browse/ENG' }],
        })
        expect(fake.requests.map(request => `${request.method} ${request.path}`)).toEqual(['GET /myself', 'GET /project/search'])
        expect(fake.requests.every(request => request.authorized)).toBe(true)
        expect(JSON.stringify(identity)).not.toContain(fake.email)
      }),
    )
  })

  it.effect('refuses a missing email, a non-https site and an invalid project key before any request', () => {
    const fake = fakeJira()
    return run(fake, provider =>
      Effect.gen(function* () {
        const { options: _options, ...withoutEmail } = connectionOf(fake)
        expect(yield* Effect.flip(provider.identity(withoutEmail))).toMatchObject({ code: 'credential-missing' })
        const plain = yield* Effect.flip(provider.identity({ ...connectionOf(fake), baseUrl: 'http://acme.atlassian.net' }))
        expect(plain).toMatchObject({ code: 'target-missing' })
        expect(plain.message).toContain('https')
        const project = yield* Effect.flip(provider.pull({ ...scopeOf(fake), container: 'eng; DROP', cursor: null, page: null, fields, openOnly: false }))
        expect(project).toMatchObject({ code: 'target-missing' })
        const key = yield* Effect.flip(provider.fetch({ ...scopeOf(fake), key: '../myself', fields }))
        expect(key).toMatchObject({ code: 'not-found' })
        expect(fake.requests).toEqual([])
      }),
    )
  })

  it.effect('pulls in pages with an updated checkpoint read in the account time zone, and still sees an edit within the same minute', () => {
    const fake = fakeJira()
    for (let index = 0; index < 52; index += 1) fake.add({ summary: `Issue ${String(index)}`, description: `Body ${String(index)}` })
    return run(fake, provider =>
      Effect.gen(function* () {
        const first = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: null, fields, openOnly: false })
        expect(first.records).toHaveLength(50)
        expect(first.records[0]).toMatchObject({ title: 'Issue 0', body: 'Body 0', displayKey: 'ENG-1', url: 'https://acme.atlassian.net/browse/ENG-1' })
        expect(first.checkpoint).toBeNull()
        const search = fake.requests.find(request => request.path === '/search/jql')
        expect(search?.json).toMatchObject({ jql: 'project = "ENG" ORDER BY updated ASC, key ASC', maxResults: 50 })
        const second = yield* provider.pull({ ...scopeOf(fake), cursor: null, page: first.nextPage, fields, openOnly: false })
        expect(second.records.map(record => record.title)).toEqual(['Issue 50', 'Issue 51'])
        expect(second).toMatchObject({ nextPage: null, checkpoint: String(fake.minute(52)), complete: true })

        const changed = [...fake.issues.values()][3]
        if (changed === undefined) return
        yield* provider.push({ ...scopeOf(fake), key: changed.id, patch: { title: 'Renamed' } })
        const since = yield* provider.pull({ ...scopeOf(fake), cursor: second.checkpoint, page: null, fields, openOnly: false })
        // Minute 52 is 00:52 UTC: 06:22 in Asia/Kolkata, where JQL reads it.
        expect(fake.requests.at(-1)?.json).toMatchObject({ jql: 'project = "ENG" AND updated >= "2026-01-01 06:22" ORDER BY updated ASC, key ASC' })
        expect(since.records.map(record => record.title)).toEqual(['Issue 51', 'Renamed'])
        expect(since).toMatchObject({ checkpoint: String(fake.minute(53)), complete: false })

        fake.state.sameMinute = true
        const before = since.records[1]?.version
        yield* provider.push({ ...scopeOf(fake), key: changed.id, patch: { body: 'Edited within the minute' } })
        const again = yield* provider.pull({ ...scopeOf(fake), cursor: since.checkpoint, page: null, fields, openOnly: false })
        expect(again.records.map(record => record.body)).toEqual(['Edited within the minute'])
        expect(again.records[0]?.version).not.toBe(before)
      }),
    )
  })

  it.effect('reads and writes priority, labels, parent, links and the due date', () => {
    const fake = fakeJira()
    const epic = fake.add({ summary: 'Epic', issuetype: 'Epic' })
    const blocker = fake.add({ summary: 'Blocker' })
    const other = fake.add({ summary: 'Other' })
    const task = fake.add({ summary: 'Task', labels: ['backend'], priority: 'Highest', parent: epic.id, duedate: '2026-02-01', issuetype: 'Bug' })
    fake.link({ type: 'Blocks', source: blocker.id, destination: task.id })
    fake.link({ type: 'Relates', source: task.id, destination: other.id })
    fake.link({ type: 'Cloners', source: task.id, destination: other.id })
    return run(fake, provider =>
      Effect.gen(function* () {
        const read = yield* provider.fetch({ ...scopeOf(fake), key: task.key, fields })
        expect(read).toMatchObject({
          key: task.id,
          displayKey: 'ENG-4',
          kind: 'bug',
          tags: ['backend'],
          priority: 'urgent',
          parentKey: epic.id,
          due: '2026-02-01',
          relations: [
            { relation: 'depends-on', key: blocker.id },
            { relation: 'related', key: other.id },
          ],
        })
        expect((yield* provider.fetch({ ...scopeOf(fake), key: blocker.key, fields })).relations).toEqual([{ relation: 'blocks', key: task.id }])

        const pushed = yield* provider.push({
          ...scopeOf(fake),
          key: task.id,
          patch: {
            tags: ['needs review', 'backend'],
            priority: 'low',
            parentKey: null,
            due: null,
            relations: [
              { relation: 'blocks', key: other.id },
              { relation: 'duplicates', key: blocker.id },
            ],
          },
        })
        expect(pushed).toMatchObject({ tags: ['needs-review', 'backend'], priority: 'low', parentKey: null, due: null })
        expect(pushed.relations).toEqual(
          expect.arrayContaining([
            { relation: 'blocks', key: other.id },
            { relation: 'duplicates', key: blocker.id },
          ]),
        )
        expect(pushed.relations).toHaveLength(2)
        expect([...fake.links.values()].map(link => `${link.type} ${link.source}->${link.destination}`)).toEqual(
          expect.arrayContaining([`Cloners ${task.id}->${other.id}`, `Blocks ${task.id}->${other.id}`, `Duplicate ${task.id}->${blocker.id}`]),
        )
        const edit = fake.requests.find(request => request.method === 'PUT')
        expect(edit?.json).toEqual({
          fields: { labels: ['needs-review', 'backend'], priority: { name: 'Low' }, duedate: null },
          update: { parent: [{ set: { none: true } }] },
        })
        expect(edit?.query).toEqual({ notifyUsers: 'false' })

        const mapped = yield* provider.push({
          ...scopeOf(fake, { priorityValues: 'urgent=P0' }),
          key: task.id,
          patch: { priority: 'urgent', parentKey: epic.key, due: '2026-03-15' },
        })
        expect(task).toMatchObject({ priority: 'P0', parent: epic.id, duedate: '2026-03-15' })
        expect(mapped).toMatchObject({ priority: 'urgent', parentKey: epic.id, due: '2026-03-15' })
      }),
    )
  })

  it.effect('moves status through transitions: direct, two hops, a named status, and refuses an unreachable one', () => {
    const fake = fakeJira()
    const issue = fake.add({ summary: 'Flow' })
    const stuck = fake.add({ summary: 'Archived', status: 'archived' })
    return run(fake, provider =>
      Effect.gen(function* () {
        expect((yield* provider.fetch({ ...scopeOf(fake), key: issue.id, fields })).status).toEqual({
          category: 'todo',
          label: 'Backlog',
          equivalents: ['todo', 'inbox'],
        })
        expect((yield* provider.push({ ...scopeOf(fake), key: issue.id, patch: { status: 'doing' } })).status).toEqual(
          BacklogProviders.exactStatus('doing', 'In Progress'),
        )
        expect((yield* provider.push({ ...scopeOf(fake), key: issue.id, patch: { status: 'doing', statusLabel: 'In Review' } })).status?.label).toBe(
          'In Review',
        )
        expect((yield* provider.push({ ...scopeOf(fake), key: issue.id, patch: { status: 'todo' } })).status?.label).toBe('Backlog')

        fake.requests.length = 0
        yield* provider.push({ ...scopeOf(fake), key: issue.id, patch: { status: 'inbox' } })
        expect(issue.status.name).toBe('Backlog')
        const done = yield* provider.push({ ...scopeOf(fake), key: issue.id, patch: { status: 'done' } })
        expect(done.status).toEqual(BacklogProviders.exactStatus('done', 'Done'))
        expect(
          fake.requests.filter(request => request.method === 'POST' && request.path.endsWith('/transitions')).map(request => JSON.stringify(request.json)),
        ).toEqual(['{"transition":{"id":"11"}}', '{"transition":{"id":"22"}}'])

        const refused = yield* Effect.flip(provider.push({ ...scopeOf(fake), key: stuck.id, patch: { status: 'todo' } }))
        expect(refused).toMatchObject({ code: 'unsupported' })
        expect(refused.message).toContain('no transition from “Archived” reaches a todo status')
        expect(refused.message).toContain('remote status name for todo')
      }),
    )
  })

  it.effect('converts the description and comments between ADF and markdown, and never re-sends an equivalent body', () => {
    const fake = fakeJira()
    const issue = fake.add({
      summary: 'Doc',
      description: {
        version: 1,
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'step', marks: [{ type: 'strong' }] }] }] }],
          },
          { type: 'panel', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note' }] }] },
        ],
      },
    })
    return run(fake, provider =>
      Effect.gen(function* () {
        const read = yield* provider.fetch({ ...scopeOf(fake), key: issue.key, fields })
        expect(read.body).toBe('## Plan\n\n- **step**\n\nnote')
        fake.requests.length = 0
        yield* provider.push({ ...scopeOf(fake), key: issue.id, patch: { body: '## Plan\n\n* **step**\n\nnote' } })
        expect(fake.requests.some(request => request.method === 'PUT')).toBe(false)
        yield* provider.push({ ...scopeOf(fake), key: issue.id, patch: { body: 'New *text*' } })
        expect(fake.requests.find(request => request.method === 'PUT')?.json).toEqual({
          fields: {
            description: {
              version: 1,
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'New ' },
                    { type: 'text', text: 'text', marks: [{ type: 'em' }] },
                  ],
                },
              ],
            },
          },
        })

        const added = yield* provider.comment({ ...scopeOf(fake), key: issue.id, body: 'Looks **good**' })
        expect(added).toMatchObject({ body: 'Looks **good**', author: 'Ada Lovelace' })
        expect(fake.requests.at(-1)?.json).toEqual({
          body: {
            version: 1,
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Looks ' },
                  { type: 'text', text: 'good', marks: [{ type: 'strong' }] },
                ],
              },
            ],
          },
        })
        expect((yield* provider.fetch({ ...scopeOf(fake), key: issue.id, fields })).comments?.map(comment => comment.body)).toEqual(['Looks **good**'])
      }),
    )
  })

  it.effect('maps acceptance criteria and a summary to the custom fields the binding names', () => {
    const fake = fakeJira()
    const issue = fake.add({
      summary: 'Criteria',
      custom: {
        customfield_10050: {
          version: 1,
          type: 'doc',
          content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [{ type: 'text', text: 'Ships' }] }] }],
        },
        customfield_10051: 'Plain summary',
      },
    })
    const options = { criteriaField: 'customfield_10050', summaryField: 'customfield_10051' }
    return run(fake, provider =>
      Effect.gen(function* () {
        expect(yield* provider.fetch({ ...scopeOf(fake, options), key: issue.id, fields })).toMatchObject({
          criteria: [{ text: 'Ships', done: true }],
          summary: 'Plain summary',
        })
        const pushed = yield* provider.push({
          ...scopeOf(fake, options),
          key: issue.id,
          patch: {
            criteria: [
              { text: 'Ships', done: true },
              { text: 'Documented', done: false },
            ],
            summary: 'Shipped it',
          },
        })
        expect(pushed).toMatchObject({
          criteria: [
            { text: 'Ships', done: true },
            { text: 'Documented', done: false },
          ],
          summary: 'Shipped it',
        })
        expect(issue.custom['customfield_10051']).toBe('Shipped it')
        expect(fake.requests.find(request => request.method === 'PUT')?.json).toMatchObject({
          fields: { customfield_10050: { type: 'doc', content: [{ type: 'bulletList' }] } },
        })
        const wrong = yield* Effect.flip(provider.fetch({ ...scopeOf(fake, { criteriaField: 'Acceptance' }), key: issue.id, fields }))
        expect(wrong).toMatchObject({ code: 'target-missing' })
      }),
    )
  })

  it.effect('creates an issue in the project with its fields and status, then archives it through a transition', () => {
    const fake = fakeJira()
    const epic = fake.add({ summary: 'Epic' })
    return run(fake, provider =>
      Effect.gen(function* () {
        const created = yield* provider.create({
          ...scopeOf(fake, { issueType: 'Story' }),
          patch: { title: 'From the backlog', body: 'Details', status: 'doing', tags: ['bug fix'], priority: 'high', parentKey: epic.id, due: '2026-04-01' },
        })
        expect(created).toMatchObject({
          title: 'From the backlog',
          body: 'Details',
          status: { category: 'doing', label: 'In Progress' },
          tags: ['bug-fix'],
          priority: 'high',
          parentKey: epic.id,
          due: '2026-04-01',
        })
        expect(fake.requests.find(request => request.method === 'POST' && request.path === '/issue')?.json).toMatchObject({
          fields: { project: { key: 'ENG' }, issuetype: { name: 'Story' }, summary: 'From the backlog', parent: { id: epic.id } },
        })

        // Won't Do is only reachable from Backlog: from In Progress a dropped item falls back to Done.
        const progressing = fake.add({ summary: 'Dropped while in progress', status: 'progress' })
        yield* provider.remove({ ...scopeOf(fake), key: progressing.key })
        expect(progressing.status.name).toBe('Done')
        yield* provider.push({ ...scopeOf(fake), key: created.key, patch: { status: 'todo' } })
        expect(fake.issues.get(created.key)?.status.name).toBe('Backlog')
        yield* provider.remove({ ...scopeOf(fake), key: created.key })
        expect(fake.issues.get(created.key)?.status.name).toBe("Won't Do")
        expect((yield* provider.fetch({ ...scopeOf(fake), key: created.key, fields })).status?.category).toBe('dropped')

        const second = fake.add({ summary: 'Archive by name', status: 'progress' })
        yield* provider.remove({ ...scopeOf(fake, { archiveStatus: 'Done' }), key: second.key })
        expect(second.status.name).toBe('Done')
      }),
    )
  })

  it.effect('resolves issue keys and site URLs, and refuses anything else without a request', () => {
    const fake = fakeJira()
    const issue = fake.add({ summary: 'Linked' })
    return run(fake, provider =>
      Effect.gen(function* () {
        expect((yield* provider.resolve({ ...scopeOf(fake), reference: 'eng-1' })).key).toBe(issue.id)
        expect((yield* provider.resolve({ ...scopeOf(fake), reference: 'https://acme.atlassian.net/browse/ENG-1' })).title).toBe('Linked')
        expect(
          (yield* provider.resolve({ ...scopeOf(fake), reference: 'https://acme.atlassian.net/jira/software/projects/ENG/boards/1?selectedIssue=ENG-1' }))
            .title,
        ).toBe('Linked')
        const before = fake.requests.length
        expect((yield* Effect.flip(provider.resolve({ ...scopeOf(fake), reference: 'https://example.com/ENG-1/../x' }))).code).toBe('not-found')
        expect(fake.requests).toHaveLength(before)
        const missing = yield* Effect.flip(provider.resolve({ ...scopeOf(fake), reference: 'ENG-99' }))
        expect(missing).toMatchObject({ code: 'not-found' })
        expect(missing.message).toContain('check the key and that the account can browse its project')
        expect(BacklogProviders.recognizes(JiraProvider.descriptor, 'https://acme.atlassian.net/browse/ENG-1')).toBe(true)
        expect(BacklogProviders.recognizes(JiraProvider.descriptor, 'ENG-12')).toBe(true)
        expect(BacklogProviders.recognizes(JiraProvider.descriptor, 'https://evil.example/browse/ENG-1')).toBe(false)
      }),
    )
  })

  it.effect('waits for Retry-After on a 429, then gives up after three retries', () => {
    const fake = fakeJira()
    fake.state.rateLimitNext = 1
    fake.state.retryAfter = '2'
    return run(fake, provider =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(provider.identity(connectionOf(fake)))
        yield* TestClock.adjust('1 second')
        expect(fake.requests).toHaveLength(1)
        yield* TestClock.adjust('1 second')
        expect((yield* Fiber.join(fiber)).account).toBe('Ada Lovelace')
        expect(fake.requests.map(request => request.path)).toEqual(['/myself', '/myself', '/project/search'])

        fake.state.rateLimitNext = 10
        fake.state.retryAfter = '1'
        const stuck = yield* Effect.forkChild(Effect.flip(provider.identity(connectionOf(fake))))
        yield* TestClock.adjust('10 seconds')
        const failure = yield* Fiber.join(stuck)
        expect(failure).toMatchObject({ code: 'rejected', status: 429 })
        expect(failure.message).toContain('rate-limited')
      }),
    )
  })

  it.effect('reports a refused token with its recovery and never echoes the token or the email', () => {
    const fake = fakeJira()
    return run(
      fake,
      provider =>
        Effect.gen(function* () {
          const refused = yield* Effect.flip(provider.identity(connectionOf(fake)))
          expect(refused).toMatchObject({ code: 'rejected', status: 401 })
          expect(refused.message).toContain("check that the connection's key is valid")
          expect(`${refused.message}${JSON.stringify(refused)}`).not.toContain('jira_wrong_token')
          expect(`${refused.message}${JSON.stringify(refused)}`).not.toContain(fake.email)
        }),
      'jira_wrong_token',
    )
  })

  it.effect('answers the backlog over its Host API with the failure code and status intact', () =>
    Effect.gen(function* () {
      const fake = fakeJira()
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        testHost => Effect.promise(() => testHost.dispose()),
      )
      yield* Effect.promise(() => host.mount(makeJiraPlugin({ services: services(fake), client: { minIntervalMs: 0 } }), { packageId: JiraPlugin.owner }))
      const apis = yield* Effect.provide(
        HostApis,
        HostApis.layer.pipe(Layer.provide(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/backlog' })))),
      )
      const jira = apis.typed(BacklogProviders.contract(JiraPlugin.owner), { errors: [BacklogProviderFailed] })
      expect((yield* jira.describe({})).providers.map(provider => provider.kind)).toEqual(['jira'])
      const missing = yield* Effect.flip(jira.resolve({ ...scopeOf(fake), reference: 'ENG-404' }))
      expect(missing).toBeInstanceOf(BacklogProviderFailed)
      expect(missing).toMatchObject({ provider: 'Jira', code: 'not-found' })
    }).pipe(Effect.scoped),
  )

  it.effect('records one jira request span per call, with the operation and status only', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      const fake = fakeJira()
      yield* run(fake, provider => provider.identity(connectionOf(fake)))
      const span = recorder.span('jira request')
      expect(span.attributes['jira.operation']).toBe('get-myself')
      expect(span.attributes['http.response.status_code']).toBe(200)
      const attributes = JSON.stringify(span.attributes)
      expect(attributes).not.toContain(fake.token)
      expect(attributes).not.toContain(fake.email)
      expect(attributes).not.toContain('atlassian.net')
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )
})
