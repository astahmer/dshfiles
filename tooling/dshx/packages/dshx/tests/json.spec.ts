import { describe, expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { z } from 'zod'
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

  it('preserves Zod decoding and safeParse output', () => {
    const schema = z.object({ count: z.number().default(1), label: z.string().trim() })
    const decoded = decodeJson(schema, '{"label":" DSH "}')
    const result = decodeJsonSafe(schema, '{"label":" DSH "}')

    expect(decoded).toEqual({ count: 1, label: 'DSH' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual({ count: 1, label: 'DSH' })
  })

  it('preserves each schema library’s invalid-result shape', () => {
    const zodResult = decodeJsonSafe(z.object({ count: z.number() }), '{"count":"bad"}')
    const effectResult = decodeJsonSafe(Schema.Struct({ count: Schema.Number }), '{"count":"bad"}')

    expect(zodResult.success).toBe(false)
    expect(effectResult._tag).toBe('Failure')
  })
})
