import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeContext, type AssistantMessage, type AssistantMessageEventStream, type Message, type Model } from '@earendil-works/pi-ai'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node/NodeChildProcessSpawner'
import { Context, Effect, Layer, Scope } from 'effect'
import { afterEach, expect, it, vi } from 'vitest'
import { AntigravityProcesses, AntigravityProcessesPromiseModel } from './antigravity-processes.js'
import { AccountsPlatformLive } from './platform-layer.js'
import { AntigravityAcpSessions } from './antigravity-acp.js'
import { AntigravityAccountModel } from './antigravity-account.js'
import { createAntigravityProvider } from './antigravity-provider.js'

/**
 * Stands in for `agy acp`: an ACP server over stdio that starts the MCP server `session/new` names, offers two models
 * with their thought levels, and for a prompt that says "call" calls the first DSH tool, waits for the bridge's answer,
 * then reports it; "think" streams two thought summaries first; any other prompt is echoed with the process id, the
 * selected model and level, so a test can tell whether a process was reused and what it was set to.
 */
const FAKE_AGY = `#!/usr/bin/env node
const { spawn } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { createInterface } = require('node:readline')
const out = value => process.stdout.write(JSON.stringify(value) + '\\n')
const update = (sessionId, value) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: value } })
if (process.env.FAKE_AGY_REPORT) writeFileSync(process.env.FAKE_AGY_REPORT, JSON.stringify({ argv: process.argv.slice(2), home: process.env.HOME, key: process.env.GEMINI_API_KEY ?? null }))
if (process.env.FAKE_AGY_AGENT) writeFileSync(process.env.FAKE_AGY_AGENT, readFileSync(join(process.argv[process.argv.indexOf('--gemini-dir') + 1], 'config', 'agents', 'dsh.md'), 'utf8'))
let model = 'gemini-fast'
let level = 'high'
const levels = () => (model === 'gemini-fast' ? ['low', 'medium', 'high'] : ['low', 'high', 'xhigh'])
const options = () => [
  { id: 'model', currentValue: model, options: [{ value: 'gemini-fast', name: 'Gemini Fast' }, { value: 'gemini-deep', name: 'Gemini Deep' }] },
  { id: 'thought_level', currentValue: level, options: levels().map(value => ({ value, name: value })) },
]
let mcp
const waiting = new Map()
let nextId = 1
const rpc = (method, params) => new Promise(resolve => { const id = nextId++; waiting.set(id, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n') })
let tools = []
createInterface({ input: process.stdin }).on('line', async line => {
  const message = JSON.parse(line)
  const reply = result => out({ jsonrpc: '2.0', id: message.id, result })
  if (message.method === 'initialize') return reply({ protocolVersion: 1 })
  if (message.method === 'session/new') {
    if (process.env.HOME && process.env.HOME.includes('signed-out')) return out({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required' } })
    const server = message.params.mcpServers[0]
    if (server) {
      mcp = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] })
      createInterface({ input: mcp.stdout }).on('line', text => { const answer = JSON.parse(text); waiting.get(answer.id)?.(answer); waiting.delete(answer.id) })
      await rpc('initialize', { protocolVersion: '2025-11-25' })
      tools = (await rpc('tools/list', {})).result.tools
    }
    return reply({ sessionId: 'session-' + process.pid, configOptions: options(), _meta: { antigravity: { tier: { name: 'Google AI Pro' } } } })
  }
  if (message.method === 'session/set_config_option') {
    if (message.params.configId === 'model') model = message.params.value
    if (message.params.configId === 'thought_level') level = message.params.value
    if (!levels().includes(level)) level = levels()[levels().length - 1]
    return reply({ configOptions: options() })
  }
  if (message.method === 'session/prompt') {
    const sessionId = message.params.sessionId
    const text = message.params.prompt.map(block => block.text ?? '').join('')
    if (text.includes('call')) {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call_1', name: 'mcp_dsh_' + tools[0].name, rawInput: { value: 'ping', toolSummary: 'Echo ping' }, status: 'in_progress' })
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', name: 'mcp_dsh_' + tools[0].name, status: 'pending' })
      const answer = await rpc('tools/call', { name: tools[0].name, arguments: { value: 'ping' } })
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'tool said ' + answer.result.content.map(block => block.text).join('') } })
      return reply({ stopReason: 'end_turn', usage: { inputTokens: 20, outputTokens: 4, cachedReadTokens: 10, cachedWriteTokens: 0 } })
    }
    if (text.includes('spent')) {
      const geminiDir = process.argv[process.argv.indexOf('--gemini-dir') + 1]
      const logDir = require('node:path').join(geminiDir, 'antigravity-cli', 'log')
      require('node:fs').mkdirSync(logDir, { recursive: true })
      const log = require('node:path').join(logDir, 'acp-worker-1.log')
      for (const attempt of [1, 2, 3]) {
        require('node:fs').appendFileSync(log, 'I1120 run.go:317] Run: attempt ' + attempt + ' failed (RESOURCE_EXHAUSTED (code 429): Resource has been exhausted (e.g. check quota).), retrying in 4s\\n')
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return
    }
    if (text.includes('think')) {
      update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'First summary.' } })
      update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Second summary.' } })
    }
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'echo ' + process.pid + ' ' + model + '/' + level + ': ' } })
    update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
    return reply({ stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 2, cachedReadTokens: 1, cachedWriteTokens: 0 } })
  }
  if (message.id !== undefined) reply({})
})
`

/** The production service on Effect's Node spawner, as the transport drives it through its Promise facade. */
const processesScope = Scope.makeUnsafe()
const processesContext = Effect.runSync(
  Layer.buildWithScope(AntigravityProcesses.layer.pipe(Layer.provide(nodeChildProcessSpawnerLayer), Layer.provide(AccountsPlatformLive)), processesScope),
)
const processes = AntigravityProcessesPromiseModel.facade(Context.get(processesContext, AntigravityProcesses), processesContext)

const directories: string[] = []
const sessions: AntigravityAcpSessions[] = []
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(session => session.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const fakeAgy = (source = FAKE_AGY): string => {
  const directory = mkdtempSync(join(tmpdir(), 'agy-acp-test-'))
  directories.push(directory)
  const executable = join(directory, 'agy')
  writeFileSync(executable, source)
  chmodSync(executable, 0o755)
  return executable
}

const setup = (home = '/synthetic/agy-home') => {
  const cli = new AntigravityAcpSessions({ processes, home: () => home, executable: fakeAgy() })
  sessions.push(cli)
  const provider = createAntigravityProvider(cli)
  const model = (id: string): Model<string> => provider.describeModel(id)
  return { cli, model }
}

const finished = async (stream: AssistantMessageEventStream): Promise<AssistantMessage> => {
  for await (const event of stream) {
    if (event.type === 'done') return event.message
    if (event.type === 'error') throw new Error(event.error.errorMessage)
  }
  throw new Error('stream ended without a result')
}

const textOf = (message: AssistantMessage): string => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
const tool = { name: 'echo_tool', description: 'Echo a value', parameters: { type: 'object', properties: { value: { type: 'string' } } } }

it('holds a tool call until DSH answers it, then continues the same ACP prompt in the same process', async () => {
  const { cli, model } = setup()
  const messages: Message[] = [{ role: 'user', content: 'please call the tool', timestamp: 1 }]
  const context = () => normalizeContext({ systemPrompt: 'You are inside DSH.', tools: [tool as never], messages })
  const options = { sessionId: 'session-tool' }

  const first = await finished(cli.stream(model('gemini-fast'), context(), options))
  expect(first.stopReason).toBe('toolUse')
  expect(first.content).toEqual([{ type: 'toolCall', id: 'call_1', name: 'echo_tool', arguments: { value: 'ping' } }])

  messages.push(first, {
    role: 'toolResult',
    toolCallId: 'call_1',
    toolName: 'echo_tool',
    content: [{ type: 'text', text: 'pong' }],
    isError: false,
    timestamp: 2,
  })
  const second = await finished(cli.stream(model('gemini-fast'), context(), options))
  expect(textOf(second)).toBe('tool said pong')
  expect(second.stopReason).toBe('stop')
  expect(second.usage).toMatchObject({ input: 20, output: 4, cacheRead: 10, totalTokens: 34 })

  messages.push(second, { role: 'user', content: 'hello again', timestamp: 3 })
  const third = await finished(cli.stream(model('gemini-fast'), context(), options))
  messages.push(third, { role: 'user', content: 'and once more', timestamp: 4 })
  const fourth = await finished(cli.stream(model('gemini-fast'), context(), options))
  const processOf = (message: AssistantMessage) => /^echo (\d+) /.exec(textOf(message))?.[1]
  expect(textOf(third)).toMatch(/: hello again$/)
  expect(processOf(fourth)).toBe(processOf(third))
  expect(cli.processCount).toBe(1)
})

it('selects the requested model and the closest thought level that model accepts', async () => {
  const { cli, model } = setup()
  const ask = (id: string, reasoning: 'minimal' | 'medium' | 'xhigh' | undefined, sessionId: string) =>
    finished(
      cli.stream(model(id), normalizeContext({ systemPrompt: 'DSH.', messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }), {
        sessionId,
        ...(reasoning !== undefined && { reasoning }),
      }),
    )

  expect(textOf(await ask('gemini-deep', 'xhigh', 'a'))).toMatch(/ gemini-deep\/xhigh: hi$/)
  expect(textOf(await ask('gemini-deep', 'medium', 'b'))).toMatch(/ gemini-deep\/low: hi$/)
  expect(textOf(await ask('gemini-fast', 'xhigh', 'c'))).toMatch(/ gemini-fast\/high: hi$/)
  expect(textOf(await ask('gemini-fast', 'minimal', 'd'))).toMatch(/ gemini-fast\/low: hi$/)
})

it('streams thought summaries as one thinking block, apart from the answer', async () => {
  const { cli, model } = setup()
  const reply = await finished(
    cli.stream(model('gemini-fast'), normalizeContext({ systemPrompt: 'DSH.', messages: [{ role: 'user', content: 'think first', timestamp: 1 }] }), {
      sessionId: 'thinking',
    }),
  )
  expect(reply.content[0]).toEqual({ type: 'thinking', thinking: 'First summary.\n\nSecond summary.' })
  expect(reply.content[1]).toMatchObject({ type: 'text' })
})

it('refuses a model the account does not offer with a recovery, instead of running another one', async () => {
  const { cli, model } = setup()
  await expect(
    finished(
      cli.stream(model('gemini-gone'), normalizeContext({ systemPrompt: 'DSH.', messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }), {
        sessionId: 'gone',
      }),
    ),
  ).rejects.toThrow("Antigravity does not offer gemini-gone on this account. Pick another model, or refresh the account's model list in AI Accounts.")
})

it('turns "Authentication required" into the sign-in command for the account home', async () => {
  const { cli, model } = setup('/synthetic/signed-out-home')
  await expect(
    finished(
      cli.stream(model('gemini-fast'), normalizeContext({ systemPrompt: 'DSH.', messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }), {
        sessionId: 'auth',
      }),
    ),
  ).rejects.toThrow(
    "Antigravity CLI is not signed in for this account. Run: HOME='/synthetic/signed-out-home' agy acp --login. Then retry. (Authentication required)",
  )
})

it("runs agy with DSH's agent in a private Gemini folder, the account HOME and no API key, and removes the folder after", async () => {
  const reportDirectory = mkdtempSync(join(tmpdir(), 'agy-acp-report-'))
  directories.push(reportDirectory)
  const report = join(reportDirectory, 'launch.json')
  vi.stubEnv('GEMINI_API_KEY', 'synthetic-unrelated-key')
  vi.stubEnv('FAKE_AGY_REPORT', report)
  try {
    const { cli, model } = setup('/synthetic/work-home')
    const reply = await finished(
      cli.stream(model('gemini-fast'), normalizeContext({ systemPrompt: 'You are DSH.', messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }), {
        sessionId: 'env',
      }),
    )
    expect(textOf(reply)).toMatch(/: hi$/)
    const launch = JSON.parse(readFileSync(report, 'utf8'))
    const geminiDir = String(launch.argv[2])
    expect(launch).toEqual({
      argv: ['acp', '--gemini-dir', geminiDir, '--agent', 'dsh', '--process-per-session', '--dangerously-skip-permissions', '--disable-telemetry'],
      home: '/synthetic/work-home',
      key: null,
    })
    expect(readFileSync(join(geminiDir, 'config', 'agents', 'dsh.md'), 'utf8')).toBe(
      '---\nname: dsh\ndescription: DeepSeek Harness conversation agent.\ntools: []\nmainAgent: true\nsubagent: false\n---\nYou are DSH.\n',
    )
    await cli.dispose()
    expect(existsSync(geminiDir)).toBe(false)
  } finally {
    vi.unstubAllEnvs()
  }
})

it('sends a neutral system prompt, keeping every other instruction DSH gives the model', async () => {
  const reportDirectory = mkdtempSync(join(tmpdir(), 'agy-acp-prompt-'))
  directories.push(reportDirectory)
  const agent = join(reportDirectory, 'agent.md')
  vi.stubEnv('FAKE_AGY_AGENT', agent)
  try {
    const { cli, model } = setup()
    const systemPrompt = [
      'You are an AI agent powered by DeepSeek Harness.',
      'The runtime context names the DeepSeek Harness implementation checkout. Never infer the working directory from the checkout path.',
      'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.',
      'Prefer the repository check command.',
    ].join('\n\n')
    await finished(
      cli.stream(model('gemini-fast'), normalizeContext({ systemPrompt, messages: [{ role: 'user', content: 'hi', timestamp: 1 }] }), {
        sessionId: 'neutral',
      }),
    )
    expect(readFileSync(agent, 'utf8')).toBe(
      '---\nname: dsh\ndescription: DeepSeek Harness conversation agent.\ntools: []\nmainAgent: true\nsubagent: false\n---\nYou are an AI coding agent.\n\nPrefer the repository check command.\n',
    )
  } finally {
    vi.unstubAllEnvs()
  }
})

it('keeps a process that is awaiting a tool call past the idle timeout, then stops it once idle', async () => {
  const { cli, model } = setup()
  const messages: Message[] = [{ role: 'user', content: 'please call the tool', timestamp: 1 }]
  const context = () => normalizeContext({ systemPrompt: 'You are inside DSH.', tools: [tool as never], messages })
  const options = { sessionId: 'held' }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const first = await finished(cli.stream(model('gemini-fast'), context(), options))
    expect(first.stopReason).toBe('toolUse')
    vi.advanceTimersByTime(30 * 60_000 + 1)
    expect(cli.processCount).toBe(1)

    messages.push(first, {
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'echo_tool',
      content: [{ type: 'text', text: 'pong' }],
      isError: false,
      timestamp: 2,
    })
    expect(textOf(await finished(cli.stream(model('gemini-fast'), context(), options)))).toBe('tool said pong')
    vi.advanceTimersByTime(30 * 60_000 + 1)
    expect(cli.processCount).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('describes a signed-in account: plan, models and the thought levels each one accepts', async () => {
  const description = await AntigravityAccountModel.probe({ home: '/synthetic/probe-home', processes, executable: fakeAgy() })
  expect(description).toEqual({
    signedIn: true,
    plan: 'Google AI Pro',
    models: [
      { id: 'gemini-fast', name: 'Gemini Fast', levels: ['low', 'medium', 'high'] },
      { id: 'gemini-deep', name: 'Gemini Deep', levels: ['low', 'high', 'xhigh'] },
    ],
  })
})

it('describes a signed-out account with its sign-in command, and a missing CLI with its install command', async () => {
  expect(await AntigravityAccountModel.probe({ home: '/synthetic/signed-out-probe', processes, executable: fakeAgy() })).toEqual({
    signedIn: false,
    detail: "Antigravity CLI is not signed in for this account. Run: HOME='/synthetic/signed-out-probe' agy acp --login",
  })
  expect(await AntigravityAccountModel.probe({ home: '/synthetic/probe-home', processes, executable: '/synthetic/missing/agy' })).toEqual({
    signedIn: false,
    detail: 'Antigravity CLI (agy) is not installed on the Host. Install it with: curl -fsSL https://antigravity.google/cli/install.sh | bash',
  })
})

it('records an antigravity describe span with the model count, never the home, plan or model names', async () => {
  using recorder = recordSpans()
  await AntigravityAccountModel.probe({ home: '/synthetic/private-home', processes, executable: fakeAgy() })
  const span = recorder.span('antigravity describe')
  expect(span.kind).toBe('client')
  expect(span.attributes).toEqual({ 'process.executable.name': 'agy', 'antigravity.models': 2 })
  expect(JSON.stringify({ attributes: span.attributes, status: span.status })).not.toMatch(/private-home|Google AI Pro|Gemini Fast/)
})

it('fails a step whose plan is spent as a quota failure instead of waiting on agy retrying 429s', async () => {
  const { cli, model } = setup()
  await expect(
    finished(
      cli.stream(model('gemini-fast'), normalizeContext({ systemPrompt: 'DSH.', messages: [{ role: 'user', content: 'spent plan', timestamp: 1 }] }), {
        sessionId: 'spent',
      }),
    ),
  ).rejects.toThrow(/^Antigravity quota exhausted: Google answers 429 RESOURCE_EXHAUSTED for this account's plan\./u)
  expect(cli.processCount).toBe(0)
})
