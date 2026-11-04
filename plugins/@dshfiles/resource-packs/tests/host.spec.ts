import { randomUUID } from 'node:crypto'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Path, Schema } from 'effect'
import { resourcePacksApi } from '../src/api.js'
import { createResourcePacksPlugin } from '../src/host.js'
import { packDefinitionSchema, resourceSchema, type ResourceRecord } from '../src/model.js'
import { isolatedDshHome, owner, requestApi, testHost, type TestHostInstance } from './host-layers.js'
import { platformLayer } from './store-layers.js'

const definition = Schema.decodeUnknownSync(packDefinitionSchema)({
  id: 'contributor',
  version: 1,
  label: 'Contributor pack',
  properties: [
    { id: 'snapshot', label: 'Owner snapshot', type: 'text', readOnly: true },
    { id: 'note', label: 'User note', type: 'text' },
  ],
})
const ref = { provider: 'test', kind: 'record', id: 'Opaque/CaSe/%_?' }
const resourceEnvelope = Schema.Struct({ result: Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: resourceSchema }) }) })
const decodeResourceEnvelope = Schema.decodeUnknownEffect(resourceEnvelope)
const decodeResource = Schema.decodeUnknownEffect(resourceSchema)

// oxlint-disable-next-line antislop/no-unknown-parameters -- The native tool pipeline is the boundary under test, including rejection of malformed arguments.
const tool = (host: TestHostInstance, name: string, args: unknown) =>
  Effect.promise(() =>
    host.tools.execute({
      // SAFETY: ToolCallId is an opaque string brand; a generated UUID is unique and no Agent or runtime structure is asserted.
      callId: randomUUID() as ToolExecutionInput['callId'],
      name,
      arguments: args,
      signal: new AbortController().signal,
    }),
  )

const mount = (host: TestHostInstance, plugin = createResourcePacksPlugin()) => Effect.promise(() => host.mount(plugin, { packageId: owner }))

describe('mounted Cordis Host / public resourcePacksApi', () => {
  it.effect('supports an independent contributor, readonly ownership, unload/reload and a real persisted reopen', () =>
    Effect.gen(function* () {
      yield* isolatedDshHome
      const host = yield* testHost
      const plugin = createResourcePacksPlugin()
      let resource: ResourceRecord | undefined
      const provider = yield* mount(host, plugin)
      const contributor = yield* Effect.promise(() =>
        host.mount(
          defineHost({
            async setup(ctx) {
              const api = createHostApiClient(ctx, resourcePacksApi, '@test/contributor')
              const pack = await api.registerPack({ definition })
              expect(pack.owner).toBe('@test/contributor')
              const registered = await api.registerResource({ ref, label: 'Independent record' })
              const attached = await api.attach({ resourceId: registered.id, expectedRevision: registered.revision, packId: definition.id })
              resource = await api.setValues({
                resourceId: attached.id,
                expectedRevision: attached.revision,
                packId: definition.id,
                values: { snapshot: 'Contributor metadata' },
              })
              return () => undefined
            },
          }),
          { packageId: '@test/contributor' },
        ),
      )
      if (resource === undefined) throw new Error('Contributor did not finish setup')
      const input = { resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id, values: { snapshot: 'Must fail' } }
      expect(yield* requestApi(host, 'setValues', input)).toMatchObject({ result: { ok: false, error: { code: 'read-only' } } })
      expect((yield* tool(host, 'resource_packs_set_values', input)).isError).toBe(true)
      const other = yield* Effect.promise(() => host.mount(defineHost({}), { packageId: '@test/other' }))
      const foreignApi = createHostApiClient(other.ctx, resourcePacksApi, '@test/other')
      yield* Effect.promise(() => expect(foreignApi.setValues(input)).rejects.toMatchObject({ remoteCode: 'read-only' }))
      yield* Effect.promise(() => expect(foreignApi.registerPack({ definition })).rejects.toMatchObject({ remoteCode: 'owner-conflict' }))
      const changed = (yield* decodeResourceEnvelope(yield* requestApi(host, 'setValues', { ...input, values: { note: 'GUI metadata' } }))).result.value.output
      yield* Effect.promise(() => contributor.dispose())
      const catalog = yield* Effect.promise(() => foreignApi.catalog())
      expect(catalog.packs.find(pack => pack.definition.id === definition.id)?.owner).toBe('@test/contributor')
      const resourceId = resource.id
      expect((yield* Effect.promise(() => foreignApi.get({ resourceId }))).resource).toEqual(changed)
      yield* Effect.promise(() => provider.dispose())
      expect(host.tools.get('resource_packs_get')).toBeUndefined()
      yield* Effect.promise(() => expect(foreignApi.catalog()).rejects.toMatchObject({ remoteCode: 'owner-missing' }))
      yield* mount(host, plugin)
      const reopened = yield* Effect.promise(() => foreignApi.get({ resourceId }))
      expect(reopened.resource).toEqual(changed)
      expect(reopened.resource.attachments[0]?.values).toEqual({ snapshot: 'Contributor metadata', note: 'GUI metadata' })
      expect(reopened.events.map(event => event.actor)).toEqual(['user', '@test/contributor', '@test/contributor', '@test/contributor'])
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('shares every method with agent tools and requires explicit detach confirmation in both transports', () =>
    Effect.gen(function* () {
      yield* isolatedDshHome
      const host = yield* testHost
      yield* mount(host)
      const methods = Object.values(resourcePacksApi.methods)
      expect(methods).toHaveLength(8)
      const schemas = host.tools.schemas()
      for (const method of methods) expect(schemas.some(schema => schema.name === method.tool?.name)).toBe(true)
      expect(schemas.find(schema => schema.name === 'resource_packs_detach')?.parameters).toMatchObject({
        required: expect.arrayContaining(['confirm', 'expectedRevision', 'resourceId', 'packId']),
      })
      for (const name of ['resource_packs_catalog', 'resource_packs_get', 'resource_packs_list']) {
        expect(host.tools.get(name)?.isConcurrencySafe).toBeDefined()
      }
      expect(host.tools.get('resource_packs_set_values')?.isConcurrencySafe).toBeUndefined()
      const registered = yield* tool(host, 'resource_packs_register_resource', { ref, label: 'Agent record' })
      if (registered.isError) throw new Error('Registration failed')
      const resource = yield* decodeResource(registered.value)
      const attachedResult = yield* tool(host, 'resource_packs_attach', { resourceId: resource.id, expectedRevision: resource.revision, packId: 'tracking' })
      if (attachedResult.isError) throw new Error('Attachment failed')
      const attached = yield* decodeResource(attachedResult.value)
      const input = { resourceId: resource.id, expectedRevision: attached.revision, packId: 'tracking' }
      for (const args of [input, { ...input, confirm: false }]) {
        expect(yield* requestApi(host, 'detach', args)).toMatchObject({ result: { ok: false, error: { code: 'contract' } } })
        expect((yield* tool(host, 'resource_packs_detach', args)).isError).toBe(true)
      }
      expect((yield* tool(host, 'resource_packs_detach', { ...input, confirm: true })).isError).toBe(false)
      expect(yield* requestApi(host, 'attach', { ...input, expectedRevision: 1 })).toMatchObject({ result: { ok: false, error: { code: 'stale-revision' } } })
      expect(
        yield* requestApi(host, 'registerPack', { definition: { ...definition, properties: [definition.properties[0], definition.properties[0]] } }),
      ).toMatchObject({ result: { ok: false, error: { code: 'invalid-definition' } } })
      expect(yield* requestApi(host, 'attach', { ...input, expectedRevision: attached.revision + 1, packId: 'missing' })).toMatchObject({
        result: { ok: false, error: { code: 'unknown-pack' } },
      })
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('isolates lifecycle state across two Hosts serving one registry file', () =>
    Effect.gen(function* () {
      yield* isolatedDshHome
      const host = yield* testHost
      const second = yield* testHost
      const mounted = yield* mount(host)
      yield* mount(second)
      const client = createHostApiClient(second.ctx, resourcePacksApi, '@test/reader')
      const resource = yield* Effect.promise(() => client.registerResource({ ref, label: 'Both handles' }))
      yield* Effect.promise(() => mounted.dispose())
      expect((yield* Effect.promise(() => client.get({ resourceId: resource.id }))).resource).toEqual(resource)
      expect((yield* Effect.promise(() => client.catalog())).packs).toHaveLength(1)
    }).pipe(Effect.provide(platformLayer)),
  )

  it.effect('opens the registry under DSH_HOME and adopts it on the next activation', () =>
    Effect.gen(function* () {
      const home = yield* isolatedDshHome
      const host = yield* testHost
      const plugin = createResourcePacksPlugin()
      const mounted = yield* mount(host, plugin)
      const client = createHostApiClient(host.ctx, resourcePacksApi, '@test/reader')
      const resource = yield* Effect.promise(() => client.registerResource({ ref, label: 'Under the isolated home' }))
      yield* Effect.promise(() => mounted.dispose())
      yield* mount(host, plugin)
      expect((yield* Effect.promise(() => client.get({ resourceId: resource.id }))).resource).toEqual(resource)
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      expect(yield* fs.exists(path.join(home, 'plugins', 'resource-packs', 'resources.db'))).toBe(true)
    }).pipe(Effect.provide(platformLayer)),
  )
})
