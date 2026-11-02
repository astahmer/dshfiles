import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { publishedJsonSchema, toToolSchema } from '../src/api/json-schema.js'
import { resolveApiSchema } from '../src/api/schema.js'
import { createTestHost } from '../src/testing/index.js'
import { defineApi, method } from '../src/api/index.js'
import { defineHost } from '../src/host/index.js'

const lookupInput = Schema.Struct({ id: Schema.String, limit: Schema.optional(Schema.Int) })

const publishesJsonSchema = (standard: StandardSchemaV1['~standard']): standard is StandardSchemaV1['~standard'] & StandardJSONSchemaV1['~standard'] =>
  'jsonSchema' in standard

const validate = (schema: unknown, value: unknown) => resolveApiSchema(schema)['~standard'].validate(value)

describe('Effect Schema as an API schema', () => {
  it('publishes a closed JSON Schema without importing @dshfiles/dshx/effect', () => {
    expect(toToolSchema(publishedJsonSchema(lookupInput, 'input'))).toEqual({
      type: 'object',
      properties: { id: { type: 'string' }, limit: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    })
  })

  it('rejects unknown keys and accepts the declared ones', () => {
    expect(validate(lookupInput, { id: 'a', limit: 2 })).toEqual({ value: { id: 'a', limit: 2 } })
    expect(validate(lookupInput, { id: 'a', extra: true })).toMatchObject({ issues: [{ path: ['extra'] }] })
  })

  it('closes nested objects and the type side of a transformed schema', () => {
    const nested = Schema.Struct({ filter: Schema.Struct({ tag: Schema.String }), count: Schema.NumberFromString })
    expect(publishedJsonSchema(nested, 'input')).toMatchObject({
      properties: { filter: { additionalProperties: false }, count: { type: 'string' } },
      additionalProperties: false,
    })
    expect(publishedJsonSchema(nested, 'output')).toMatchObject({
      properties: { filter: { additionalProperties: false }, count: { anyOf: [{ type: 'number' }, expect.anything()] } },
      additionalProperties: false,
    })
  })

  it('keeps Void as "no arguments" and publishes an empty Struct as the closed empty object', () => {
    expect(toToolSchema(publishedJsonSchema(Schema.Void, 'input'))).toEqual({ type: 'null' })
    expect(validate(Schema.Void, undefined)).toEqual({ value: undefined })
    expect(publishedJsonSchema(Schema.Struct({}), 'input')).toEqual({ type: 'object', properties: {}, additionalProperties: false })
  })

  it('serves the draft-07 target with its own definitions keyword', () => {
    const Tag = Schema.String.annotate({ identifier: 'Tag' })
    const tagged = Schema.Struct({ tags: Schema.Array(Tag) })
    const standard = resolveApiSchema(tagged)['~standard']
    if (!publishesJsonSchema(standard)) throw new Error('Effect schemas publish a JSON Schema.')
    expect(publishedJsonSchema(tagged, 'input')).toMatchObject({ $defs: { Tag: { type: 'string' } } })
    expect(standard.jsonSchema.input({ target: 'draft-07' })).toMatchObject({
      $schema: 'http://json-schema.org/draft-07/schema#',
      definitions: { Tag: { type: 'string' } },
      additionalProperties: false,
    })
  })

  it('leaves an explicit Standard Schema adapter untouched', () => {
    const lenient = Schema.toStandardSchemaV1(lookupInput)
    expect(resolveApiSchema(lenient)).toBe(lenient)
    expect(validate(lenient, { id: 'a', extra: true })).toEqual({ value: { id: 'a' } })
  })

  it('registers an Effect-schema tool whose input is closed', async () => {
    const api = defineApi({
      id: 'lookup',
      version: 1,
      owner: '@test/lookup',
      methods: {
        get: method({ input: lookupInput, output: Schema.String, description: 'Look one up.', tool: { name: 'lookup_get', readOnly: true } }),
      },
    })
    const host = await createTestHost()
    await host.mount(defineHost({ apis: [api.host({ get: ({ input }) => input.id })] }), { packageId: '@test/lookup' })
    const tool = host.tools.schemas().find(schema => schema.name === 'lookup_get')
    expect(tool?.parameters).toMatchObject({ additionalProperties: false, required: ['id'] })
    await host.dispose()
  })
})
