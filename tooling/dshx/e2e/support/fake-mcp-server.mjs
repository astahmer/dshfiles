#!/usr/bin/env node
// A minimal MCP stdio server for browser journeys: newline-delimited JSON-RPC with one echo tool.
import { createInterface } from 'node:readline'

const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

createInterface({ input: process.stdin }).on('line', line => {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    return
  }
  if (request.id === undefined) return
  if (request.method === 'initialize') {
    return send({
      id: request.id,
      result: { protocolVersion: request.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dshx-e2e-mcp', version: '1.0.0' } },
    })
  }
  if (request.method === 'tools/list') {
    return send({
      id: request.id,
      result: {
        tools: [
          {
            name: 'e2e_echo',
            description: 'Echo the given text back.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          },
        ],
      },
    })
  }
  if (request.method === 'tools/call') {
    return send({ id: request.id, result: { content: [{ type: 'text', text: `echo: ${request.params?.arguments?.text ?? ''}` }] } })
  }
  if (request.method === 'ping') return send({ id: request.id, result: {} })
  send({ id: request.id, error: { code: -32601, message: `Unsupported method ${request.method}` } })
})
