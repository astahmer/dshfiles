import { describe, expect, it } from 'vitest'
import { StatelessMcpModel } from './stateless-protocol.js'

describe('MCP 2026-07-28 era detection', () => {
  it('stays modern on a recognized modern error and falls back on anything else', () => {
    expect(StatelessMcpModel.classifyProbe(200, { jsonrpc: '2.0', id: 1, result: { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } })).toEqual({
      kind: 'modern',
      discovery: { version: '2026-07-28', capabilities: { tools: {} }, instructions: '' },
    })
    expect(StatelessMcpModel.classifyProbe(400, { jsonrpc: '2.0', id: 1, error: { code: -32022, message: 'Unsupported', data: { supported: ['2099-01-01'] } } }).kind).toBe('incompatible')
    expect(StatelessMcpModel.classifyProbe(400, { jsonrpc: '2.0', id: 1, error: { code: -32020, message: 'mismatch' } }).kind).toBe('incompatible')
    expect(StatelessMcpModel.classifyProbe(400, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Server not initialized' } }).kind).toBe('legacy')
    expect(StatelessMcpModel.classifyProbe(404, { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }).kind).toBe('legacy')
    expect(StatelessMcpModel.classifyProbe(405, undefined).kind).toBe('legacy')
    expect(StatelessMcpModel.classifyProbe(200, { result: { supportedVersions: ['2025-11-25'] } }).kind).toBe('incompatible')
  })
})

describe('MCP 2026-07-28 request metadata', () => {
  it('encodes header values per the spec examples', () => {
    expect(StatelessMcpModel.encodeHeaderValue('us-west1')).toBe('us-west1')
    expect(StatelessMcpModel.encodeHeaderValue('Hello, 世界')).toBe('=?base64?SGVsbG8sIOS4lueVjA==?=')
    expect(StatelessMcpModel.encodeHeaderValue(' padded ')).toBe('=?base64?IHBhZGRlZCA=?=')
    expect(StatelessMcpModel.encodeHeaderValue('line1\nline2')).toBe('=?base64?bGluZTEKbGluZTI=?=')
    expect(StatelessMcpModel.encodeHeaderValue('=?base64?literal?=')).toBe('=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=')
  })

  it('mirrors method, name and protocol version into headers and _meta', () => {
    const wire = StatelessMcpModel.request({ id: 7, method: 'tools/call', params: { name: 'get_weather', arguments: {} }, extraHeaders: { Authorization: 'Bearer t' } })
    expect(wire.headers).toMatchObject({ 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'get_weather', Authorization: 'Bearer t' })
    expect(JSON.parse(wire.body)).toMatchObject({ id: 7, params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } })
    expect(StatelessMcpModel.request({ id: 8, method: 'tools/list', params: {} }).headers).not.toHaveProperty('Mcp-Name')
  })

  it('preserves valid metadata but overrides reserved fields and ignores non-objects', () => {
    const reserved = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'dshfiles-mcp-servers', version: '0.1.0' },
      'io.modelcontextprotocol/clientCapabilities': {},
    }
    const request = (meta: unknown) => StatelessMcpModel.request({ id: 1, method: 'tools/list', params: { _meta: meta } }).body
    expect(request({ custom: 1, ['__proto__']: 'safe', 'io.modelcontextprotocol/protocolVersion': 'old' })).toBe(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { custom: 1, ['__proto__']: 'safe', ...reserved } } }),
    )
    for (const meta of [null, 'invalid', []]) {
      expect(request(meta)).toBe(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: reserved } }))
    }
  })

  it('accepts x-mcp-header only on primitive properties reachable through properties keys', () => {
    const valid = StatelessMcpModel.paramHeaders({
      type: 'object',
      properties: { region: { type: 'string', 'x-mcp-header': 'Region' }, nested: { type: 'object', properties: { id: { type: 'integer', 'x-mcp-header': 'Id' } } } },
    })
    expect(valid).toEqual({ ok: true, headers: [{ path: ['region'], header: 'Region' }, { path: ['nested', 'id'], header: 'Id' }] })
    expect(StatelessMcpModel.paramHeaderValues(valid.ok ? valid.headers : [], { region: 'eu', nested: { id: 4 } })).toEqual({ 'Mcp-Param-Region': 'eu', 'Mcp-Param-Id': '4' })
    expect(StatelessMcpModel.paramHeaderValues(valid.ok ? valid.headers : [], { region: null })).toEqual({})

    expect(StatelessMcpModel.paramHeaders({ properties: { n: { type: 'number', 'x-mcp-header': 'N' } } }).ok).toBe(false)
    expect(StatelessMcpModel.paramHeaders({ properties: { a: { type: 'string', 'x-mcp-header': 'X' }, b: { type: 'string', 'x-mcp-header': 'x' } } }).ok).toBe(false)
    expect(StatelessMcpModel.paramHeaders({ properties: { list: { type: 'array', items: { type: 'string', 'x-mcp-header': 'Item' } } } }).ok).toBe(false)
    expect(StatelessMcpModel.paramHeaders({ properties: { a: { type: 'string', 'x-mcp-header': 'bad name' } } }).ok).toBe(false)
  })
})

describe('MCP 2026-07-28 responses', () => {
  it('decodes SSE events across chunk boundaries and ignores comments', () => {
    const decode = StatelessMcpModel.sseDecoder()
    expect(decode(': keep-alive\n\ndata: {"a"')).toEqual([])
    expect(decode(':1}\r\n\r\ndata: x\ndata: y\n\n')).toEqual(['{"a":1}', 'x\ny'])
  })

  it('treats a missing resultType as complete and refuses input_required', () => {
    expect(StatelessMcpModel.completeResult({ tools: [] })).toEqual({ ok: true, result: { tools: [] } })
    expect(StatelessMcpModel.completeResult({ resultType: 'complete', tools: [] })).toEqual({ ok: true, result: { tools: [] } })
    expect(StatelessMcpModel.completeResult({ resultType: 'input_required', inputRequests: {} }).ok).toBe(false)
  })
})
