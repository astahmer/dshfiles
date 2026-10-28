import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { resourcePacksApi } from '../src/api.js'
import { createResourcePacksHost } from '../src/host.js'
import { packDefinitionSchema, resourceSchema, type ResourceRecord } from '../src/model.js'

const owner = '@dshfiles/resource-packs'
const definition = packDefinitionSchema.parse({
  id: 'contributor',
  version: 1,
  label: 'Contributor pack',
  properties: [
    { id: 'snapshot', label: 'Owner snapshot', type: 'text', readOnly: true },
    { id: 'note', label: 'User note', type: 'text' },
  ],
})
const ref = { provider: 'test', kind: 'record', id: 'Opaque/CaSe/%_?' }
const resourceEnvelope = z.object({ result: z.object({ ok: z.literal(true), value: z.object({ output: resourceSchema }) }) })
let directory: string
let path: string
let host: TestHost
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'resource-packs-host-'))
  path = join(directory, 'resources.db')
  host = await createTestHost()
})
afterEach(async () => {
  await host.dispose()
  rmSync(directory, { recursive: true, force: true })
})

// oxlint-disable-next-line antislop/no-unknown-parameters, antislop/no-unknown-returns -- This test transport deliberately sends malformed payloads; each test parses the response envelope it expects.
async function request(method: string, input: unknown): Promise<unknown> {
  const response = await host.connection.requestApi({ packageId: owner, apiId: resourcePacksApi.id, version: resourcePacksApi.version, method, input })
  return response.json()
}

// oxlint-disable-next-line antislop/no-unknown-parameters -- The native tool pipeline is the boundary under test, including rejection of malformed arguments.
const tool = (name: string, args: unknown) =>
  host.tools.execute({
    // SAFETY: ToolCallId is an opaque string brand; a generated UUID is unique and no Agent or runtime structure is asserted.
    callId: randomUUID() as ToolExecutionInput['callId'],
    name,
    arguments: args,
    signal: new AbortController().signal,
  })

describe('mounted Cordis Host / public resourcePacksApi', () => {
  it('supports an independent contributor, readonly ownership, unload/reload and a real persisted reopen', async () => {
    let resource: ResourceRecord | undefined
    const provider = await host.mount(createResourcePacksHost(path), { packageId: owner })
    const contributor = await host.mount(
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
    )
    if (resource === undefined) throw new Error('Contributor did not finish setup')
    const input = { resourceId: resource.id, expectedRevision: resource.revision, packId: definition.id, values: { snapshot: 'Must fail' } }
    expect(await request('setValues', input)).toMatchObject({ result: { ok: false, error: { code: 'read-only' } } })
    expect((await tool('resource_packs_set_values', input)).isError).toBe(true)
    const other = await host.mount(defineHost({}), { packageId: '@test/other' })
    const foreignApi = createHostApiClient(other.ctx, resourcePacksApi, '@test/other')
    await expect(foreignApi.setValues(input)).rejects.toMatchObject({ remoteCode: 'read-only' })
    await expect(foreignApi.registerPack({ definition })).rejects.toMatchObject({ remoteCode: 'owner-conflict' })
    const changed = resourceEnvelope.parse(await request('setValues', { ...input, values: { note: 'GUI metadata' } })).result.value.output
    await contributor.dispose()
    expect((await foreignApi.catalog()).packs.find(pack => pack.definition.id === definition.id)?.owner).toBe('@test/contributor')
    expect((await foreignApi.get({ resourceId: resource.id })).resource).toEqual(changed)
    await provider.dispose()
    expect(host.tools.get('resource_packs_get')).toBeUndefined()
    await expect(foreignApi.catalog()).rejects.toMatchObject({ remoteCode: 'owner-missing' })
    await host.mount(createResourcePacksHost(path), { packageId: owner })
    const reopened = await foreignApi.get({ resourceId: resource.id })
    expect(reopened.resource).toEqual(changed)
    expect(reopened.resource.attachments[0]?.values).toEqual({ snapshot: 'Contributor metadata', note: 'GUI metadata' })
    expect(reopened.events.map(event => event.actor)).toEqual(['user', '@test/contributor', '@test/contributor', '@test/contributor'])
  })

  it('shares every method with agent tools and requires explicit detach confirmation in both transports', async () => {
    await host.mount(createResourcePacksHost(path), { packageId: owner })
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
    const registered = await tool('resource_packs_register_resource', { ref, label: 'Agent record' })
    expect(registered.isError).toBe(false)
    if (registered.isError) throw new Error('Registration failed')
    const resource = resourceSchema.parse(registered.value)
    const attachedResult = await tool('resource_packs_attach', { resourceId: resource.id, expectedRevision: resource.revision, packId: 'tracking' })
    if (attachedResult.isError) throw new Error('Attachment failed')
    const attached = resourceSchema.parse(attachedResult.value)
    const input = { resourceId: resource.id, expectedRevision: attached.revision, packId: 'tracking' }
    for (const args of [input, { ...input, confirm: false }]) {
      expect(await request('detach', args)).toMatchObject({ result: { ok: false, error: { code: 'contract' } } })
      expect((await tool('resource_packs_detach', args)).isError).toBe(true)
    }
    expect((await tool('resource_packs_detach', { ...input, confirm: true })).isError).toBe(false)
    expect(await request('attach', { ...input, expectedRevision: 1 })).toMatchObject({ result: { ok: false, error: { code: 'stale-revision' } } })
    expect(await request('registerPack', { definition: { ...definition, properties: [definition.properties[0], definition.properties[0]] } })).toMatchObject({
      result: { ok: false, error: { code: 'invalid-definition' } },
    })
    expect(await request('attach', { ...input, expectedRevision: attached.revision + 1, packId: 'missing' })).toMatchObject({
      result: { ok: false, error: { code: 'unknown-pack' } },
    })
  })

  it('isolates lifecycle state across two Hosts mounting the same definition', async () => {
    const second = await createTestHost()
    const shared = createResourcePacksHost(path)
    try {
      const mounted = await host.mount(shared, { packageId: owner })
      await second.mount(shared, { packageId: owner })
      const client = createHostApiClient(second.ctx, resourcePacksApi, '@test/reader')
      const resource = await client.registerResource({ ref, label: 'Both handles' })
      await mounted.dispose()
      expect((await client.get({ resourceId: resource.id })).resource).toEqual(resource)
      expect((await client.catalog()).packs).toHaveLength(1)
    } finally {
      await second.dispose()
    }
  })
})
