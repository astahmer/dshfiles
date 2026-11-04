import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Result, Schema } from 'effect'
import { packDefinitionSchema, resourceRefSchema, trackingPack } from '../src/model.js'
import { ResourceValidation } from '../src/validation.js'

const property = { id: 'status', label: 'Status', type: 'select', options: [{ id: 'one', label: 'One' }] }
const definition = { id: 'test', version: 1, label: 'Test', properties: [property] }
const decodeDefinition = Schema.decodeUnknownResult(packDefinitionSchema, { onExcessProperty: 'error' })

describe('pack semantic validation beyond the wire shape', () => {
  it.effect('accepts the built-in pack and opaque IDs without case or path normalization', () =>
    Effect.gen(function* () {
      expect(yield* ResourceValidation.checkDefinition(trackingPack)).toEqual(trackingPack)
      const ref = { provider: 'native', kind: 'file', id: '../MiXeD/Path % ? # /' }
      expect(Schema.decodeUnknownSync(resourceRefSchema)(ref)).toEqual(ref)
    }),
  )

  it.effect.each([
    { input: { ...definition, properties: [property, property] }, reason: 'duplicate-property' },
    {
      input: {
        ...definition,
        properties: [
          {
            ...property,
            options: [
              { id: 'one', label: 'One' },
              { id: 'one', label: 'Duplicate' },
            ],
          },
        ],
      },
      reason: 'duplicate-option',
    },
  ])('rejects duplicate IDs the wire shape accepts: $reason', ({ input, reason }) =>
    Effect.gen(function* () {
      const decoded = decodeDefinition(input)
      if (Result.isFailure(decoded)) throw new Error('The wire shape should accept duplicate IDs')
      const error = yield* Effect.flip(ResourceValidation.checkDefinition(decoded.success))
      expect(error).toMatchObject({ _tag: 'InvalidPackDefinition', reason })
    }),
  )

  it.each([
    { ...definition, properties: [{ ...property, default: 'missing' }] },
    { ...definition, properties: [{ ...property, required: true }] },
    { ...definition, properties: [{ ...property, options: [] }] },
    { ...definition, properties: [{ ...property, id: 'BAD' }] },
  ])('refuses required/default fields and malformed definitions at the wire shape: %j', input => {
    expect(Result.isFailure(decodeDefinition(input))).toBe(true)
  })

  it.effect('distinguishes date-only from timezone-qualified datetime, preserving strings', () =>
    Effect.gen(function* () {
      const pack = Schema.decodeUnknownSync(packDefinitionSchema)({
        id: 'dates',
        version: 1,
        label: 'Dates',
        properties: [
          { id: 'day', label: 'Day', type: 'date' },
          { id: 'instant', label: 'Instant', type: 'datetime' },
        ],
      })
      const check = (values: Record<string, string>) => ResourceValidation.checkValues({ definition: pack, values })
      expect(yield* check({ day: '2000-02-29', instant: '2000-02-29T23:30:00-05:00' })).toEqual({
        day: '2000-02-29',
        instant: '2000-02-29T23:30:00-05:00',
      })
      for (const values of [{ day: '1900-02-29' }, { instant: '2000-02-29' }, { day: '2000-02-29T23:30:00Z' }]) {
        expect(Exit.isFailure(yield* Effect.exit(check(values)))).toBe(true)
      }
    }),
  )
})
