import { readFileSync, writeFileSync } from 'node:fs'
import * as Schema from 'effect/Schema'
import { expect, it } from 'vitest'
import { publishedJsonSchema, toToolSchema } from '../../../../tooling/dshx/packages/dshx/src/api/json-schema.js'
import { sessionSearchApi } from '../src/api.js'
import { strictStandardSchema } from '../src/schema.js'

const snapshotPath = new URL('../src/api-schema.snapshot.json', import.meta.url)

it('preserves API and agent-tool schemas byte-for-byte', () => {
  const methods = Object.entries(sessionSearchApi.methods).map(([name, method]) => ({
    name,
    description: method.description,
    tool: method.tool && { name: method.tool.name, description: method.tool.description, readOnly: method.tool.readOnly },
    input: publishedJsonSchema(method.input, 'input'),
    output: publishedJsonSchema(method.output, 'output'),
    toolInput: method.tool ? toToolSchema(publishedJsonSchema(method.input, 'input')) : undefined,
    toolOutput: method.tool ? toToolSchema(publishedJsonSchema(method.output, 'output')) : undefined,
  }))
  const actual = `${JSON.stringify({ id: sessionSearchApi.id, owner: sessionSearchApi.owner, version: sessionSearchApi.version, methods }, null, 2)}\n`
  if (process.env.UPDATE_API_SCHEMA_SNAPSHOT === '1') {
    writeFileSync(snapshotPath, actual)
    return
  }
  expect(actual).toBe(readFileSync(snapshotPath, 'utf8'))
})

it('keeps the strict input contract: closed object, unknown keys rejected', () => {
  const strict = strictStandardSchema(Schema.Record(Schema.String, Schema.Never))
  expect(strict['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toMatchObject({ type: 'object', additionalProperties: false })
  expect(strict['~standard'].validate({ unexpected: true })).toMatchObject({ issues: expect.any(Array) })
  expect(strict['~standard'].validate({})).toEqual({ value: {} })
})
