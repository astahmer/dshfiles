import { describe, expect, test } from 'vitest'
import { usageApi } from './api.js'

describe('usage tool exposure', () => {
  test('index status and re-index are named tools', () => {
    const tools = Object.values(usageApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual(['usage_jev_report', 'usage_reindex', 'usage_report', 'usage_requests', 'usage_status'])
    const readOnly = tools
      .filter(tool => tool.readOnly === true)
      .map(tool => tool.name)
      .sort()
    expect(readOnly).toEqual(['usage_jev_report', 'usage_report', 'usage_requests', 'usage_status'])
    expect(usageApi.methods.recordJevUsage.tool).toBeUndefined()
    expect(usageApi.methods.refresh.description ?? '').toMatch(/Call only when the user asked/u)
  })

  test('Jev usage report is read-only and request recording stays internal', () => {
    expect(usageApi.methods.jevUsage.tool).toMatchObject({ name: 'usage_jev_report', readOnly: true })
    expect(usageApi.methods.recordJevUsage.tool).toBeUndefined()
  })
})
