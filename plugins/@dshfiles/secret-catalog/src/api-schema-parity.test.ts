import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { secretCatalogApi, secretSetupApi } from './api.js'

const closedDocument = (schema: unknown) => (Schema.isSchema(schema) ? Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' }) : null)

const apiSchemas = () =>
  [secretCatalogApi, secretSetupApi].flatMap(api =>
    Object.entries(api.methods).map(([methodName, method]) => ({
      api: api.id,
      method: methodName,
      input: closedDocument(method.input),
      output: closedDocument(method.output),
    })),
  )

describe('Secret Catalog API JSON schemas', () => {
  it('byte-matches the recorded contract snapshot', () => {
    expect(JSON.stringify(apiSchemas())).toMatchSnapshot()
  })
})
