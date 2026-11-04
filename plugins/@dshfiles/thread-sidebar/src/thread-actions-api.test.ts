import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { threadActionsApi } from './thread-actions-api.js'

const promptInput = threadActionsApi.methods.prompt.input
if (promptInput === undefined) throw new Error('thread_prompt declares no input schema')

describe('thread actions API schemas', () => {
  it('publishes each tool argument, so an agent sees what thread_prompt takes', () => {
    expect(Schema.toJsonSchemaDocument(promptInput, { onExcessProperty: 'error' }).schema).toMatchObject({
      type: 'object',
      properties: { sessionId: {}, text: { type: 'string' }, mode: {} },
      required: ['text'],
    })
  })

  it('still refuses an argument the method does not declare at the strict API boundary', () => {
    const validate = Schema.toStandardSchemaV1(promptInput, { parseOptions: { onExcessProperty: 'error' } })['~standard'].validate
    expect(validate({ text: 'hello' })).toEqual({ value: { text: 'hello' } })
    expect(validate({ text: 'hello', unexpected: true })).toHaveProperty('issues')
  })
})
