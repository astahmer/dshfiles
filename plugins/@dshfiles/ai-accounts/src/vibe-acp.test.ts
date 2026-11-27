import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeContext, type AssistantMessage, type AssistantMessageEventStream, type Message, type Model } from '@earendil-works/pi-ai'
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node/NodeChildProcessSpawner'
import { Context, Effect, Layer, Scope } from 'effect'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliProcesses, CliProcessesPromiseModel } from './cli-processes.js'
import { AccountsPlatformLive } from './platform-layer.js'
import { fakeVibeAcp, type FakeVibeAcp } from './vibe-acp.fixture.js'
import { createMistralProvider } from './mistral-provider.js'
import { VibeAcpSessions } from './vibe-acp.js'
import { createVibeAcpProvider } from './vibe-provider.js'

/** The production process service on Effect's Node spawner, as the transport drives it through its Promise facade. */
const processesScope = Scope.makeUnsafe()
const processesContext = Effect.runSync(
  Layer.buildWithScope(CliProcesses.layer.pipe(Layer.provide(nodeChildProcessSpawnerLayer), Layer.provide(AccountsPlatformLive)), processesScope),
)
const processes = CliProcessesPromiseModel.facade(Context.get(processesContext, CliProcesses), processesContext)

const directories: string[] = []
const sessions: VibeAcpSessions[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(sessions.splice(0).map(session => session.dispose()))
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const setup = (home = '/synthetic/vibe-home', source?: string) => {
  const fake = fakeVibeAcp(source)
  directories.push(fake.directory)
  vi.stubEnv('FAKE_VIBE_ACP_LOG', fake.logPath)
  const cli = new VibeAcpSessions({ processes, home: () => home, executable: fake.executable })
  sessions.push(cli)
  const provider = createVibeAcpProvider({ upstream: createMistralProvider(), sessions: cli })
  const model = (id = 'deepseek-v4-1-flash-1017'): Model<string> => {
    const found = provider.getModels().find(candidate => candidate.id === id)
    if (found === undefined) throw new Error(`the Vibe ACP provider publishes no ${id}`)
    return found
  }
  return { cli, fake, model }
}

const finished = async (stream: AssistantMessageEventStream): Promise<AssistantMessage> => {
  for await (const event of stream) {
    if (event.type === 'done') return event.message
    if (event.type === 'error') throw new Error(event.error.errorMessage)
  }
  throw new Error('stream ended without a result')
}

const textOf = (message: AssistantMessage): string => message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
const tool = { name: 'echo', description: 'Echo a value', parameters: { type: 'object', properties: { value: { type: 'string' } } } }

const context = (messages: Message[]) => normalizeContext({ systemPrompt: 'You are inside DSH.', tools: [tool as never], messages })

/** The `session/new` line the fake recorded: the roots it was given, and the managed profile in the first one. */
const managedProfile = (fake: FakeVibeAcp) => {
  const line = fake.events().find(event => event.startsWith('session/new '))
  if (line === undefined) throw new Error('the fake recorded no session/new')
  const decoded = Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(line.slice('session/new directories='.length, line.indexOf(' mcp='))))
  const toml = readFileSync(join(decoded[0] ?? '', '.vibe', 'agents', 'dsh.toml'), 'utf8')
  return { roots: decoded, toml }
}

describe('the Vibe ACP route', () => {
  it('answers one step with Vibe s text, thinking and this step s share of the session usage', async () => {
    const { cli, fake, model } = setup()
    const reply = await finished(cli.stream(model(), context([{ role: 'user', content: 'plain answer', timestamp: 1 }]), { sessionId: 'plain' }))
    expect(textOf(reply)).toMatch(/^echo \d+ deepseek-v4-1-flash-1017\/low\/dsh: plain answer$/u)
    expect(reply.stopReason).toBe('stop')
    expect(reply.usage).toMatchObject({ input: 1200, output: 34, cacheRead: 900, totalTokens: 2134 })
    expect(reply.usage.cost.total).toBe(0.5)
    expect(fake.events().filter(event => event.startsWith('session/new '))).toHaveLength(1)
  })

  it('runs Vibe with the managed agent profile: read-only builtins and dsh_* only, DSH instructions, the account home', async () => {
    const { cli, fake, model } = setup('/synthetic/work-home')
    await finished(cli.stream(model(), context([{ role: 'user', content: 'plain answer', timestamp: 1 }]), { sessionId: 'profile' }))
    const profile = managedProfile(fake)
    expect(profile.roots[0]).toContain('dsh-vibe-acp-')
    expect(profile.toml).toContain('instructions = "You are inside DSH."')
    expect(profile.toml).toContain('enabled_tools = ["dsh_*","read_file","grep","web_fetch","web_search","todo"]')
    for (const mutation of ['write_file', 'edit', 'bash', 'git_bash', 'powershell', 'task', 'skill', 'ask_user_question'])
      expect(profile.toml).not.toMatch(new RegExp(`"${mutation}"`, 'u'))
    expect(fake.events()).toContain('set_config_option agent=dsh')
  })

  it('refuses to run a step when Vibe did not load the managed profile instead of leaving its own tools enabled', async () => {
    vi.stubEnv('FAKE_VIBE_ACP_NO_AGENTS', '1')
    const { cli, fake, model } = setup()
    await expect(finished(cli.stream(model(), context([{ role: 'user', content: 'plain answer', timestamp: 1 }]), { sessionId: 'unsafe' }))).rejects.toThrow(
      'Vibe ACP did not load the managed DSH agent profile, so its own write, edit and shell tools would stay enabled. Refusing to run this step; update Mistral Vibe and retry.',
    )
    expect(fake.events()).not.toContain('set_config_option agent=dsh')
  })

  it('holds a DSH tool call until DSH answers it, then continues the same ACP prompt in the same process', async () => {
    const { cli, fake, model } = setup()
    const messages: Message[] = [{ role: 'user', content: 'CALL_TOOL please', timestamp: 1 }]
    const options = { sessionId: 'tool' }

    const first = await finished(cli.stream(model(), context(messages), options))
    expect(first.stopReason).toBe('toolUse')
    expect(first.content).toEqual([{ type: 'toolCall', id: 'call_1', name: 'echo', arguments: { value: 'ping' } }])
    expect(first.usage).toMatchObject({ input: 1200, output: 34, cacheRead: 900 })
    // The step ended on the published call while Vibe's MCP proxy still waits for DSH's result.
    expect(fake.events()).not.toContain('bridge-answered')

    messages.push(first, {
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'echo',
      content: [{ type: 'text', text: 'pong' }],
      isError: false,
      timestamp: 2,
    })
    const second = await finished(cli.stream(model(), context(messages), options))
    expect(textOf(second)).toBe('tool said pong')
    expect(second.stopReason).toBe('stop')
    // The same ACP prompt answered: no second prompt, no second session, no second LLM call billed to this step.
    expect(fake.events()).toContain('bridge-answered')
    expect(fake.events().filter(event => event.startsWith('prompt '))).toHaveLength(1)
    expect(fake.events().filter(event => event.startsWith('session/new '))).toHaveLength(1)
    expect(second.usage.totalTokens).toBe(0)
  })

  it('allows a permission request for a bridged tool, and rejects one the route cannot name', async () => {
    const { cli, fake, model } = setup()
    const messages: Message[] = [{ role: 'user', content: 'PERMISSION please', timestamp: 1 }]
    const first = await finished(cli.stream(model(), context(messages), { sessionId: 'permission' }))
    expect(first.stopReason).toBe('toolUse')
    expect(fake.events()).toContain('permission {"outcome":{"outcome":"selected","optionId":"allow_once"}}')
    // DSH's own approval runs when DSH executes the tool; the ACP permission is answered before Vibe even calls it.
    expect(fake.events()).not.toContain('bridge-answered')
    messages.push(first, {
      role: 'toolResult',
      toolCallId: 'call_p1',
      toolName: 'echo',
      content: [{ type: 'text', text: 'pong' }],
      isError: false,
      timestamp: 2,
    })
    expect(textOf(await finished(cli.stream(model(), context(messages), { sessionId: 'permission' })))).toBe('tool said pong')
    expect(fake.events()).toContain('bridge-answered')

    await finished(cli.stream(model(), context([{ role: 'user', content: 'PERMISSION_BUILTIN please', timestamp: 1 }]), { sessionId: 'permission-builtin' }))
    expect(fake.events()).toContain('permission {"outcome":{"outcome":"selected","optionId":"reject_once"}}')
  })

  it('keeps Vibe s own builtin tool call out of the DSH transcript and ends the step normally', async () => {
    const { cli, model } = setup()
    const reply = await finished(cli.stream(model(), context([{ role: 'user', content: 'BUILTIN_WRITE please', timestamp: 1 }]), { sessionId: 'builtin' }))
    expect(reply.stopReason).toBe('stop')
    expect(reply.content).toEqual([{ type: 'text', text: 'wrote nothing DSH did not bridge' }])
  })

  it('reuses one process and one ACP session for consecutive steps, sending only the new user message', async () => {
    const { cli, fake, model } = setup()
    const messages: Message[] = [{ role: 'user', content: 'first question', timestamp: 1 }]
    const options = { sessionId: 'reuse' }
    const first = await finished(cli.stream(model(), context(messages), options))
    messages.push(first, { role: 'user', content: 'second question', timestamp: 2 })
    const second = await finished(cli.stream(model(), context(messages), options))
    const processOf = (message: AssistantMessage) => /^echo (\d+) /u.exec(textOf(message))?.[1]
    expect(processOf(second)).toBe(processOf(first))
    expect(fake.events().filter(event => event.startsWith('session/new '))).toHaveLength(1)
    const prompts = fake.events().filter(event => event.startsWith('prompt '))
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toBe('prompt "second question"')
    expect(cli.processCount).toBe(1)
  })

  it('selects the requested model and thinking level, and maps minimal onto Vibe s low', async () => {
    const { cli, fake, model } = setup()
    const ask = async (id: string, reasoning: 'minimal' | 'high', sessionId: string) =>
      textOf(await finished(cli.stream(model(id), context([{ role: 'user', content: 'hi', timestamp: 1 }]), { sessionId, reasoning })))
    expect(await ask('mistral-large-4-0', 'high', 'level-a')).toMatch(/ mistral-large-4-0\/high\/dsh: hi$/u)
    expect(await ask('mistral-large-4-0', 'minimal', 'level-b')).toMatch(/ mistral-large-4-0\/low\/dsh: hi$/u)
    expect(fake.events()).toContain('set_config_option model=mistral-large-4-0')
    expect(fake.events()).toContain('set_config_option thinking=high')
  })

  it('stops the process when the step is aborted, and keeps no held call alive', async () => {
    const { cli, model } = setup()
    const controller = new AbortController()
    const stream = cli.stream(model(), context([{ role: 'user', content: 'CALL_TOOL please', timestamp: 1 }]), {
      sessionId: 'abort',
      signal: controller.signal,
    })
    const answered = finished(stream)
    await vi.waitFor(() => expect(cli.processCount).toBe(1), { timeout: 10_000 })
    controller.abort()
    await expect(answered).rejects.toThrow(/aborted|Request was aborted/u)
    await vi.waitFor(() => expect(cli.processCount).toBe(0), { timeout: 10_000 })
  })

  it('names the install and sign-in recovery for a missing CLI and for a signed-out account', async () => {
    const missing = new VibeAcpSessions({ processes, home: () => '/synthetic/vibe-home', executable: '/synthetic/missing/vibe-acp' })
    sessions.push(missing)
    const provider = createVibeAcpProvider({ upstream: createMistralProvider(), sessions: missing })
    await expect(
      finished(missing.stream(provider.getModels()[0]!, context([{ role: 'user', content: 'hi', timestamp: 1 }]), { sessionId: 'missing' })),
    ).rejects.toThrow(/vibe-acp\) is not installed on the Host\. Install Mistral Vibe 3\.x/u)

    vi.stubEnv('FAKE_VIBE_ACP_SIGNED_OUT', '1')
    const { cli, model } = setup('/synthetic/signed-out-home')
    await expect(finished(cli.stream(model(), context([{ role: 'user', content: 'hi', timestamp: 1 }]), { sessionId: 'signed-out' }))).rejects.toThrow(
      /Vibe ACP is not signed in for this account\. Run: VIBE_HOME='\/synthetic\/signed-out-home' vibe --setup/u,
    )
  })

  it('removes the private folder and its managed profile once the process is stopped', async () => {
    const { cli, fake, model } = setup()
    await finished(cli.stream(model(), context([{ role: 'user', content: 'plain answer', timestamp: 1 }]), { sessionId: 'cleanup' }))
    const agentRoot = managedProfile(fake).roots[0] ?? ''
    expect(agentRoot).toContain('dsh-vibe-acp-')
    expect(existsSync(join(agentRoot, '.vibe', 'agents', 'dsh.toml'))).toBe(true)
    await cli.dispose()
    await vi.waitFor(() => expect(existsSync(agentRoot)).toBe(false), { timeout: 10_000 })
  })
})
