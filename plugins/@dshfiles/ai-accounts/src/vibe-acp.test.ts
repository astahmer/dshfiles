import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeContext, type AssistantMessage, type AssistantMessageEventStream, type Message, type Model } from '@earendil-works/pi-ai'
import { defineTool } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node/NodeChildProcessSpawner'
import { Context, Effect, Layer, Scope } from 'effect'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CliProcesses, CliProcessesPromiseModel } from './cli-processes.js'
import { AccountsPlatformLive } from './platform-layer.js'
import { fakeVibeAcp, type FakeVibeAcp } from './vibe-acp.fixture.js'
import { createMistralProvider } from './mistral-provider.js'
import { VibeAcpSessions, vibeBuiltinAuthorizer, type VibeCallingSession } from './vibe-acp.js'
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

/** The calling DSH session as the Host resolves it: its file mode, and an approval answer recorded per tool. */
const callingSession = (input: {
  readonly fileMode: VibeCallingSession['fileMode']
  readonly answer: boolean
  readonly asks: string[]
  readonly writableRoots?: readonly string[]
}) =>
  vibeBuiltinAuthorizer({
    session: () => ({
      fileMode: input.fileMode,
      writableRoots: input.writableRoots ?? [],
      ask: async ask => {
        input.asks.push(ask.toolName)
        return input.answer
      },
    }),
  })

const setup = (home = '/synthetic/vibe-home', options?: Pick<ConstructorParameters<typeof VibeAcpSessions>[0], 'settings' | 'authorizeBuiltin'>) => {
  const fake = fakeVibeAcp()
  directories.push(fake.directory)
  vi.stubEnv('FAKE_VIBE_ACP_LOG', fake.logPath)
  const cli = new VibeAcpSessions({ processes, home: () => home, executable: fake.executable, ...options })
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

  it('runs Vibe with the managed agent profile: DSH instructions, DSH tools and the builtins the route gates listed, the account home', async () => {
    const { cli, fake, model } = setup('/synthetic/work-home')
    await finished(cli.stream(model(), context([{ role: 'user', content: 'plain answer', timestamp: 1 }]), { sessionId: 'profile' }))
    const profile = managedProfile(fake)
    expect(profile.roots[0]).toContain('dsh-vibe-acp-')
    expect(profile.toml).toContain('instructions = "You are inside DSH."')
    // Vibe denies a builtin its catalogue lacks before asking the route, so the gated ones must stay listed.
    expect(profile.toml).toContain(
      'enabled_tools = ["mcp_dsh.*","dsh_*","read_file","grep","web_fetch","web_search","todo","search_tool_functions","skill","bash","write_file","edit"]',
    )
    for (const mutation of ['run_typescript', 'git_bash', 'powershell', 'task', 'ask_user_question'])
      expect(profile.toml).not.toMatch(new RegExp(`"${mutation}"`, 'u'))
    expect(fake.events()).toContain('set_config_option agent=dsh')
  })

  it('tells Vibe to use the bridged DSH tools for shell and file work instead of its own builtins', async () => {
    const { cli, fake, model } = setup()
    const dshTool = (name: string) => ({ name, description: name, parameters: { type: 'object', properties: {} } })
    const tools = [dshTool('bash'), dshTool('write'), dshTool('read'), dshTool('todo_write')]
    const messages: Message[] = [{ role: 'user', content: 'plain answer', timestamp: 1 }]
    await finished(cli.stream(model(), normalizeContext({ systemPrompt: 'You are inside DSH.', tools: tools as never, messages }), { sessionId: 'guided' }))
    // The profile holds the instructions as one JSON string, so the guidance follows DSH's prompt inside it.
    const instructions = /^instructions = (.*)$/mu.exec(managedProfile(fake).toml)?.[1] ?? ''
    expect(instructions.startsWith(JSON.stringify('You are inside DSH.\n\n# Tools on this route\n').slice(0, -1))).toBe(true)
    expect(instructions).toContain('use them (`mcp_dsh.bash`, `mcp_dsh.read`, `mcp_dsh.write`)')
    expect(instructions).toContain("Do not use Vibe's own bash, write_file, edit, read_file or grep for project work")
    expect(instructions).not.toContain('todo_write')
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

  it('admits a bridged DSH tool under Vibe 3.1.5 s real tool metadata in a full-access session whose approvals are off', async () => {
    const asks: string[] = []
    const { cli, fake, model } = setup('/synthetic/vibe-home', { authorizeBuiltin: callingSession({ fileMode: 'danger-full-access', answer: false, asks }) })
    const host = await createTestHost()
    try {
      host.tools.register(
        defineTool({
          name: 'echo',
          description: 'Echo a value',
          parameters: { value: { type: 'string' } },
          output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
          execute: async () => 'pong',
        }),
      )
      const messages: Message[] = [{ role: 'user', content: 'PERMISSION please', timestamp: 1 }]
      const first = await finished(cli.stream(model(), context(messages), { sessionId: 'permission' }))
      expect(first.stopReason).toBe('toolUse')
      expect(fake.events()).toContain('permission {"outcome":{"outcome":"selected","optionId":"allow_once"}}')
      // DSH's own executor gates the call; the ACP permission only admits it, so the session was never asked.
      expect(asks).toEqual([])
      expect(fake.events()).not.toContain('bridge-answered')
      const call = first.content[0]
      if (call?.type !== 'toolCall') throw new Error('expected an ordinary native tool call')
      const result = await host.runTool({ name: call.name, arguments: call.arguments })
      expect(result.isError).toBe(false)
      messages.push(first, {
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: result.content.flatMap(block => (block.type === 'text' ? [{ type: 'text' as const, text: block.text }] : [])),
        isError: result.isError,
        timestamp: 2,
      })
      expect(textOf(await finished(cli.stream(model(), context(messages), { sessionId: 'permission' })))).toBe('tool said pong')
      expect(fake.events()).toContain('bridge-answered')
    } finally {
      await host.dispose()
    }
  })

  it('does not execute a published tool call that Vibe never forwards to MCP', async () => {
    const { cli, model } = setup()
    const reply = await finished(
      cli.stream(model(), context([{ role: 'user', content: 'PERMISSION CANCEL_BEFORE_MCP', timestamp: 1 }]), { sessionId: 'cancel-before-mcp' }),
    )
    expect(reply.stopReason).toBe('stop')
    expect(reply.content).toEqual([{ type: 'text', text: 'Vibe cancelled its pending call' }])
  })

  it.each([
    { session: 'full access, approvals off', fileMode: 'danger-full-access', answer: false, asked: false, ran: true },
    { session: 'workspace-write, user approves', fileMode: 'workspace-write', answer: true, asked: true, ran: true },
    { session: 'workspace-write, approvals off', fileMode: 'workspace-write', answer: false, asked: true, ran: false },
    { session: 'read-only, user rejects', fileMode: 'read-only', answer: false, asked: true, ran: false },
  ] as const)('runs Vibe s own shell as the calling session allows a native one ($session)', async ({ fileMode, answer, asked, ran }) => {
    const asks: string[] = []
    const { cli, fake, model } = setup('/synthetic/vibe-home', { authorizeBuiltin: callingSession({ fileMode, answer, asks }) })
    const reply = await finished(cli.stream(model(), context([{ role: 'user', content: 'BUILTIN_BASH', timestamp: 1 }]), { sessionId: 'native-session' }))
    // Vibe's ask mode is what sends its edits and commands to DSH at all; its default accept-edits would run them unasked.
    expect(fake.events()).toContain('set_mode ask')
    expect(asks).toEqual(asked ? ['bash'] : [])
    expect(fake.events()).toContain(`permission {"outcome":{"outcome":"selected","optionId":"${ran ? 'allow_once' : 'reject_once'}"}}`)
    expect(textOf(reply)).toBe(ran ? 'bash ran' : 'tool_denied: Tool execution denied by approval callback')
  })

  it('runs Vibe s own shell and file writes in a subagent of a full-access session whose approvals are off, without asking', async () => {
    const asks: string[] = []
    const { cli, fake, model } = setup('/synthetic/vibe-home', { authorizeBuiltin: callingSession({ fileMode: 'danger-full-access', answer: false, asks }) })
    const bash = await finished(cli.stream(model(), context([{ role: 'user', content: 'BUILTIN_BASH', timestamp: 1 }]), { sessionId: 'child-bash' }))
    expect(textOf(bash)).toBe('bash ran')
    const write = await finished(
      cli.stream(model(), context([{ role: 'user', content: 'BUILTIN_WRITE_FILE /synthetic/elsewhere/vibe-smoke.txt', timestamp: 1 }]), {
        sessionId: 'child-write',
      }),
    )
    expect(textOf(write)).toBe('write_file ran')
    expect(fake.events()).not.toContain('denied-by-policy bash')
    expect(asks).toEqual([])
  })

  it.each([
    { write: 'inside the workspace, approvals off', target: 'inside', approvals: 'session', answer: false, asked: false, ran: true },
    { write: 'outside the workspace, approvals off', target: 'outside', approvals: 'session', answer: false, asked: true, ran: false },
    { write: 'through a symlink leaving the workspace, approvals off', target: 'escape', approvals: 'session', answer: false, asked: true, ran: false },
    { write: 'outside the workspace, user approves', target: 'outside', approvals: 'session', answer: true, asked: true, ran: true },
    { write: 'inside the workspace, builtin approvals set to ask', target: 'inside', approvals: 'ask', answer: true, asked: true, ran: true },
  ] as const)(
    'confines Vibe s own file writes in a workspace-write session as DSH confines its own ($write)',
    async ({ target, approvals, answer, asked, ran }) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'vibe-acp-workspace-')))
      const outside = realpathSync(mkdtempSync(join(tmpdir(), 'vibe-acp-outside-')))
      directories.push(root, outside)
      mkdirSync(join(root, 'src'))
      symlinkSync(outside, join(root, 'link'))
      const path = {
        inside: join(root, 'src', 'new', 'vibe-smoke.txt'),
        outside: join(outside, 'vibe-smoke.txt'),
        escape: join(root, 'link', 'vibe-smoke.txt'),
      }[target]
      const asks: string[] = []
      const { cli, model } = setup('/synthetic/vibe-home', {
        settings: () => ({ acpApprovalPolicy: approvals, strictTools: false }),
        authorizeBuiltin: callingSession({ fileMode: 'workspace-write', answer, asks, writableRoots: [root] }),
      })
      const reply = await finished(
        cli.stream(model(), context([{ role: 'user', content: `BUILTIN_WRITE_FILE ${path}`, timestamp: 1 }]), { sessionId: 'confined' }),
      )
      expect(asks).toEqual(asked ? ['write_file'] : [])
      expect(textOf(reply)).toBe(ran ? 'write_file ran' : 'tool_denied: Tool execution denied by approval callback')
    },
  )

  it('runs Vibe s read-only builtins without asking, or asks for each one when builtin approvals are set to ask', async () => {
    const quiet: string[] = []
    const following = setup('/synthetic/vibe-home', { authorizeBuiltin: callingSession({ fileMode: 'read-only', answer: false, asks: quiet }) })
    expect(
      textOf(
        await finished(following.cli.stream(following.model(), context([{ role: 'user', content: 'PERMISSION_READ', timestamp: 1 }]), { sessionId: 'reads' })),
      ),
    ).toBe('builtin allowed')
    expect(quiet).toEqual([])

    const asks: string[] = []
    const asking = setup('/synthetic/vibe-home', {
      settings: () => ({ acpApprovalPolicy: 'ask', strictTools: false }),
      authorizeBuiltin: callingSession({ fileMode: 'danger-full-access', answer: true, asks }),
    })
    expect(
      textOf(
        await finished(asking.cli.stream(asking.model(), context([{ role: 'user', content: 'PERMISSION_READ', timestamp: 1 }]), { sessionId: 'reads-ask' })),
      ),
    ).toBe('builtin allowed')
    expect(asks).toEqual(['read_file'])
  })

  it('denies a builtin when the calling session is gone or unknown', async () => {
    const { cli, model } = setup('/synthetic/vibe-home', { authorizeBuiltin: vibeBuiltinAuthorizer({ session: () => undefined }) })
    expect(textOf(await finished(cli.stream(model(), context([{ role: 'user', content: 'BUILTIN_BASH', timestamp: 1 }]), { sessionId: 'gone' })))).toBe(
      'tool_denied: Tool execution denied by approval callback',
    )
  })

  it('strictTools denies every Vibe builtin request and cleans up when the account is removed', async () => {
    const asks: string[] = []
    const { cli, fake, model } = setup('/synthetic/vibe-home', {
      settings: () => ({ acpApprovalPolicy: 'session', strictTools: true }),
      authorizeBuiltin: callingSession({ fileMode: 'danger-full-access', answer: true, asks }),
    })
    const reply = await finished(cli.stream(model(), context([{ role: 'user', content: 'PERMISSION_READ', timestamp: 1 }]), { sessionId: 'strict' }))
    const profile = managedProfile(fake)
    expect(profile.toml).toContain('enabled_tools = ["mcp_dsh.*","dsh_*"]')
    expect(textOf(reply)).toBe('tool_denied: Tool execution denied by approval policy')
    expect(asks).toEqual([])
    cli.retainAccounts(new Map())
    expect(cli.processCount).toBe(0)
    await cli.dispose()
    expect(existsSync(profile.roots[0] ?? '')).toBe(false)
  })

  it('records Vibe handshake and prompt spans without the home, instructions, prompt or models', async () => {
    using recorder = recordSpans()
    const { cli, model } = setup('/synthetic/private-home')
    await finished(cli.stream(model(), context([{ role: 'user', content: 'private message', timestamp: 1 }]), { sessionId: 'spanned' }))
    const describeSpan = recorder.span('vibe describe')
    const promptSpan = recorder.span('vibe prompt')
    expect(describeSpan?.attributes).toMatchObject({ 'process.executable.name': 'vibe-acp', 'dshx.vibe.tool_count': 1 })
    expect(promptSpan?.attributes).toMatchObject({ 'process.executable.name': 'vibe-acp', 'dshx.vibe.prompt_blocks': 1 })
    expect(JSON.stringify([describeSpan?.attributes, promptSpan?.attributes])).not.toMatch(/private-home|private message|inside DSH|deepseek-v4/u)
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
