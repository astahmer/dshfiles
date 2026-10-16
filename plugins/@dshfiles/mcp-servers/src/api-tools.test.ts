import { describe, expect, test } from 'vitest'
import { mcpServersApi } from './api.js'

describe('mcp-servers tool exposure', () => {
  test('every MCP manager action a human can take is a named tool', () => {
    const tools = Object.values(mcpServersApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'mcp_list_servers',
      'mcp_refresh_servers',
      'mcp_remove_server',
      'mcp_save_server',
      'mcp_search_registry',
      'mcp_set_connection',
      'mcp_set_preferences',
      'mcp_set_server_enabled',
      'mcp_sign_out_server',
    ])
  })

  test('inspection stays read-only and every write needs the user to have asked', () => {
    const readOnly = Object.values(mcpServersApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
      .sort()
    expect(readOnly).toEqual(['mcp_list_servers', 'mcp_search_registry'])
    for (const method of Object.values(mcpServersApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
      if (method.tool.readOnly !== true) expect(method.description ?? '').toMatch(/Call only when the user asked/u)
    }
  })

  test('OAuth authorize stays untooled: it needs the browser origin and a human consent step', () => {
    expect(mcpServersApi.methods.authorize.tool).toBeUndefined()
  })
})
