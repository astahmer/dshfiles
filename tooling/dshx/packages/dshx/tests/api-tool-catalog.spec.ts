import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { defineApi, dshxRegistryApi, method, pluginToolCatalog, type RegistryListing } from '../src/api/index.js'
import { createHostApiClient, defineHost } from '../src/host/index.js'
import { createTestHost } from '../src/testing/index.js'

const listing: RegistryListing = {
  apis: [
    {
      owner: '@test/plugin',
      id: 'items',
      version: 2,
      methods: [
        { name: 'write', tool: 'z_write', description: 'Write.' },
        { name: 'remove', tool: 'c_remove', input: { type: 'object', properties: { confirm: { type: 'boolean', const: true } }, required: ['confirm'] } },
        { name: 'read', tool: 'a_read', description: 'Method description', input: { type: 'object', properties: { id: { type: 'string' } } } },
        { name: 'noInput', tool: 'b_no_input' },
        { name: 'unlisted', tool: 'd_unlisted', description: 'Fallback.' },
        { name: 'native', tool: 'native' },
        { name: 'internal' },
        { name: 'scalar', tool: 'e_scalar', input: { type: 'string' } },
      ],
    },
  ],
  tools: [
    { name: 'a_read', description: 'Effective description', source: 'api', readOnly: true },
    { name: 'z_write', description: 'Write tool', source: 'api', readOnly: false },
    { name: 'c_remove', description: 'Remove tool', source: 'api' },
    { name: 'b_no_input', description: 'No input', source: 'api' },
    { name: 'native', description: 'Native', source: 'plugin', readOnly: true },
    { name: 'e_scalar', description: 'Scalar', source: 'api' },
  ],
  skills: [],
}

describe('plugin tool catalog', () => {
  it('joins API methods safely and projects input schemas', () => {
    const catalog = pluginToolCatalog({ listing })
    expect(catalog.map(entry => entry.name)).toEqual(['a_read', 'b_no_input', 'c_remove', 'd_unlisted', 'e_scalar', 'z_write'])
    expect(catalog[0]).toEqual({
      name: 'a_read',
      description: 'Effective description',
      readOnly: true,
      owner: '@test/plugin',
      apiId: 'items',
      version: 2,
      method: 'read',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      takesInput: true,
    })
    expect(catalog[1]).toMatchObject({ takesInput: false, inputSchema: { type: 'object', properties: {} } })
    expect(catalog[2]).toMatchObject({
      readOnly: false,
      inputSchema: { type: 'object', properties: { confirm: { type: 'boolean', const: true } }, required: ['confirm'] },
    })
    expect(catalog[3]).toMatchObject({ description: 'Fallback.', readOnly: false })
    expect(catalog[4]).toMatchObject({ takesInput: false, inputSchema: { type: 'object', properties: {} } })
    expect(catalog[5]?.readOnly).toBe(false)
  })

  it('uses the real Host registry listing', async () => {
    const api = defineApi({
      id: 'catalog-test',
      version: 1,
      owner: '@test/catalog',
      methods: {
        remove: method({
          input: Schema.Struct({ confirm: Schema.Literal(true) }),
          output: Schema.Boolean,
          description: 'Remove.',
          tool: { name: 'catalog_remove', description: 'Remove explicitly.' },
        }),
      },
    })
    const host = await createTestHost()
    const mounted = await host.mount(defineHost({ apis: [api.host({ remove: () => true })] }), { packageId: '@test/catalog' })
    try {
      const registry = createHostApiClient(mounted.ctx, dshxRegistryApi, '@test/catalog')
      const actual = pluginToolCatalog({ listing: await registry.list({ schemas: true }) })
      expect(actual.find(entry => entry.name === 'catalog_remove')).toMatchObject({
        description: 'Remove explicitly.',
        readOnly: false,
        takesInput: true,
        inputSchema: { properties: { confirm: { type: 'boolean', enum: [true] } }, required: ['confirm'] },
      })
    } finally {
      await host.dispose()
    }
  })
})
