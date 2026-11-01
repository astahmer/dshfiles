import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { decodeJson, decodeJsonSafe } from '../src/json.js'

describe('JSON decoder schema boundary', () => {
  it('preserves Effect Schema decoding and Result output', () => {
    const schema = Schema.Struct({ count: Schema.Number })
    const decoded = decodeJson(schema, '{"count":1}')
    const result = decodeJsonSafe(schema, '{"count":1}')

    expect(decoded).toEqual({ count: 1 })
    expect(result._tag).toBe('Success')
    if (result._tag === 'Success') expect(result.success).toEqual({ count: 1 })
  })

  it('accepts any synchronous Standard Schema validator', () => {
    const schema: StandardSchemaV1<unknown, { readonly count: number }> = {
      '~standard': {
        version: 1,
        vendor: 'dshx-json-test',
        validate: value => {
          if (typeof value !== 'object' || value === null || !('count' in value) || typeof value.count !== 'number') {
            return { issues: [{ message: 'expected a numeric count' }] }
          }
          return { value: { count: value.count } }
        },
      },
    }
    const decoded = decodeJson(schema, '{"count":1}')
    const success = decodeJsonSafe(schema, '{"count":2}')
    const failure = decodeJsonSafe(schema, '{"count":"bad"}')

    expect(decoded).toEqual({ count: 1 })
    expect(success).toEqual({ success: true, data: { count: 2 } })
    expect(failure.success).toBe(false)
  })

  it('preserves the Effect Schema Result output', () => {
    const effectResult = decodeJsonSafe(Schema.Struct({ count: Schema.Number }), '{"count":"bad"}')
    expect(effectResult._tag).toBe('Failure')
  })
})
