import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { threadActionsApi } from './thread-actions-api.js'

const promptInput = threadActionsApi.methods.prompt.input
if (promptInput === undefined) throw new Error('thread_prompt declares no input schema')

const fanOutInput = threadActionsApi.methods.fanOut.input
if (fanOutInput === undefined) throw new Error('thread_fan_out declares no input schema')

describe('thread actions API schemas', () => {
  it('accepts two to six models and rejects invalid fan-out sizes', () => {
    const validate = Schema.toStandardSchemaV1(fanOutInput, { parseOptions: { onExcessProperty: 'error' } })['~standard'].validate
    const model = { provider: 'provider', model: 'model' }
    expect(validate({ text: 'Compare', models: [model, model] })).toHaveProperty('value')
    expect(validate({ text: 'Compare', models: [model] })).toHaveProperty('issues')
    expect(validate({ text: 'Compare', models: Array.from({ length: 7 }, () => model) })).toHaveProperty('issues')
    expect(validate({ projectId: 'project', cwd: '/work/project', text: 'Compare', models: [model, model] })).toHaveProperty('issues')
  })
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
