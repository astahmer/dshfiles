#!/usr/bin/env node
/**
 * Ordering spike for the Vibe ACP bridge. NOT part of CI: it drives the real `vibe-acp` with the account's `vibe
 * --setup` login, so it spends a little of that plan's allowance. Everything it needs to decide is printed as an
 * ordered event log:
 *
 *   1. does `session/new` project a stdio MCP server, and what name does Vibe publish that server's tools under?
 *   2. is the tool's `session/update` (`tool_call`) published BEFORE the MCP `tools/call` resolves? The echo bridge
 *      holds every call until this script observed the matching ACP update, so a reply is only possible if it was.
 *   3. does `usage_update` carry the context size, the session cost and the token meta the route can report?
 *   4. does an agent profile under an `additionalDirectories` root narrow the tool set (a mutating builtin must be
 *      gone), and do its `instructions` reach the model?
 *
 * Usage: node plugins/@dshfiles/ai-accounts/scripts/vibe-acp-spike.mjs [--home <VIBE_HOME>] [--binary <vibe-acp>] [--model <id>]
 *
 * Exits 1 with the CLI's own stderr when `vibe-acp` cannot start: Vibe 3.1.5 imports ACP symbols
 * (`acp.helpers.ContentBlock`, `AcpMcpServer`, …) that the `agent-client-protocol` release shipped beside it on this
 * Host does not export, so a broken pair fails here before any protocol traffic.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const flag = name => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const home = flag('--home') ?? process.env.VIBE_HOME ?? join(homedir(), '.vibe')
const binary = flag('--binary') ?? 'vibe-acp'
const model = flag('--model') ?? 'deepseek-v4-1-flash-1017'
const root = mkdtempSync(join(tmpdir(), 'vibe-acp-spike-'))
const workspace = join(root, 'workspace')
const agentsRoot = join(root, 'agents')
mkdirSync(workspace)
mkdirSync(join(agentsRoot, '.vibe', 'agents'), { recursive: true })
const log = join(root, 'events.log')
const sentinel = join(root, 'tool-call-seen')
const bridgeLog = join(root, 'bridge.log')

const record = (source, detail) => appendFileSync(log, `${source}\t${Date.now()}\t${detail}\n`)

/** A stdio MCP server that holds every `tools/call` until the ACP client observed the tool's `tool_call` update. */
const ECHO_BRIDGE = `
import { appendFileSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
const [logPath, sentinel, holdMs] = process.argv.slice(1)
const tools = [{ name: 'echo', description: 'Echo the value back', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }]
const send = message => process.stdout.write(JSON.stringify(message) + '\\n')
const note = line => appendFileSync(logPath, 'bridge\\t' + Date.now() + '\\t' + line + '\\n')
createInterface({ input: process.stdin }).on('line', async line => {
  if (line.trim() === '') return
  const request = JSON.parse(line)
  if (request.method === 'initialize')
    return send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'spike', version: '1' } } })
  if (request.method === 'tools/list') return send({ jsonrpc: '2.0', id: request.id, result: { tools } })
  if (request.method === 'tools/call') {
    note('call ' + request.params.name + ' ' + JSON.stringify(request.params.arguments ?? {}))
    const deadline = Date.now() + Number(holdMs)
    while (!existsSync(sentinel) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    note('release ' + (existsSync(sentinel) ? 'after-acp-update' : 'timeout'))
    return send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: 'pong ' + JSON.stringify(request.params.arguments ?? {}) }], isError: false } })
  }
  if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, result: {} })
})
`

const AGENT_PROFILE = `display_name = "DeepSeek Harness spike"
description = "Read-only Vibe builtins plus DSH's bridged tools."
instructions = "Every reply must start with the exact token DSHSPIKE and nothing else before it."
enabled_tools = ["mcp_dsh.*", "dsh_*", "read_file", "grep", "web_fetch", "web_search", "todo"]
`
writeFileSync(join(agentsRoot, '.vibe', 'agents', 'dsh.toml'), AGENT_PROFILE)

const child = spawn(binary, [], {
  cwd: workspace,
  env: { ...process.env, VIBE_HOME: home },
  stdio: ['pipe', 'pipe', 'pipe'],
})
let stderr = ''
let childGone
const gone = new Promise(resolve => {
  childGone = resolve
})
child.once('exit', (code, signal) => {
  record('spike', `vibe-acp exited code=${String(code)} signal=${String(signal)}`)
  childGone({ code, signal })
})
// Keep the event loop alive while a request is unanswered: a dead child would otherwise end the script silently.
const keepAlive = setInterval(() => undefined, 1_000)
child.stderr.setEncoding('utf8')
child.stderr.on('data', chunk => {
  stderr = `${stderr}${chunk}`.slice(-4_000)
})

const send = message => child.stdin.write(`${JSON.stringify(message)}\n`)
const pending = new Map()
let nextId = 1
const request = (method, params, id = nextId++) =>
  new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ jsonrpc: '2.0', id, method, params })
    setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error(`${method} answered nothing in 120s. stderr: ${stderr.trim()}`))
    }, 120_000).unref()
  })

const updates = []

/** Answer one session/prompt and collect every update it produced: ACP answers the prompt after its last update. */
const prompt = async text => {
  updates.length = 0
  const result = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
  return { result, updates: [...updates] }
}

let sessionId
createInterface({ input: child.stdout }).on('line', line => {
  if (line.trim() === '') return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    record('acp-unparsed', line.slice(0, 120))
    return
  }
  if (message.method === 'session/update') {
    const update = message.params?.update ?? {}
    updates.push(update)
    const kind = update.sessionUpdate
    if (kind === 'tool_call')
      record(
        'acp',
        `tool_call ${update.toolCallId} ${update._meta?.tool_name ?? update.name ?? '(no name)'} status=${update.status} input=${JSON.stringify(update.rawInput ?? null)}`,
      )
    else if (kind === 'usage_update')
      record('acp', `usage used=${update.used} size=${update.size} cost=${JSON.stringify(update.cost ?? null)} meta=${JSON.stringify(update._meta ?? null)}`)
    else if (kind === 'tool_call_update') record('acp', `tool_call_update ${update.toolCallId} ${update.status}`)
    else if (kind === 'agent_message_chunk') record('acp', `text ${JSON.stringify(update.content?.text ?? '')}`)
    else if (kind === 'agent_thought_chunk') record('acp', 'thought')
    else record('acp', kind)
    // Vibe 3.1.5 names a bridged call only in `_meta.tool_name` (`mcp_dsh.<tool>`).
    if (kind === 'tool_call' && String(update._meta?.tool_name ?? update.name ?? '').startsWith('mcp_dsh.')) writeFileSync(sentinel, String(Date.now()))
    return
  }
  if (message.method === 'session/request_permission') {
    record(
      'acp',
      `request_permission ${JSON.stringify(message.params?.toolCall ?? null)} options=${JSON.stringify((message.params?.options ?? []).map(option => option.kind))}`,
    )
    const allow = (message.params?.options ?? []).find(option => String(option.kind).startsWith('allow'))
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { outcome: allow === undefined ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: allow.optionId } },
    })
    return
  }
  if (message.method !== undefined) {
    record('acp-unhandled', message.method)
    if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'spike does not serve this' } })
    return
  }
  const waiting = pending.get(message.id)
  if (waiting === undefined) return
  pending.delete(message.id)
  if (message.error !== undefined) waiting.reject(new Error(`${message.error.message}`))
  else waiting.resolve(message.result)
})

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} gave no answer in ${ms}ms`)), ms).unref())])

const report = lines => {
  process.stdout.write(`${lines.join('\n')}\n`)
}

const open = async () => {
  const initialized = await Promise.race([
    withTimeout(
      request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'dsh', version: '1' },
      }),
      60_000,
      'initialize',
    ),
    gone.then(() => Promise.reject(new Error(`vibe-acp exited before answering initialize. stderr: ${stderr.trim()}`))),
  ])
  record('acp', `initialize ${JSON.stringify(initialized)}`)
  const created = await withTimeout(
    request('session/new', {
      cwd: workspace,
      additionalDirectories: [agentsRoot],
      mcpServers: [
        {
          name: 'dsh',
          command: process.execPath,
          args: ['--input-type=module', '-e', ECHO_BRIDGE, bridgeLog, sentinel, '90000'],
          env: [],
        },
      ],
    }),
    120_000,
    'session/new',
  )
  sessionId = created.sessionId
  const options = created.configOptions ?? []
  record(
    'acp',
    `session/new ${sessionId} configOptions=${JSON.stringify(options.map(option => [option.id, option.currentValue]))} meta=${JSON.stringify(created._meta ?? null)}`,
  )
  return options
}

const select = async (configId, value) => {
  const updated = await request('session/set_config_option', { sessionId, configId, value })
  record('acp', `set_config_option ${configId}=${value} -> ${JSON.stringify((updated?.configOptions ?? []).map(option => [option.id, option.currentValue]))}`)
  return updated
}

const readBridgeLog = () => (existsSync(bridgeLog) ? readFileSync(bridgeLog, 'utf8').trim().split('\n') : [])
const eventOrder = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [])

const main = async () => {
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  try {
    const options = await open()
    const agentIds = (options.find(option => option.id === 'agent')?.options ?? []).map(option => option.value)
    if (agentIds.includes('dsh')) await select('agent', 'dsh')
    await select('model', model)

    // A tool call the DSH route must see, and the bridge must not be able to answer before it does.
    const first = await prompt('Call the tool named mcp_dsh.echo with the value "ping". Then reply with what it returned.')
    const toolCalls = first.updates.filter(update => update.sessionUpdate === 'tool_call')
    const usage = first.updates.filter(update => update.sessionUpdate === 'usage_update')

    // A mutating builtin the managed profile must have dropped.
    const sneaky = join(root, 'sneaky.txt')
    const second = await prompt(`Create the file ${sneaky} containing "hi" using your write_file tool. Then say done.`)
    const builtinCalls = second.updates.filter(update => update.sessionUpdate === 'tool_call').map(update => update._meta?.tool_name ?? update.name)

    report([
      `binary        ${binary}`,
      `vibe home     ${home}`,
      `workspace     ${workspace}`,
      `agent profile ${join(agentsRoot, '.vibe', 'agents', 'dsh.toml')}`,
      `session       ${sessionId}`,
      `agent option  ${JSON.stringify(agentIds)} (dsh discovered: ${String(agentIds.includes('dsh'))})`,
      '',
      '--- prompt 1: tool call ---',
      `tool_calls    ${JSON.stringify(toolCalls.map(update => ({ id: update.toolCallId, name: update._meta?.tool_name ?? update.name, status: update.status, input: update.rawInput })))}`,
      `stopReason    ${first.result?.stopReason}`,
      `usage result  ${JSON.stringify(first.result?.usage ?? null)}`,
      `usage updates ${JSON.stringify(usage.map(update => ({ used: update.used, size: update.size, cost: update.cost, meta: update._meta })))}`,
      `answer        ${JSON.stringify(
        first.updates
          .filter(update => update.sessionUpdate === 'agent_message_chunk')
          .map(update => update.content?.text ?? '')
          .join('')
          .slice(0, 400),
      )}`,
      '',
      '--- prompt 2: mutating builtin ---',
      `tool_calls    ${JSON.stringify(builtinCalls)}`,
      `wrote file    ${String(existsSync(sneaky))}`,
      `answer        ${JSON.stringify(
        second.updates
          .filter(update => update.sessionUpdate === 'agent_message_chunk')
          .map(update => update.content?.text ?? '')
          .join('')
          .slice(0, 400),
      )}`,
      '',
      '--- bridge (MCP server spawned by Vibe) ---',
      ...readBridgeLog().map(line => `  ${line}`),
      '',
      '--- ordered events ---',
      ...eventOrder().map(line => {
        const [source, at, detail] = line.split('\t')
        return `  ${at?.slice(5)} ${source.padEnd(15)} ${detail}`
      }),
    ])
  } catch (error) {
    report([`SPIKE FAILED: ${error.message}`, '', '--- ordered events ---', ...eventOrder().map(line => `  ${line}`), '', `stderr: ${stderr.trim()}`])
    process.exitCode = 1
  } finally {
    clearInterval(keepAlive)
    child.kill()
    await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 5_000).unref())])
  }
}

void main()
