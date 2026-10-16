import { describe, expect, test } from 'vitest'
import { usageApi } from './api.js'

describe('usage tool exposure', () => {
  test('index status and re-index are named tools', () => {
    const tools = Object.values(usageApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual(['usage_reindex', 'usage_report', 'usage_requests', 'usage_status'])
    const readOnly = tools
      .filter(tool => tool.readOnly === true)
      .map(tool => tool.name)
      .sort()
    expect(readOnly).toEqual(['usage_report', 'usage_requests', 'usage_status'])
    expect(usageApi.methods.refresh.description ?? '').toMatch(/Call only when the user asked/u)
  })
})
