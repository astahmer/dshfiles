import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import { zodSchemaFromEffect } from '../src/api/index.js'

const recordSchema = Schema.Struct({
  id: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  tags: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
})

describe('zodSchemaFromEffect', () => {
  it('satisfies the ZodType constraint the storage and stored-value contracts demand', () => {
    const view: ZodType<typeof recordSchema.Type> = zodSchemaFromEffect(recordSchema)
    expect(view.parse({ id: 1 })).toEqual({ id: 1, tags: [] })
  })

  it('fills the defaults a stored value written by an older Host omits', () => {
    expect(zodSchemaFromEffect(recordSchema).parse({ id: 7, tags: ['kept'] })).toEqual({ id: 7, tags: ['kept'] })
    expect(zodSchemaFromEffect(recordSchema).parse({ id: 7 })).toEqual({ id: 7, tags: [] })
  })

  it('strips an unknown property instead of rejecting the record', () => {
    expect(zodSchemaFromEffect(recordSchema).parse({ id: 2, retired: true })).toEqual({ id: 2, tags: [] })
  })

  it('rejects what the Effect schema rejects, through safeParse as well', () => {
    const view = zodSchemaFromEffect(recordSchema)
    expect(view.safeParse({ id: 0 }).success).toBe(false)
    expect(view.safeParse({ id: 1.5 }).success).toBe(false)
    expect(() => view.parse({ id: 'one' })).toThrow()
  })
})
