import { describe, expect, it } from 'vitest'
import { annotationsApi } from '../src/api.js'

describe('annotations API Standard Schema', () => {
  it('validates declared API inputs and rejects invalid strict inputs', async () => {
    const schema = annotationsApi.methods.list.input
    if (schema === undefined) throw new Error('list input schema is missing')

    const valid = await schema['~standard'].validate({ sessionId: 'session-1', statuses: ['pending'], limit: 1 })
    expect('issues' in valid).toBe(false)

    const invalid = await schema['~standard'].validate({ sessionId: '', extra: true })
    expect('issues' in invalid).toBe(true)

    if (!('jsonSchema' in schema['~standard'])) throw new Error('API schema does not publish JSON Schema')
    expect(schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toMatchObject({
      type: 'object',
      properties: expect.objectContaining({ sessionId: { type: 'string', minLength: 1, maxLength: 200 } }),
      required: ['sessionId'],
    })
  })
})
