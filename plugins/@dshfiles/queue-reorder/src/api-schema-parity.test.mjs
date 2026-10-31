import { describe, expect, it } from 'vitest'
import { queueApi } from './api.js'
import queueReorderHost from './host.js'

const schemaSnapshot = () => ({
  api: Object.entries(queueApi.methods).map(([methodName, method]) => ({
    method: methodName,
    input: method.input?.['~standard'].jsonSchema?.input({ target: 'draft-2020-12' }),
    output: method.output?.['~standard'].jsonSchema?.output({ target: 'draft-2020-12' }),
    tool: method.tool === undefined ? undefined : { name: method.tool.name, description: method.tool.description, readOnly: method.tool.readOnly },
  })),
  nativeTools: queueReorderHost.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    output: tool.output.schema,
  })),
})

describe('queue-reorder API and tool schema parity', () => {
  it('retains the pre-Effect schemas byte-for-byte', () => {
    expect(JSON.stringify(schemaSnapshot())).toMatchSnapshot()
  })
})
