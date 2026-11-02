import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { publishedJsonSchema, toToolSchema } from '../../../../tooling/dshx/packages/dshx/src/api/json-schema.js'
import { continuationApi } from '../src/continuation-api.js'
import { interruptionApi } from '../src/interruption-api.js'
import { sessionsApi } from '../src/sessions-api.js'
import { threadModelApi } from '../src/thread-model-api.js'

const snapshotPath = new URL('../src/api-schema.snapshot.json', import.meta.url)

const apis = [continuationApi, interruptionApi, sessionsApi, threadModelApi]

it('preserves API and agent-tool schemas byte-for-byte', () => {
  const dump = apis.map(contract => ({
    id: contract.id,
    owner: contract.owner,
    version: contract.version,
    methods: Object.entries(contract.methods).map(([name, method]) => ({
      name,
      description: method.description,
      tool: method.tool && { name: method.tool.name, description: method.tool.description, readOnly: method.tool.readOnly },
      input: publishedJsonSchema(method.input, 'input'),
      output: publishedJsonSchema(method.output, 'output'),
      toolInput: method.tool ? toToolSchema(publishedJsonSchema(method.input, 'input')) : undefined,
      toolOutput: method.tool ? toToolSchema(publishedJsonSchema(method.output, 'output')) : undefined,
    })),
  }))
  const actual = `${JSON.stringify({ apis: dump }, null, 2)}\n`
  if (process.env.UPDATE_API_SCHEMA_SNAPSHOT === '1') {
    writeFileSync(snapshotPath, actual)
    return
  }
  expect(actual).toBe(readFileSync(snapshotPath, 'utf8'))
})
