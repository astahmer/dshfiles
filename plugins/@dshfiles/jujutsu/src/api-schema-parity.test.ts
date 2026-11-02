import { readFileSync, writeFileSync } from 'node:fs'
import { it, expect } from 'vitest'
import { composerContextApi } from './composer-context-api.js'
import { jujutsuApi } from './api.js'
import { jujutsuReviewProgressApi } from './review-progress-api.js'

const normalizeEol = (text: string): string => text.replace(/\r\n/g, '\n')

const contracts = [jujutsuApi, composerContextApi, jujutsuReviewProgressApi]

it('preserves Jujutsu API and agent-tool schemas byte-for-byte', async () => {
  await import(new URL('../../../../tooling/dshx/packages/dshx/src/effect/index.ts', import.meta.url).href)
  const { publishedJsonSchema, toToolSchema } = await import(new URL('../../../../tooling/dshx/packages/dshx/src/api/json-schema.ts', import.meta.url).href)
  const schemas = contracts.map(contract => ({
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
  const actual = `${JSON.stringify(schemas, null, 2)}\n`
  const snapshotPath = new URL('./api-schema.snapshot.json', import.meta.url)

  if (process.env.UPDATE_JUJUTSU_SCHEMA_SNAPSHOT === '1') {
    writeFileSync(snapshotPath, actual)
    return
  }

  expect(normalizeEol(actual)).toBe(normalizeEol(readFileSync(snapshotPath, 'utf8')))
})
