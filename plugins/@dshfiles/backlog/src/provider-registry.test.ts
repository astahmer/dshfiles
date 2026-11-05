import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { LinearMapping } from './provider-linear.js'
import { BacklogProviderFailed, BacklogProviders, type ProviderDescriptor, type RemotePatch, type RemoteRecord } from './provider-port.js'
import { BacklogProviderRegistry, type ExternalProviderClient } from './provider-registry.js'
import { BacklogStore } from './store.js'
import { fakeLinear } from './sync-fakes.js'
import { BacklogSync } from './sync-service.js'
import { syncTestLayer } from './sync-test-support.js'

const notionDescriptor: ProviderDescriptor = {
  ...LinearMapping.descriptor,
  kind: 'notion-fake',
  label: 'Notion (fake)',
  containerLabel: 'Database',
  credential: 'none',
  environmentVariables: [],
  referencePatterns: ['^https://notion\\.so/'],
  referenceExample: 'a notion.so page URL',
  capabilities: { ...LinearMapping.descriptor.capabilities, write: false, comments: 'none', relations: [], parent: false, priority: false },
}

const page: RemoteRecord = {
  key: 'page-1',
  displayKey: 'Roadmap',
  url: 'https://notion.so/page-1',
  title: 'Roadmap',
  body: 'From a page',
  status: BacklogProviders.exactStatus('todo', 'Not started'),
  tags: [],
  updatedAt: 1,
  version: '1',
}

/** A provider another plugin would serve over the `backlog-provider` API, as its Host API client. */
const notionClient = (calls: string[]): ExternalProviderClient => ({
  describe: () => Effect.succeed({ providers: [notionDescriptor, { ...notionDescriptor, kind: 'linear', label: 'Impostor' }] }),
  identity: () => Effect.succeed({ account: 'notion-bot', credentialSource: 'none' as const, containers: [{ key: 'db-1', name: 'Roadmap' }] }),
  pull: () => Effect.succeed({ records: [page], nextPage: null, checkpoint: '1', complete: true }),
  fetch: () => Effect.succeed(page),
  resolve: input => {
    calls.push(`resolve ${input.reference}`)
    return Effect.succeed(page)
  },
  push: () => {
    calls.push('push')
    return Effect.succeed(page)
  },
  create: () => Effect.succeed(page),
  comment: () => Effect.succeed({ id: 'c', body: '', author: '', createdAt: 0 }),
  remove: input => {
    calls.push(`remove ${input.key} ${JSON.stringify(input.options ?? {})}`)
    return Effect.succeed({})
  },
})

const trashingDescriptor: ProviderDescriptor = {
  ...notionDescriptor,
  kind: 'notion-trash',
  capabilities: { ...notionDescriptor.capabilities, write: true, delete: 'archive' },
  bindingOptions: [{ key: 'statusProperty', label: 'Status property', placeholder: 'Status' }],
}

const trashingClient = (calls: string[]): ExternalProviderClient => ({
  ...notionClient(calls),
  describe: () => Effect.succeed({ providers: [trashingDescriptor] }),
  resolve: input => {
    calls.push(`resolve ${JSON.stringify(input.options ?? {})}`)
    return Effect.succeed(page)
  },
})

describe('the provider registry', () => {
  it.effect('serves built-ins first, adds providers other plugins serve, and refuses an unknown kind', () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const registry = yield* BacklogProviderRegistry
      const kinds = (yield* registry.all).map(provider => `${provider.descriptor.kind}:${provider.descriptor.label}`)
      expect(kinds).toEqual(['linear:Linear', 'github:GitHub', 'files:Markdown files', 'notion-fake:Notion (fake)'])
      expect((yield* registry.recognizing('https://notion.so/page-1')).map(provider => provider.descriptor.kind)).toEqual(['notion-fake'])
      const unknown = yield* Effect.flip(registry.get('jira'))
      expect(unknown._tag).toBe('SyncProviderUnknown')

      const sync = yield* BacklogSync
      yield* sync.saveConnection({ connection: { instanceId: 'notion', kind: 'notion-fake', label: 'Notion', credential: '', baseUrl: '' } })
      yield* sync.saveBinding({ binding: { id: 'roadmap', connectionId: 'notion', container: 'db-1' } })
      const imported = yield* sync.importRemote({ reference: 'https://notion.so/page-1', actor: { kind: 'user' } })
      expect(imported.detail.item).toMatchObject({ title: 'Roadmap', body: 'From a page', status: 'todo' })

      const store = yield* BacklogStore
      yield* store.update({ id: imported.detail.item.id, title: 'Changed here', actor: { kind: 'user' } })
      const pass = yield* sync.syncNow({ id: imported.detail.item.id })
      expect(pass.results[0]?.pushed).toEqual([])
      expect(calls).toEqual(['resolve https://notion.so/page-1'])
    }).pipe(Effect.provide(syncTestLayer({ client: fakeLinear().client, external: [{ owner: '@acme/notion', client: notionClient(calls) }] })))
  })

  it.effect('hands a binding its provider options and removes the remote item on delete when the provider archives', () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      yield* sync.saveConnection({ connection: { instanceId: 'notion', kind: 'notion-trash', label: 'Notion', credential: '', baseUrl: '' } })
      const saved = yield* sync.saveBinding({ binding: { id: 'roadmap', connectionId: 'notion', container: 'db-1', options: { statusProperty: 'Stage' } } })
      expect(saved.binding.options).toEqual({ statusProperty: 'Stage' })
      const imported = yield* sync.importRemote({ reference: 'https://notion.so/page-1', actor: { kind: 'user' } })
      yield* sync.deleteItem({ id: imported.detail.item.id })
      expect(calls).toEqual(['resolve {"statusProperty":"Stage"}', 'remove page-1 {"statusProperty":"Stage"}'])
    }).pipe(Effect.provide(syncTestLayer({ client: fakeLinear().client, external: [{ owner: '@acme/notion', client: trashingClient(calls) }] })))
  })

  it.effect('imports and pushes the due date, acceptance criteria and summary a provider carries', () => {
    const pushed: RemotePatch[] = []
    const descriptor: ProviderDescriptor = {
      ...trashingDescriptor,
      kind: 'notion-extras',
      capabilities: { ...trashingDescriptor.capabilities, extraFields: ['due', 'criteria', 'summary'] },
    }
    const remote: RemoteRecord = {
      ...page,
      due: '2026-12-01',
      criteria: [
        { text: 'Ships', done: true },
        { text: 'Documented', done: false },
      ],
      summary: 'Done well',
    }
    const client: ExternalProviderClient = {
      ...notionClient([]),
      describe: () => Effect.succeed({ providers: [descriptor] }),
      resolve: () => Effect.succeed(remote),
      fetch: () => Effect.succeed(remote),
      push: input => {
        pushed.push(input.patch)
        return Effect.succeed({
          ...remote,
          ...(input.patch.due !== undefined && { due: input.patch.due }),
          ...(input.patch.criteria !== undefined && { criteria: input.patch.criteria }),
        })
      },
    }
    return Effect.gen(function* () {
      const sync = yield* BacklogSync
      yield* sync.saveConnection({ connection: { instanceId: 'notion', kind: 'notion-extras', label: 'Notion', credential: '', baseUrl: '' } })
      const saved = yield* sync.saveBinding({ binding: { id: 'roadmap', connectionId: 'notion', container: 'db-1' } })
      expect(saved.binding.fieldMap.map(rule => rule.field)).toEqual(expect.arrayContaining(['due', 'criteria', 'summary']))
      const imported = yield* sync.importRemote({ reference: 'https://notion.so/page-1', actor: { kind: 'user' } })
      expect(imported.detail.item).toMatchObject({
        due: '2026-12-01',
        criteria: [expect.objectContaining({ text: 'Ships', done: true }), expect.objectContaining({ text: 'Documented', done: false })],
        summary: 'Done well',
      })
      const store = yield* BacklogStore
      yield* store.update({
        id: imported.detail.item.id,
        due: '2026-12-24',
        criteria: [
          { text: 'Ships', done: true },
          { text: 'Documented', done: true },
        ],
        actor: { kind: 'user' },
      })
      yield* sync.syncNow({ id: imported.detail.item.id })
      expect(pushed).toEqual([
        {
          due: '2026-12-24',
          criteria: [
            { text: 'Ships', done: true },
            { text: 'Documented', done: true },
          ],
        },
      ])
    }).pipe(Effect.provide(syncTestLayer({ client: fakeLinear().client, external: [{ owner: '@acme/notion', client }] })))
  })

  it.effect('keeps a provider plugin failure code, status and recovery across the Host API instead of a generic refusal', () => {
    const owner = '@acme/notion'
    const notFound = new BacklogProviderFailed({
      provider: 'Notion',
      code: 'not-found',
      detail: 'page-9 — share the page or database with the integration if it exists',
      cause: new Error('upstream body'),
    })
    const refused = new BacklogProviderFailed({ provider: 'Notion', code: 'rejected', status: 401, detail: 'API token is invalid.' })
    const serving = DshxPlugin.make({
      name: owner,
      layer: Layer.empty,
      apis: [
        Api.bind(BacklogProviders.contract(owner), {
          describe: () => Effect.succeed({ providers: [{ ...notionDescriptor, kind: 'notion-wire' }] }),
          identity: () => Effect.fail(refused),
          pull: () => Effect.fail(refused),
          fetch: () => Effect.fail(refused),
          resolve: () => Effect.fail(notFound),
          push: () => Effect.fail(refused),
          create: () => Effect.fail(refused),
          comment: () => Effect.fail(refused),
          remove: () => Effect.fail(refused),
        }),
      ],
    })
    return Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        testHost => Effect.promise(() => testHost.dispose()),
      )
      yield* Effect.promise(() => host.mount(serving, { packageId: owner }))
      const apis = yield* Effect.provide(
        HostApis,
        HostApis.layer.pipe(Layer.provide(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/backlog' })))),
      )
      const client = apis.typed(BacklogProviders.contract(owner), { errors: [BacklogProviderFailed] })
      return yield* Effect.gen(function* () {
        const sync = yield* BacklogSync
        yield* sync.saveConnection({ connection: { instanceId: 'notion', kind: 'notion-wire', label: 'Notion', credential: '', baseUrl: '' } })
        yield* sync.saveBinding({ binding: { id: 'roadmap', connectionId: 'notion', container: 'db-1' } })
        const missing = yield* Effect.flip(sync.importRemote({ reference: 'https://notion.so/page-9', actor: { kind: 'user' } }))
        expect(missing).toMatchObject({ _tag: 'BacklogProviderFailed', provider: 'Notion', code: 'not-found' })
        expect(missing.message).toContain('Notion has no item matching that reference (page-9 — share the page or database with the integration')
        expect(missing.message).not.toContain('refused')
        expect(missing.message).not.toContain('upstream body')

        const registry = yield* BacklogProviderRegistry
        const provider = yield* registry.get('notion-wire')
        const key = yield* Effect.flip(provider.identity({ instanceId: 'notion', kind: 'notion-wire', label: 'Notion', credential: '', baseUrl: '' }))
        expect(key).toMatchObject({ code: 'rejected', status: 401 })
        expect(key.message).toContain("check that the connection's key is valid")
      }).pipe(Effect.provide(syncTestLayer({ client: fakeLinear().client, external: [{ owner, client }] })))
    }).pipe(Effect.scoped)
  })
})
