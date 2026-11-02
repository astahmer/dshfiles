import '../../../../tooling/dshx/packages/dshx/src/effect/index.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { it, expect } from 'vitest'
import { publishedJsonSchema, toToolSchema } from '../../../../tooling/dshx/packages/dshx/src/api/json-schema.js'
import { agentsApi } from '../src/api.js'

const snapshotPath = new URL('../src/api-schema.snapshot.json', import.meta.url)

it('keeps the published API and agent-tool schemas stable', () => {
  const methods = Object.entries(agentsApi.methods).map(([name, method]) => ({
    name,
    description: method.description,
    tool: method.tool && { name: method.tool.name, description: method.tool.description, readOnly: method.tool.readOnly },
    input: publishedJsonSchema(method.input, 'input'),
    output: publishedJsonSchema(method.output, 'output'),
    toolInput: method.tool ? toToolSchema(publishedJsonSchema(method.input, 'input')) : undefined,
    toolOutput: method.tool ? toToolSchema(publishedJsonSchema(method.output, 'output')) : undefined,
  }))
  const actual = `${JSON.stringify({ id: agentsApi.id, owner: agentsApi.owner, version: agentsApi.version, methods }, null, 2)}\n`
  if (process.env.UPDATE_API_SCHEMA_SNAPSHOT === '1') {
    writeFileSync(snapshotPath, actual)
    return
  }
  expect(actual).toBe(readFileSync(snapshotPath, 'utf8'))
})
