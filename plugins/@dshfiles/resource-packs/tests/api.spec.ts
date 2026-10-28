import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { resourcePacksApi } from '../src/api.js'
import { createResourcePacksHost } from '../src/host.js'
import { packDefinitionSchema, resourceSchema } from '../src/model.js'
import { z } from 'zod'

const resourceResponse = z.object({ result: z.object({ ok: z.literal(true), value: z.object({ output: resourceSchema }) }) })
const errorResponse = z.object({ result: z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }) })
let host: TestHost
let directory: string
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'resource-packs-api-'))
  host = await createTestHost()
  await host.mount(createResourcePacksHost(join(directory, 'resources.db')), { packageId: '@dshfiles/resource-packs' })
})
afterEach(async () => {
  await host.dispose()
  rmSync(directory, { recursive: true, force: true })
})
// oxlint-disable-next-line antislop/no-unknown-parameters, antislop/no-unknown-returns -- Deliberately invalid wire input must reach the real API validator; each test parses its expected response envelope.
async function call(method: string, input: unknown): Promise<unknown> {
  const response = await host.connection.requestApi({ packageId: '@dshfiles/resource-packs', apiId: resourcePacksApi.id, version: 1, method, input })
  return response.json()
}

describe('authoritative API validation', () => {
  it.each([
    ['list', { limit: 201 }],
    ['list', { limit: 0 }],
    ['list', { query: 'x'.repeat(501) }],
    ['registerResource', { ref: { provider: 'native', kind: 'file', id: '' }, label: 'Invalid' }],
    ['registerResource', { ref: { provider: 'native', kind: 'file', id: 'Opaque', extra: 'rejected' }, label: 'Invalid' }],
    ['registerResource', { ref: { provider: 'native', kind: 'file', id: 'Opaque' }, label: 'Invalid', owner: '@test/spoofed' }],
    ['get', { resourceId: 'not-a-uuid' }],
    [
      'registerPack',
      {
        definition: {
          id: 'defaults',
          version: 1,
          label: 'Default',
          properties: [{ id: 'select', type: 'select', label: 'Select', default: 'impossible', options: [{ id: 'one', label: 'One' }] }],
        },
      },
    ],
  ])('refuses invalid wire input without mutation: %s %j', async (method, input) => {
    expect(errorResponse.parse(await call(method, input)).result.error.code).toBe('contract')
    expect(await call('list', {})).toMatchObject({ result: { ok: true, value: { output: { total: 0, resources: [] } } } })
    expect(await call('catalog', undefined)).toMatchObject({ result: { ok: true, value: { output: { packs: [{ definition: { id: 'tracking' } }] } } } })
  })

  it('returns bounded useful domain errors without echoing submitted values or opaque ids', async () => {
    const registered = resourceResponse.parse(
      await call('registerResource', { ref: { provider: 'native', kind: 'conversation', id: 'Native/SecretId' }, label: 'Explicit label' }),
    ).result.value.output
    const attached = resourceResponse.parse(await call('attach', { resourceId: registered.id, expectedRevision: registered.revision, packId: 'tracking' }))
      .result.value.output
    const input = { resourceId: registered.id, expectedRevision: attached.revision, packId: 'tracking' }
    const before = await call('get', { resourceId: registered.id })
    for (const values of [
      { status: 'secret:DO_NOT_ECHO' },
      { absent: 'secret:DO_NOT_ECHO' },
      { related: { provider: 'native', kind: 'conversation', id: '', payload: 'secret:DO_NOT_ECHO' } },
    ]) {
      const error = errorResponse.parse(await call('setValues', { ...input, values })).result.error
      expect(error.code).not.toBe('internal')
      expect(error.message.length).toBeLessThanOrEqual(500)
      expect(error.message).not.toContain('DO_NOT_ECHO')
      expect(error.message).not.toContain('Native/SecretId')
      expect(await call('get', { resourceId: registered.id })).toEqual(before)
    }
  })

  it('computes user ownership for GUI registration and refuses builtin namespace takeover', async () => {
    const definition = packDefinitionSchema.parse({
      id: 'user-pack',
      version: 1,
      label: 'User pack',
      properties: [{ id: 'note', label: 'Note', type: 'text' }],
    })
    expect(await call('registerPack', { definition })).toMatchObject({ result: { ok: true, value: { output: { owner: 'user' } } } })
    expect(errorResponse.parse(await call('registerPack', { definition: { ...definition, id: 'tracking' } })).result.error.code).toBe('owner-conflict')
  })
})
