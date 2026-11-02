import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { annotationsApi } from '../src/api.js'

describe('annotations API input schema', () => {
  it('accepts a valid list input and rejects a missing session id', () => {
    const schema = annotationsApi.methods.list.input
    if (schema === undefined) throw new Error('list input schema is missing')

    expect(Option.isSome(Schema.decodeUnknownOption(schema)({ sessionId: 'session-1', statuses: ['pending'], limit: 1 }))).toBe(true)
    expect(Option.isNone(Schema.decodeUnknownOption(schema)({ sessionId: '' }))).toBe(true)
  })
})
