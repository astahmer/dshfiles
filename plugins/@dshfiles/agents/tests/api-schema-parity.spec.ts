import '../../../../tooling/dshx/packages/dshx/src/effect/index.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { Schema } from 'effect'
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

it('the agents_save tool takes an optional colour slot, null to clear it', () => {
  const save = agentsApi.methods.save
  const toolInput = JSON.stringify(toToolSchema(publishedJsonSchema(save.input, 'input')))
  expect(toolInput).toContain('"tone"')
  expect(save.tool?.description ?? save.description).toMatch(/tone/u)
  const draft = {
    handle: 'luna',
    name: 'Luna',
    glyph: '🌙',
    description: '',
    instructions: '',
    preset: null,
    route: null,
    memoryScope: null,
    routine: '',
    delegation: { messaging: 'any', handles: [], subagents: true },
    enabled: true,
  }
  const decode = Schema.decodeUnknownSync(save.input)
  expect(decode({ agent: { ...draft, tone: 2 } }).agent.tone).toBe(2)
  expect(decode({ agent: { ...draft, tone: null } }).agent.tone).toBeNull()
  expect(decode({ agent: draft }).agent).not.toHaveProperty('tone')
  expect(() => decode({ agent: { ...draft, tone: 6 } })).toThrow()
})
