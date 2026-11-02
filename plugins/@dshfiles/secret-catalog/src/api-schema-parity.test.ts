import { describe, expect, it } from 'vitest'
import { secretCatalogApi, secretSetupApi } from './api.js'

const apiSchemas = () =>
  [secretCatalogApi, secretSetupApi].flatMap(api =>
    Object.entries(api.methods).map(([methodName, method]) => ({
      api: api.id,
      method: methodName,
      input: method.input?.['~standard'].jsonSchema?.input({ target: 'draft-2020-12' }),
      output: method.output?.['~standard'].jsonSchema?.output({ target: 'draft-2020-12' }),
    })),
  )

describe('Secret Catalog API JSON schemas', () => {
  it('byte-matches the recorded contract snapshot', () => {
    expect(JSON.stringify(apiSchemas())).toMatchSnapshot()
  })
})
