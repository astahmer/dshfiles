import { readFileSync } from 'node:fs'
import { it, expect } from 'vitest'
import { publishedJsonSchema, toToolSchema } from '../../../../tooling/dshx/packages/dshx/src/api/json-schema.js'
import { loopbackAccessApi } from './api.js'

it('preserves API and agent-tool schemas byte-for-byte', () => {
  const methods = Object.entries(loopbackAccessApi.methods).map(([name, method]) => ({
    name,
    description: method.description,
    tool: method.tool && { name: method.tool.name, description: method.tool.description, readOnly: method.tool.readOnly },
    input: publishedJsonSchema(method.input, 'input'),
    output: publishedJsonSchema(method.output, 'output'),
    toolInput: method.tool ? toToolSchema(publishedJsonSchema(method.input, 'input')) : undefined,
    toolOutput: method.tool ? toToolSchema(publishedJsonSchema(method.output, 'output')) : undefined,
  }))
  const actual = JSON.stringify({ id: loopbackAccessApi.id, owner: loopbackAccessApi.owner, version: loopbackAccessApi.version, methods }, null, 2)
  const expected = readFileSync(new URL('./api-schema.snapshot.json', import.meta.url), 'utf8')
  expect(actual).toBe(expected)
})
