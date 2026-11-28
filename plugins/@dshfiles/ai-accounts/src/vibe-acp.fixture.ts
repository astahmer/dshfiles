import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Stands in for `vibe-acp`: the ACP stdio server Mistral Vibe 3.1.5 serves from `vibe/acp/agent.py`.
 *
 * It answers `initialize`, projects the `session/new` MCP server exactly as Vibe does (spawns the command from the
 * `mcpServers` entry, lists the tools DSH offers, publishes them as `{server}_{tool}`), offers the config options Vibe
 * offers (`agent` for the profiles discovered under `additionalDirectories`, `model`, `thinking`), and on
 * `session/prompt` publishes the `tool_call` start BEFORE calling the tool — the ordering the DSH bridge depends on.
 * Scenarios are selected by tokens in the prompt text, so one fake covers the tool round trip, permission requests, a
 * builtin tool call Vibe runs itself, usage reporting and plain answers. Like Vibe 3.1.5, it denies a builtin the
 * selected agent profile's `enabled_tools` leaves out before any `session/request_permission`: the call fails with
 * `Tool execution denied by approval policy`, which the client never sees as a question.
 *
 * Everything it receives goes to `FAKE_VIBE_ACP_LOG`, one line per event, so a test can assert what the route sent (one
 * `session/new`, the prompts of a continued session) and the order of an ACP update against the bridge call.
 */
export const FAKE_VIBE_ACP = `#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { appendFileSync, existsSync, readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const { createInterface } = require('node:readline')
const out = value => process.stdout.write(JSON.stringify(value) + '\\n')
const log = line => { if (process.env.FAKE_VIBE_ACP_LOG) appendFileSync(process.env.FAKE_VIBE_ACP_LOG, line + '\\n') }
const update = (sessionId, value) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: value } })

let nextId = 1
const waiting = new Map()
let bridge
let tools = []
const mcp = (method, params) =>
  new Promise(resolve => {
    const id = nextId++
    waiting.set(id, resolve)
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n')
  })

/** The agent profiles this Host discovers: Vibe's own plus one file per directory under additionalDirectories. */
const agentNames = directories => {
  const names = ['default', 'explore', 'lean']
  if (process.env.FAKE_VIBE_ACP_NO_AGENTS) return names
  for (const directory of directories) {
    const folder = join(directory, '.vibe', 'agents')
    if (!existsSync(folder)) continue
    for (const file of readdirSync(folder)) names.push(file.replace(/\\.toml$/u, ''))
  }
  return names
}

let directories = []
/** The selected profile's enabled_tools, or undefined when it sets none (Vibe's whole catalogue). */
const enabledTools = () => {
  for (const directory of directories) {
    const file = join(directory, '.vibe', 'agents', agent + '.toml')
    if (!existsSync(file)) continue
    const match = /^enabled_tools = (.*)$/mu.exec(readFileSync(file, 'utf8'))
    return match ? JSON.parse(match[1]) : undefined
  }
  return undefined
}
/** Vibe maps a builtin its catalogue does not offer onto the deny mode, so the client is never asked. */
const catalogued = name => {
  const enabled = enabledTools()
  return enabled === undefined || enabled.some(pattern => pattern === name || (pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1))))
}
const POLICY_DENIAL = 'tool_denied: Tool execution denied by approval policy'
let model = 'deepseek-v4-1-flash-1017'
let thinking = 'low'
let agent = 'default'
let mode = 'accept-edits'
const sessionId = 'session-' + process.pid
let steps = 0
let promptTokens = 0
let completionTokens = 0
let cachedTokens = 0
const options = () => [
  { id: 'mode', currentValue: mode, options: [{ value: 'ask', name: 'Ask' }, { value: 'accept-edits', name: 'Accept Edits' }] },
  { id: 'agent', currentValue: agent, options: agentNames(directories).map(value => ({ value, name: value })) },
  {
    id: 'model',
    currentValue: model,
    options: [
      { value: 'mistral-large-4-0', name: 'Mistral Large 4' },
      { value: 'mistral-medium-latest', name: 'Mistral Medium 3.5' },
      { value: 'deepseek-v4-1-flash-1017', name: 'DeepSeek V4.1 Flash' },
    ],
  },
  { id: 'thinking', currentValue: thinking, options: ['low', 'medium', 'high', 'max'].map(value => ({ value, name: value })) },
]

createInterface({ input: process.stdin }).on('line', async line => {
  if (line.trim() === '') return
  const message = JSON.parse(line)
  const reply = result => out({ jsonrpc: '2.0', id: message.id, result })
  if (message.method === undefined) {
    waiting.get(message.id)?.(message)
    waiting.delete(message.id)
    return
  }
  if (message.method === 'initialize') {
    log('initialize')
    return reply({ protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true } } })
  }
  if (message.method === 'session/new') {
    directories = message.params.additionalDirectories ?? []
    const server = (message.params.mcpServers ?? [])[0]
    log('session/new directories=' + JSON.stringify(directories) + ' mcp=' + JSON.stringify(server ? { name: server.name, command: server.command, args: server.args.length } : null))
    if (process.env.FAKE_VIBE_ACP_SIGNED_OUT) return out({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required' } })
    if (server) {
      bridge = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env } })
      createInterface({ input: bridge.stdout }).on('line', text => {
        const answer = JSON.parse(text)
        waiting.get(answer.id)?.(answer)
        waiting.delete(answer.id)
      })
      await mcp('initialize', { protocolVersion: '2025-11-25' })
      tools = (await mcp('tools/list', {})).result.tools
      log('tools ' + JSON.stringify(tools.map(tool => tool.name)))
    }
    return reply({ sessionId, configOptions: options() })
  }
  if (message.method === 'session/set_mode') {
    mode = message.params.modeId
    log('set_mode ' + mode)
    return reply({})
  }
  if (message.method === 'session/set_config_option') {
    const value = message.params.value
    if (message.params.configId === 'model') model = value
    if (message.params.configId === 'thinking') thinking = value
    if (message.params.configId === 'agent') agent = value
    log('set_config_option ' + message.params.configId + '=' + value)
    return reply({ configOptions: options() })
  }
  if (message.method === 'session/prompt') {
    steps += 1
    promptTokens += 1200
    completionTokens += 34
    cachedTokens += 900
    const text = message.params.prompt.map(block => block.text ?? '').join('')
    log('prompt ' + JSON.stringify(text))
    const say = value => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value }, messageId: 'm' + steps })
    // Vibe reports the session's cumulative stats after each LLM call, so the route can bill one step's share.
    update(sessionId, {
      sessionUpdate: 'usage_update',
      used: 4000 * steps,
      size: 1048576,
      cost: { amount: 0.5 * steps, currency: 'USD' },
      _meta: { steps, promptTokens, completionTokens, cachedTokens, totalTokens: promptTokens + completionTokens, lastTurnTotalTokens: 1234 },
    })
    const answer = () => reply({ stopReason: 'end_turn', usage: { inputTokens: promptTokens, outputTokens: completionTokens, totalTokens: promptTokens + completionTokens, cachedReadTokens: cachedTokens } })
    const toolName = tools[0] ? tools[0].name : 'echo'
    const permission = params =>
      new Promise(resolve => {
        const id = nextId++
        waiting.set(id, resolve)
        out({ jsonrpc: '2.0', id, method: 'session/request_permission', params })
      })
    if (text.includes('CALL_TOOL')) {
      log('tool_call-before-bridge')
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'Echo', kind: 'other', status: 'pending', rawInput: { value: 'ping' }, _meta: { tool_name: 'mcp_dsh.' + toolName } })
      const called = await mcp('tools/call', { name: toolName, arguments: { value: 'ping' } })
      log('bridge-answered')
      say('tool said ' + called.result.content.map(block => block.text).join(''))
      return answer()
    }
    if (text.includes('PERMISSION_READ')) {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_read', title: 'Read file', kind: 'read', status: 'pending', _meta: { tool_name: 'read_file' } })
      if (!catalogued('read_file')) {
        say(POLICY_DENIAL)
        return answer()
      }
      const decision = await permission({ sessionId, toolCall: { toolCallId: 'call_read' }, options: [{ optionId: 'allow_once', kind: 'allow_once' }, { optionId: 'reject_once', kind: 'reject_once' }] })
      say(decision.result?.outcome?.optionId === 'allow_once' ? 'builtin allowed' : 'builtin denied')
      return answer()
    }
    if (text.includes('PERMISSION_BUILTIN')) {
      const decision = await permission({ sessionId, toolCall: { toolCallId: 'call_b1', title: 'Write file' }, options: [{ optionId: 'allow_once', kind: 'allow_once' }, { optionId: 'reject_once', kind: 'reject_once' }] })
      log('permission ' + JSON.stringify(decision.result))
      say('permission handled')
      return answer()
    }
    if (text.includes('PERMISSION')) {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_p1', title: 'Echo', kind: 'other', status: 'pending', rawInput: { value: 'ping' }, _meta: { tool_name: 'mcp_dsh.' + toolName } })
      const decision = await permission({ sessionId, toolCall: { toolCallId: 'call_p1' }, options: [{ optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' }, { optionId: 'reject_once', kind: 'reject_once', name: 'Reject' }] })
      log('permission ' + JSON.stringify(decision.result))
      if (decision.result?.outcome?.optionId !== 'allow_once') {
        say('tool_denied: Tool execution denied by approval callback')
        return answer()
      }
      if (text.includes('CANCEL_BEFORE_MCP')) {
        say('Vibe cancelled its pending call')
        return answer()
      }
      const called = await mcp('tools/call', { name: toolName, arguments: { value: 'ping' } })
      log('bridge-answered')
      say('tool said ' + called.result.content.map(block => block.text).join(''))
      return answer()
    }
    const writeTarget = /BUILTIN_WRITE_FILE (\\S+)/u.exec(text)
    if (writeTarget) {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_write', title: 'write_file', kind: 'edit', status: 'pending', rawInput: { filePath: writeTarget[1], content: 'ok' }, _meta: { tool_name: 'write_file' } })
      if (!catalogued('write_file')) {
        say(POLICY_DENIAL)
        return answer()
      }
      const decision = await permission({ sessionId, toolCall: { toolCallId: 'call_write' }, options: [{ optionId: 'allow_once', kind: 'allow_once' }, { optionId: 'reject_once', kind: 'reject_once' }] })
      log('permission ' + JSON.stringify(decision.result))
      say(decision.result?.outcome?.optionId === 'allow_once' ? 'write_file ran' : 'tool_denied: Tool execution denied by approval callback')
      return answer()
    }
    if (text.includes('BUILTIN_WRITE')) {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_w1', title: 'Write sneaky.txt', kind: 'edit', status: 'pending', rawInput: { path: '/synthetic/sneaky.txt' }, _meta: { tool_name: 'write_file', effect_kind: 'file_write' } })
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_w1', status: 'completed', rawOutput: { written: true } })
      say('wrote nothing DSH did not bridge')
      return answer()
    }
    // Vibe 3.1.5 lists its own shell whatever the agent profile says; in ask mode it asks the client before running it
    // only when the profile's catalogue offers it.
    if (text.includes('BUILTIN_BASH')) {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_bash', title: 'bash', kind: 'execute', status: 'pending', rawInput: { command: 'true' }, _meta: { tool_name: 'bash', effect_kind: 'shell' } })
      if (!catalogued('bash')) {
        log('denied-by-policy bash')
        say(POLICY_DENIAL)
        return answer()
      }
      const decision = await permission({ sessionId, toolCall: { toolCallId: 'call_bash' }, options: [{ optionId: 'allow_once', kind: 'allow_once' }, { optionId: 'allow_always', kind: 'allow_always' }, { optionId: 'reject_once', kind: 'reject_once' }] })
      log('permission ' + JSON.stringify(decision.result))
      say(decision.result?.outcome?.optionId === 'allow_once' ? 'bash ran' : 'tool_denied: Tool execution denied by approval callback')
      return answer()
    }
    say('echo ' + process.pid + ' ' + model + '/' + thinking + '/' + agent + ': ' + text)
    return answer()
  }
  if (message.method === 'session/cancel') {
    log('session/cancel')
    return
  }
  if (message.id !== undefined) reply({})
})
`

/** One installed fake: its executable and the events it recorded, oldest first. */
export interface FakeVibeAcp {
  readonly executable: string
  /** Directory holding the executable and its log; the caller removes it. */
  readonly directory: string
  readonly events: () => readonly string[]
  readonly logPath: string
}

/** Install the fake `vibe-acp` in its own temporary directory. */
export const fakeVibeAcp = (source: string = FAKE_VIBE_ACP): FakeVibeAcp => {
  const directory = mkdtempSync(join(tmpdir(), 'vibe-acp-test-'))
  const executable = join(directory, 'vibe-acp')
  writeFileSync(executable, source)
  chmodSync(executable, 0o755)
  const logPath = join(directory, 'fake-vibe-acp.log')
  return {
    executable,
    directory,
    logPath,
    events: () =>
      existsSync(logPath)
        ? readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(line => line !== '')
        : [],
  }
}
