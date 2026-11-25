import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmAdapter, LlmRuntime, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { ToolRuntime, defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import type { Schema } from 'effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { TOOL_ACCESS_ALL, type ToolAccessConfig, type ToolAccessPolicy, type ToolAccessProvider, type ToolAccessSubject } from './access.js'
import toolSearch from './host.js'

/** One scripted model step: a tool call with the JSON arguments the model sends, or a final text. */
type Step = { readonly call: string; readonly args: Schema.JsonObject } | { readonly text: string }

interface ObservedRequest {
  readonly tools: string
  readonly toolNames: readonly string[]
  readonly lastMessage: string
  readonly messages: string
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: ObservedRequest[] = []

  constructor(
    private readonly steps: readonly Step[],
    private readonly onRequest: (index: number) => void = () => undefined,
  ) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const tools = options.tools ?? []
    this.requests.push({
      tools: JSON.stringify(tools),
      toolNames: tools.map(tool => tool.name).sort(),
      lastMessage: JSON.stringify(options.messages.at(-1) ?? null),
      messages: JSON.stringify(options.messages),
    })
    this.onRequest(this.requests.length - 1)
    const step = this.steps[this.requests.length - 1] ?? { text: 'Done.' }
    if ('text' in step) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: step.text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const id = ToolCallId(`call-${this.requests.length}`)
    const argumentsValue = JSON.stringify(step.args)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: step.call, argumentsDelta: argumentsValue }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: step.call, arguments: argumentsValue } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

const runCacheSafe = async (input: {
  readonly steps: readonly Step[]
  readonly denyTool?: string
  readonly config?: { readonly mode: 'cache-safe' | 'progressive'; readonly alwaysVisible: readonly string[] }
  readonly onRequest?: (index: number, ctx: Context) => void
  /** A tool access provider registered before the agent exists, as @dshfiles/agents does. */
  readonly provider?: ToolAccessProvider
  /** Extra callable global tools (MCP-named ones, for groups), registered before the agent. */
  readonly extraTools?: readonly string[]
  /** The Session header the agent is created with. */
  readonly meta?: { readonly cwd: string; readonly origin: 'subagent'; readonly parentSession: string; readonly delegationDepth: number }
}) => {
  const ctx = new Context()
  const writes: { path: string; contents: string }[] = []
  const purges: string[] = []
  let disposeAgent: (() => Promise<void>) | undefined
  try {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(AgentLoop)
    ctx.tools.register(
      defineTool({
        name: 'write_file',
        description: 'Write text content to a file.',
        parameters: { path: { type: 'string', required: true }, contents: { type: 'string', required: true } },
        output: {
          schema: { type: 'object', properties: { saved: { type: 'boolean' } }, additionalProperties: false },
          render: (_args, result) => [{ type: 'text', text: result.saved ? 'Saved write.' : 'Not saved.' }],
        },
        execute: async args => {
          writes.push({ path: args.path, contents: args.contents })
          return { saved: true }
        },
      }),
    )
    ctx.tools.register({
      name: 'purge_cache',
      description: 'Delete every cached build artifact. Run only when the user asked; requires confirm: true.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string' }, confirm: { type: 'boolean', enum: [true] } },
        required: ['target', 'confirm'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'Purged.' }] },
      execute: async args => {
        purges.push(JSON.stringify(args))
        return {}
      },
    })
    if (input.denyTool !== undefined) {
      const denied = input.denyTool
      ctx.on('tools/pre-execute', (exec, next) => (exec.name === denied ? Promise.resolve({ kind: 'deny', reason: `policy refuses ${denied}` }) : next()))
    }
    const calls: string[] = []
    for (const name of input.extraTools ?? []) ctx.tools.register(callableTool(name, calls))
    if (input.provider !== undefined) ctx.provide('dshfilesToolAccess', input.provider)
    if (toolSearch.setup === undefined) throw new Error('Tool-search Host setup is missing')
    await ctx.plugin({ ...toolSearch, apply: toolSearch.setup }, { mode: 'cache-safe', alwaysVisible: [], ...input.config })

    const adapter = new ScriptedAdapter(input.steps, index => input.onRequest?.(index, ctx))
    ctx.llm.registerAdapter(['cache-safe-test'], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-search-cache-safe-${Date.now()}`),
      agentOptions: { provider: 'cache-safe-test', model: 'scripted' },
      ...(input.meta !== undefined && { meta: { ...input.meta, parentSession: SessionId(input.meta.parentSession) } }),
    })
    disposeAgent = () => handle.dispose()
    await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Do the task.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    return { writes, purges, calls, sessionId: String(handle.agent.id), requests: adapter.requests }
  } finally {
    await disposeAgent?.()
    await ctx.fiber.dispose()
  }
}

const writeArgs = { path: '/tmp/note.txt', contents: 'measured' }

describe('tool-search cache-safe mode', () => {
  it('returns schemas in the search result and keeps the declared tools identical across the Session', async () => {
    const result = await runCacheSafe({
      steps: [
        { call: 'tool_search', args: { query: 'write text to a file', limit: 1 } },
        { call: 'tool_call', args: { name: 'write_file', args: writeArgs } },
        { text: 'Saved.' },
      ],
    })

    expect(result.writes).toEqual([writeArgs])
    expect(result.requests).toHaveLength(3)
    expect(result.requests[0]?.toolNames).toEqual(['tool_call', 'tool_search'])
    expect(new Set(result.requests.map(request => request.tools)).size).toBe(1)
    expect(result.requests[1]?.lastMessage).toContain('## write_file')
    expect(result.requests[1]?.lastMessage).toContain('\\"contents\\"')
    expect(result.requests[2]?.lastMessage).toContain('Saved write.')
  })

  it('still runs a deferred tool called by its real name without declaring it', async () => {
    const result = await runCacheSafe({ steps: [{ call: 'write_file', args: writeArgs }, { text: 'Saved.' }] })

    expect(result.writes).toEqual([writeArgs])
    expect(result.requests.every(request => request.toolNames.join() === 'tool_call,tool_search')).toBe(true)
  })

  it('rejects arguments the target schema refuses before dispatch, destructive opt-ins included', async () => {
    const result = await runCacheSafe({
      steps: [
        { call: 'tool_call', args: { name: 'write_file', args: { path: 42 } } },
        { call: 'tool_call', args: { name: 'purge_cache', args: { target: 'all' } } },
        { call: 'tool_call', args: { name: 'purge_cache', args: { target: 'all', confirm: true } } },
        { text: 'Done.' },
      ],
    })

    expect(result.writes).toEqual([])
    expect(result.requests[1]?.lastMessage).toContain('Invalid arguments for write_file')
    expect(result.requests[2]?.lastMessage).toContain('Invalid arguments for purge_cache')
    expect(result.purges).toEqual([JSON.stringify({ target: 'all', confirm: true })])
  })

  it('applies pre-execute policies to the proxied call', async () => {
    const result = await runCacheSafe({
      denyTool: 'write_file',
      steps: [{ call: 'tool_call', args: { name: 'write_file', args: writeArgs } }, { text: 'Refused.' }],
    })

    expect(result.writes).toEqual([])
    expect(result.requests[1]?.lastMessage).toContain('policy refuses write_file')
  })

  it('names tool_search for an unknown tool and refuses to proxy itself', async () => {
    const result = await runCacheSafe({
      steps: [
        { call: 'tool_call', args: { name: 'no_such_tool', args: {} } },
        { call: 'tool_call', args: { name: 'tool_search', args: { query: 'x' } } },
        { text: 'Done.' },
      ],
    })

    expect(result.requests[1]?.lastMessage).toContain('Find it with tool_search first')
    expect(result.requests[2]?.lastMessage).toContain('tool_call cannot call tool_search')
  })
})

const midSessionTool = (name: string, description: string): ToolDefinition => ({
  name,
  description,
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'ok' }] },
  execute: async () => ({}),
})

/** Request 0 adds two global tools, request 1 removes one of them: the shape of an MCP server's tool list changing. */
const runToolSetChange = (mode: 'cache-safe' | 'progressive') => {
  let removeDeploy: (() => void) | undefined
  return runCacheSafe({
    config: { mode, alwaysVisible: ['job_*'] },
    steps: [{ call: 'write_file', args: writeArgs }, { call: 'write_file', args: writeArgs }, { text: 'Done.' }],
    onRequest: (index, ctx) => {
      if (index === 0) {
        removeDeploy = ctx.tools.register(midSessionTool('deploy_preview', 'Deploy a preview build of the current branch. Run only when the user asked.'))
        ctx.tools.register(midSessionTool('job_audit', 'Audit background jobs.'))
      }
      if (index === 1) removeDeploy?.()
    },
  })
}

describe('tool-search mid-Session tool set changes', () => {
  it.each(['cache-safe', 'progressive'] as const)('tells a %s agent only what was added or removed', async mode => {
    const result = await runToolSetChange(mode)

    const [, afterAdd, afterRemove] = result.requests
    expect(afterAdd?.lastMessage).toContain('deploy_preview: Deploy a preview build of the current branch.')
    expect(afterAdd?.lastMessage).toContain('job_audit: Audit background jobs.')
    expect(afterAdd?.lastMessage).not.toContain('Run only when the user asked')
    expect(afterAdd?.lastMessage).not.toContain('write_file')
    expect(afterAdd?.lastMessage).not.toContain('purge_cache')
    expect(afterRemove?.lastMessage).toContain('Removed: deploy_preview')
    expect(afterRemove?.lastMessage).not.toContain('job_audit')
    expect(afterRemove?.messages.split('Audit background jobs.').length).toBe(2)
  })

  it('sends no notice while the tool set is unchanged', async () => {
    const result = await runCacheSafe({ steps: [{ call: 'write_file', args: writeArgs }, { text: 'Saved.' }] })

    expect(result.requests.some(request => request.messages.includes('tool set changed'))).toBe(false)
  })

  it('keeps the declared tool list fixed in cache-safe mode when an always-visible tool appears mid-Session', async () => {
    const result = await runToolSetChange('cache-safe')

    expect(result.requests[0]?.toolNames).toEqual(['tool_call', 'tool_search'])
    expect(new Set(result.requests.map(request => request.tools)).size).toBe(1)
  })
})

/** A no-argument global tool that records its calls, standing in for an MCP server's tools. */
function callableTool(name: string, calls: string[]): ToolDefinition {
  return {
    name,
    description: `Run ${name.replaceAll('_', ' ')}.`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: `${name} ran.` }] },
    execute: async () => {
      calls.push(name)
      return {}
    },
  }
}

/**
 * A provider as @dshfiles/agents implements it, reduced to one agent: `override` switches the thread to another tool set
 * (null for "all tools") and reports the change, the way a per-thread override does.
 */
const scriptedProvider = (input: { readonly agent: string; readonly access: ToolAccessConfig }) => {
  const listeners = new Set<(sessionId: string) => void>()
  const subjects: ToolAccessSubject[] = []
  let override: { readonly toolsFrom: string | null; readonly access: ToolAccessConfig } | undefined
  const change = 'Change it in the Agents panel, or clear the override.'
  const provider: ToolAccessProvider = {
    resolve: subject => {
      subjects.push(subject)
      const policy: ToolAccessPolicy =
        override === undefined
          ? { agent: input.agent, source: 'agent', toolsFrom: input.agent, access: input.access, change }
          : { agent: input.agent, source: 'override', toolsFrom: override.toolsFrom, access: override.access, change }
      return policy
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    provider,
    subjects,
    setOverride: (sessionId: string, next: { readonly toolsFrom: string | null; readonly access: ToolAccessConfig } | undefined) => {
      override = next
      for (const listener of listeners) listener(sessionId)
    },
  }
}

describe('tool-search per-agent tool access', () => {
  const access: ToolAccessConfig = { tools: { write_file: { enabled: false }, purge_cache: { pinned: true } }, groups: {} }

  it('keeps a disabled tool out of the declarations, tool_search, tool_call and a direct call, and declares a pinned one', async () => {
    const scripted = scriptedProvider({ agent: 'reviewer', access })
    const result = await runCacheSafe({
      provider: scripted.provider,
      steps: [
        { call: 'tool_search', args: { query: 'write text to a file', limit: 2 } },
        { call: 'tool_call', args: { name: 'write_file', args: writeArgs } },
        { call: 'write_file', args: writeArgs },
        { text: 'Refused.' },
      ],
    })

    expect(result.writes).toEqual([])
    expect(result.requests[0]?.toolNames).toEqual(['purge_cache', 'tool_call', 'tool_search'])
    expect(new Set(result.requests.map(request => request.tools)).size).toBe(1)
    expect(result.requests.every(request => !request.tools.includes('Write text content to a file'))).toBe(true)
    expect(result.requests[1]?.lastMessage).not.toContain('## write_file')
    expect(result.requests[1]?.lastMessage).toContain('disabled for this thread: write_file')
    expect(result.requests[2]?.lastMessage).toContain('tool_call cannot call write_file is disabled for this thread, whose tools come from @reviewer')
    expect(result.requests[2]?.lastMessage).toContain('Change it in the Agents panel')
    expect(result.requests[3]?.lastMessage).toContain('write_file is disabled for this thread, whose tools come from @reviewer')
  })

  it('lets a tool entry beat its group, disables a tool that appears later in a disabled group, and enables a new group', async () => {
    const grouped: ToolAccessConfig = {
      tools: { mcp__github__list_issues: { enabled: true, pinned: true } },
      groups: { 'mcp:github': { enabled: false } },
    }
    const scripted = scriptedProvider({ agent: 'reviewer', access: grouped })
    const result = await runCacheSafe({
      provider: scripted.provider,
      extraTools: ['mcp__github__list_issues', 'mcp__github__create_issue'],
      onRequest: (index, ctx) => {
        if (index !== 0) return
        ctx.tools.register(callableTool('mcp__github__delete_repo', laterCalls))
        ctx.tools.register(callableTool('mcp__linear__list_issues', laterCalls))
      },
      steps: [
        { call: 'tool_call', args: { name: 'mcp__github__create_issue', args: {} } },
        { call: 'tool_call', args: { name: 'mcp__github__delete_repo', args: {} } },
        { call: 'tool_call', args: { name: 'mcp__linear__list_issues', args: {} } },
        { call: 'mcp__github__list_issues', args: {} },
        { text: 'Done.' },
      ],
    })

    expect(result.requests[0]?.toolNames).toEqual(['mcp__github__list_issues', 'tool_call', 'tool_search'])
    expect(result.requests[1]?.messages).toContain('mcp__github__create_issue is disabled for this thread')
    // The tool-set notice names the new group's tool, never the one its disabled group keeps out.
    expect(result.requests[1]?.messages).toContain('mcp__linear__list_issues')
    expect(result.requests[1]?.messages).not.toContain('- mcp__github__delete_repo')
    expect(result.requests[2]?.messages).toContain('mcp__github__delete_repo is disabled for this thread')
    expect(laterCalls).toEqual(['mcp__linear__list_issues'])
    expect(result.calls).toEqual(['mcp__github__list_issues'])
  })

  it('switches a thread to an override from its next request and back again', async () => {
    using recorder = recordSpans()
    const scripted = scriptedProvider({ agent: 'reviewer', access })
    const purge = { call: 'tool_call', args: { name: 'purge_cache', args: { target: 'tmp', confirm: true } } } as const
    const write = { call: 'tool_call', args: { name: 'write_file', args: writeArgs } } as const
    const result = await runCacheSafe({
      provider: scripted.provider,
      onRequest: index => {
        const sessionId = scripted.subjects[0]?.sessionId ?? ''
        if (index === 1) scripted.setOverride(sessionId, { toolsFrom: null, access: TOOL_ACCESS_ALL })
        if (index === 3) scripted.setOverride(sessionId, undefined)
      },
      steps: [write, purge, write, purge, write, { text: 'Done.' }],
    })

    // Set while request 1 streams, the override applies from request 2; cleared while request 3 streams, the agent's
    // tool set is back from request 4, with the same declarations byte for byte.
    expect(result.writes).toEqual([writeArgs])
    expect(result.requests[1]?.lastMessage).toContain('write_file is disabled for this thread')
    expect(result.requests[1]?.tools).toBe(result.requests[0]?.tools)
    expect(result.requests[0]?.toolNames).toEqual(['purge_cache', 'tool_call', 'tool_search'])
    expect(result.requests[2]?.toolNames).toEqual(['tool_call', 'tool_search'])
    expect(result.requests[3]?.messages).toContain('Saved write.')
    expect(result.requests[4]?.tools).toBe(result.requests[0]?.tools)
    expect(result.requests[5]?.lastMessage).toContain('write_file is disabled for this thread')
    expect(recorder.span('tool search access change')).toBeDefined()
  })

  it("hands the provider a subagent's parent Session and resolves it once", async () => {
    const scripted = scriptedProvider({ agent: 'reviewer', access: TOOL_ACCESS_ALL })
    await runCacheSafe({
      provider: scripted.provider,
      meta: { cwd: '/work/repo-threads/thread-1a2b3c', origin: 'subagent', parentSession: 'session-parent', delegationDepth: 1 },
      steps: [{ call: 'write_file', args: writeArgs }, { text: 'Saved.' }],
    })

    expect(scripted.subjects).toHaveLength(1)
    expect(scripted.subjects[0]).toMatchObject({ cwd: '/work/repo-threads/thread-1a2b3c', parentSessionId: 'session-parent' })
  })

  it('leaves every tool on without a provider, as before', async () => {
    const result = await runCacheSafe({ steps: [{ call: 'tool_call', args: { name: 'write_file', args: writeArgs } }, { text: 'Saved.' }] })

    expect(result.writes).toEqual([writeArgs])
    expect(result.requests[0]?.toolNames).toEqual(['tool_call', 'tool_search'])
  })
})

const laterCalls: string[] = []
