import { createHash } from 'node:crypto'
import type { ImageContent, TextContent, Tool, TranscriptContext } from '@earendil-works/pi-ai'
import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'

/**
 * What the CLI-driven routes (Claude Code, Antigravity) share: the stdio MCP server through which DSH's tools reach a
 * vendor CLI, and the transcript helpers that hand a new CLI process the conversation it continues.
 */

/** Stdio MCP server run by the CLI: lists DSH's tools from a file and forwards each call over a unix socket. */
export const MCP_BRIDGE_SOURCE = `
import { createConnection } from 'node:net'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const [toolsFile, socketPath] = process.argv.slice(1)
const tools = JSON.parse(readFileSync(toolsFile, 'utf8'))
const send = message => process.stdout.write(JSON.stringify(message) + '\\n')
const socket = createConnection(socketPath)
socket.setEncoding('utf8')
// The bridge lives only as long as its CLI process (stdin) and the Host (the pipe): either ending stops it, so a
// cancelled turn never leaves it running in, and locking, its working directory.
socket.on('close', () => process.exit(0))
socket.on('error', () => process.exit(0))
let buffer = ''
socket.on('data', chunk => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const reply = JSON.parse(buffer.slice(0, newline))
    buffer = buffer.slice(newline + 1)
    send({ jsonrpc: '2.0', id: reply.id, result: { content: reply.content, isError: reply.isError } })
  }
})
createInterface({ input: process.stdin }).on('line', line => {
  if (line.trim() === '') return
  const request = JSON.parse(line)
  if (request.method === 'initialize')
    return send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'dsh', version: '1' } } })
  if (request.method === 'tools/list') return send({ jsonrpc: '2.0', id: request.id, result: { tools } })
  if (request.method === 'tools/call') return socket.write(JSON.stringify({ id: request.id, name: request.params.name, arguments: request.params.arguments ?? {} }) + '\\n')
  if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, result: {} })
}).on('close', () => process.exit(0))
`

/** One call the bridge forwarded: its MCP request id, the bare tool name and its arguments. */
export const bridgeCallSchema = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  name: Schema.String,
  arguments: Schema.Record(Schema.String, Schema.Json),
})

export class CliBridge {
  /** One line the CLI or the bridge wrote, decoded; a non-JSON line (a warning, a stray log) fails like a malformed one. */
  static readonly decodeJsonLine = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, line: string) =>
    AiAccountsSchema.decodeResult(Schema.fromJsonString(schema), line)

  static readonly fingerprint = (json: string): string => createHash('sha256').update(json).digest('hex').slice(0, 16)

  static readonly toMcpTool = (tool: Tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })

  /** A tool result as MCP content blocks. */
  static readonly toolResultContent = (content: readonly (TextContent | ImageContent)[]) =>
    content.map(block => (block.type === 'text' ? { type: 'text', text: block.text } : { type: 'image', data: block.data, mimeType: block.mimeType }))

  /** Plain-text rendering of a transcript a new process must pick up, since the CLI input takes only user turns. */
  static readonly renderTranscript = (messages: TranscriptContext['messages']): string => {
    const lines: string[] = []
    for (const message of messages) {
      if (message.role === 'user')
        lines.push(
          `<user>\n${!Array.isArray(message.content) ? message.content : message.content.map(block => (block.type === 'text' ? block.text : '[image]')).join('\n')}\n</user>`,
        )
      if (message.role === 'assistant')
        for (const block of message.content) {
          if (block.type === 'text') lines.push(`<assistant>\n${block.text}\n</assistant>`)
          if (block.type === 'toolCall') lines.push(`<tool_call name="${block.name}" id="${block.id}">${JSON.stringify(block.arguments)}</tool_call>`)
        }
      if (message.role === 'toolResult')
        lines.push(
          `<tool_result name="${message.toolName}" id="${message.toolCallId}"${message.isError ? ' error="true"' : ''}>\n${message.content.map(block => (block.type === 'text' ? block.text : '[image]')).join('\n')}\n</tool_result>`,
        )
    }
    return lines.join('\n')
  }

  /**
   * First index of the trailing run of user messages DSH appends for one step. One CLI turn answers all of them
   * together, because the CLI treats every prompt it receives as a turn of its own.
   */
  static readonly trailingUserStart = (conversation: readonly { readonly role: string }[]): number => {
    let start = conversation.length
    while (start > 0 && conversation[start - 1]?.role === 'user') start -= 1
    return start
  }
}
