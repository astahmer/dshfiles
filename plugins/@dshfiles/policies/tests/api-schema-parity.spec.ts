import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { publishedJsonSchema, toToolSchema } from '../../../../tooling/dshx/packages/dshx/src/api/json-schema.js'
import { policiesApi } from '../src/api.js'

const snapshotPath = new URL('./api-schema.snapshot.json', import.meta.url)

it('preserves the API and agent-tool schemas byte-for-byte', () => {
  const methods = Object.entries(policiesApi.methods).map(([name, method]) => ({
    name,
    description: method.description,
    tool: method.tool && { name: method.tool.name, description: method.tool.description, readOnly: method.tool.readOnly },
    input: publishedJsonSchema(method.input, 'input'),
    output: publishedJsonSchema(method.output, 'output'),
    toolInput: method.tool ? toToolSchema(publishedJsonSchema(method.input, 'input')) : undefined,
  }))
  const actual = `${JSON.stringify({ id: policiesApi.id, owner: policiesApi.owner, version: policiesApi.version, methods }, null, 2)}\n`
  if (process.env.UPDATE_API_SCHEMA_SNAPSHOT === '1') {
    writeFileSync(snapshotPath, actual)
    return
  }
  expect(actual).toBe(readFileSync(snapshotPath, 'utf8'))
})
