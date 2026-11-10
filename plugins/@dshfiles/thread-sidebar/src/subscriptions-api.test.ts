import { expect, it } from 'vitest'
import * as Schema from 'effect/Schema'
import { threadSubscriptionsApi } from './subscriptions-api.js'

const inputOf = (method: keyof typeof threadSubscriptionsApi.methods) => {
  const input = threadSubscriptionsApi.methods[method].input
  if (input === undefined) throw new Error(`the ${method} subscription method declares no input schema`)
  return input
}

const documentOf = (method: keyof typeof threadSubscriptionsApi.methods) => Schema.toJsonSchemaDocument(inputOf(method), { onExcessProperty: 'error' })

it('every subscription tool publishes an object schema with its arguments', () => {
  expect(documentOf('state').schema).toMatchObject({
    type: 'object',
    properties: { subscriberSessionId: {}, targetSessionId: {} },
  })
  expect(documentOf('subscribe').schema).toMatchObject({
    type: 'object',
    properties: { sessionId: {}, subscriberSessionId: {} },
    required: ['sessionId'],
  })
  expect(documentOf('unsubscribe').schema).toMatchObject({
    type: 'object',
    properties: { sessionId: {}, subscriberSessionId: {} },
    required: ['sessionId'],
  })
})

it('a subscription tool still rejects an unknown argument', async () => {
  const standard = Schema.toStandardSchemaV1(inputOf('subscribe'), { parseOptions: { onExcessProperty: 'error' } })['~standard']
  const result = await standard.validate({ sessionId: 'session-target', unexpected: true })
  expect('issues' in result ? result.issues : undefined).toBeDefined()
})
