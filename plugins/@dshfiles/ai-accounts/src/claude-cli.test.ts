import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeContext, type AssistantMessage, type AssistantMessageEventStream, type Message } from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { afterEach, expect, it } from 'vitest'
import { ClaudeCliSessions } from './claude-cli.js'

/**
 * Stands in for `claude -p` in stream-json mode: starts the MCP server named in `--mcp-config`, and for a user turn
 * that says "call" asks for the first tool, waits for the bridge to answer, then reports the answer; any other turn is
 * echoed with this process id, so a test can tell whether a process was reused.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { createInterface } = require('node:readline')
const config = JSON.parse(readFileSync(process.argv[process.argv.indexOf('--mcp-config') + 1], 'utf8'))
const server = Object.values(config.mcpServers)[0]
const mcp = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] })
const waiting = new Map()
let nextId = 1
createInterface({ input: mcp.stdout }).on('line', line => { const reply = JSON.parse(line); waiting.get(reply.id)?.(reply); waiting.delete(reply.id) })
const rpc = (method, params) => new Promise(resolve => { const id = nextId++; waiting.set(id, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n') })
const out = value => process.stdout.write(JSON.stringify(value) + '\\n')
const event = value => out({ type: 'stream_event', event: value })
const say = (text, stop) => {
  event({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } })
  event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  event({ type: 'content_block_stop', index: 0 })
  event({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 3 } })
  event({ type: 'message_stop' })
}
const ready = rpc('initialize', { protocolVersion: '2025-06-18' }).then(() => rpc('tools/list', {}))
createInterface({ input: process.stdin }).on('line', async line => {
  const { tools } = (await ready).result
  const text = JSON.parse(line).message.content.map(block => block.text ?? '').join('')
  if (!text.includes('call')) {
    say('echo ' + process.pid + ': ' + text, 'end_turn')
    return out({ type: 'result', subtype: 'success', is_error: false })
  }
  event({ type: 'message_start', message: { usage: { input_tokens: 10 } } })
  event({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__dsh__' + tools[0].name } })
  event({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"value":"ping"}' } })
  event({ type: 'content_block_stop', index: 0 })
  event({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } })
  event({ type: 'message_stop' })
  const answer = await rpc('tools/call', { name: tools[0].name, arguments: { value: 'ping' } })
  say('tool said ' + answer.result.content.map(block => block.text).join(''), 'end_turn')
  out({ type: 'result', subtype: 'success', is_error: false })
})
`

const directories: string[] = []
const sessions: ClaudeCliSessions[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const finished = async (stream: AssistantMessageEventStream): Promise<AssistantMessage> => {
  for await (const event of stream) {
    if (event.type === 'done') return event.message
    if (event.type === 'error') throw new Error(event.error.errorMessage)
  }
  throw new Error('stream ended without a result')
}

const textOf = (message: AssistantMessage): string => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')

it('holds a tool call until DSH answers it, then continues the same claude process', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-cli-test-'))
  directories.push(directory)
  const executable = join(directory, 'claude')
  writeFileSync(executable, FAKE_CLAUDE)
  chmodSync(executable, 0o755)
  const cli = new ClaudeCliSessions({ configDir: () => join(directory, '.claude'), executable })
  sessions.push(cli)
  const [model] = anthropicProvider().getModels()
  if (model === undefined) throw new Error('pi-ai lists no Anthropic model')
  const tool = { name: 'echo_tool', description: 'Echo a value', parameters: { type: 'object', properties: { value: { type: 'string' } } } }
  const messages: Message[] = [{ role: 'user', content: 'please call the tool', timestamp: 1 }]
  const context = () => normalizeContext({ systemPrompt: 'You are inside DSH.', tools: [tool as never], messages })
  const options = { sessionId: 'session-test' }

  const first = await finished(cli.stream(model, context(), options))
  expect(first.stopReason).toBe('toolUse')
  expect(first.content).toMatchObject([{ type: 'toolCall', id: 'toolu_1', name: 'echo_tool', arguments: { value: 'ping' } }])

  messages.push(first, {
    role: 'toolResult',
    toolCallId: 'toolu_1',
    toolName: 'echo_tool',
    content: [{ type: 'text', text: 'pong' }],
    isError: false,
    timestamp: 2,
  })
  const second = await finished(cli.stream(model, context(), options))
  expect(textOf(second)).toBe('tool said pong')
  expect(second.stopReason).toBe('stop')

  messages.push(second, { role: 'user', content: 'hello again', timestamp: 3 })
  const third = await finished(cli.stream(model, context(), options))
  messages.push(third, { role: 'user', content: 'and once more', timestamp: 4 })
  const fourth = await finished(cli.stream(model, context(), options))
  const processOf = (message: AssistantMessage) => /^echo (\d+):/.exec(textOf(message))?.[1]
  expect(textOf(third)).toMatch(/: hello again$/)
  expect(processOf(fourth)).toBe(processOf(third))
})
