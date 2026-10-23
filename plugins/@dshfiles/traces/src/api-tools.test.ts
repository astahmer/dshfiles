import { describe, expect, test } from 'vitest'
import { clearInputSchema, tracesApi } from './api.js'

describe('traces agent tools', () => {
  test('every traces capability is a named tool and only clear writes', () => {
    const tools = Object.values(tracesApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'traces_clear',
      'traces_error_groups',
      'traces_get',
      'traces_list_services',
      'traces_search',
      'traces_search_logs',
      'traces_service_map',
      'traces_status',
    ])
    expect(tools.filter(tool => tool.readOnly !== true).map(tool => tool.name)).toEqual(['traces_clear'])
    for (const method of Object.values(tracesApi.methods)) expect(method.description).toBeTruthy()
  })

  test('clear refuses to run without an explicit confirm', () => {
    expect(clearInputSchema.safeParse({}).success).toBe(false)
    expect(clearInputSchema.safeParse({ confirm: false }).success).toBe(false)
    expect(clearInputSchema.safeParse({ confirm: true }).success).toBe(true)
  })
})
