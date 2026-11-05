import type { EffectApiClient } from '@dshfiles/dshx/effect'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { LinearMapping } from './provider-linear.js'
import { BacklogProviders, type BacklogProviderMethods, type ProviderDescriptor, type RemoteRecord } from './provider-port.js'
import { BacklogProviderRegistry } from './provider-registry.js'
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
const notionClient = (calls: string[]): EffectApiClient<BacklogProviderMethods> => ({
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
})
