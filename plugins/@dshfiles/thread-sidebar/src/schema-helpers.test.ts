import { describe, expect, it } from 'vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

const requestSchema = SchemaHelpers.strictStruct(Schema.Struct({ sessionId: Schema.String }))

describe('Effect schema helpers', () => {
  it('rejects unknown object keys without changing the decoded struct shape', () => {
    const valid = Schema.decodeUnknownResult(requestSchema)({ sessionId: 'session-1' })
    const extra = Schema.decodeUnknownResult(requestSchema)({ sessionId: 'session-1', unexpected: true })
    expect(Result.isSuccess(valid)).toBe(true)
    expect(Result.isFailure(extra)).toBe(true)
  })

  it('uses the decoded default when input is absent', () => {
    const schema = SchemaHelpers.withDecodedDefault(Schema.Literals(['restart', 'interrupted']), () => 'restart')

    expect(Schema.decodeUnknownSync(schema)(undefined)).toBe('restart')
  })
})
