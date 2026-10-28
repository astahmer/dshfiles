import { describe, expect, it } from 'vitest'
import { packDefinitionSchema, resourceRefSchema, trackingPack } from '../src/model.js'
import { ResourceValidation } from '../src/validation.js'

const property = { id: 'status', label: 'Status', type: 'select', options: [{ id: 'one', label: 'One' }] }
const definition = { id: 'test', version: 1, label: 'Test', properties: [property] }

describe('pack semantic validation beyond the wire shape', () => {
  it('accepts the built-in pack and opaque IDs without case or path normalization', () => {
    expect(ResourceValidation.parseDefinition(trackingPack)).toEqual(trackingPack)
    const ref = { provider: 'native', kind: 'file', id: '../MiXeD/Path % ? # /' }
    expect(resourceRefSchema.parse(ref)).toEqual(ref)
  })

  it.each([
    { ...definition, properties: [property, property] },
    {
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
    { ...definition, properties: [{ ...property, default: 'missing' }] },
    { ...definition, properties: [{ ...property, required: true }] },
    { ...definition, properties: [{ ...property, options: [] }] },
    { ...definition, properties: [{ ...property, id: 'BAD' }] },
  ])('rejects duplicate IDs, required/default fields and malformed definitions: %j', input => {
    expect(() => ResourceValidation.parseDefinition(input)).toThrow()
  })

  it('distinguishes date-only from timezone-qualified datetime, preserving strings', () => {
    const pack = packDefinitionSchema.parse({
      id: 'dates',
      version: 1,
      label: 'Dates',
      properties: [
        { id: 'day', label: 'Day', type: 'date' },
        { id: 'instant', label: 'Instant', type: 'datetime' },
      ],
    })
    expect(ResourceValidation.parseValues(pack, { day: '2000-02-29', instant: '2000-02-29T23:30:00-05:00' })).toEqual({
      day: '2000-02-29',
      instant: '2000-02-29T23:30:00-05:00',
    })
    expect(() => ResourceValidation.parseValues(pack, { day: '1900-02-29' })).toThrow()
    expect(() => ResourceValidation.parseValues(pack, { instant: '2000-02-29' })).toThrow()
    expect(() => ResourceValidation.parseValues(pack, { day: '2000-02-29T23:30:00Z' })).toThrow()
  })
})
