import { describe, expect, it } from 'vitest'
import { serializedSchemaBytes } from './schema-measurement.js'

describe('serializedSchemaBytes', () => {
  it('counts UTF-8 bytes rather than UTF-16 code units for Unicode schemas', () => {
    const schemaJson = JSON.stringify([{ name: 'read_file', description: 'Read café 🛠' }])

    expect(serializedSchemaBytes(schemaJson)).toBe(Buffer.byteLength(schemaJson, 'utf8'))
    expect(serializedSchemaBytes(schemaJson)).toBeGreaterThan(schemaJson.length)
  })
})
