import { readFileSync, writeFileSync } from 'node:fs'
import { it, expect } from 'vitest'
import { publishedJsonSchema, toToolSchema } from '../../../../tooling/dshx/packages/dshx/src/api/json-schema.js'
import { loopbackAccessApi } from './api.js'

const normalizeEol = (text: string): string => text.replace(/\r\n/g, '\n')

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
  const snapshotPath = new URL('./api-schema.snapshot.json', import.meta.url)
  if (process.env.UPDATE_LOOPBACK_ACCESS_SCHEMA_SNAPSHOT === '1') {
    writeFileSync(snapshotPath, actual)
    return
  }
  const expected = readFileSync(snapshotPath, 'utf8')
  expect(normalizeEol(actual)).toBe(normalizeEol(expected))
})
