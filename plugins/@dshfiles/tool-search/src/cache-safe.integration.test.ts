import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmAdapter, LlmRuntime, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import toolSearch from './host.js'

type Step = { readonly call: string; readonly args: Record<string, unknown> } | { readonly text: string }

interface ObservedRequest {
  readonly tools: string
  readonly toolNames: readonly string[]
  readonly lastMessage: string
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: ObservedRequest[] = []

  constructor(private readonly steps: readonly Step[]) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const tools = options.tools ?? []
    this.requests.push({
      tools: JSON.stringify(tools),
      toolNames: tools.map(tool => tool.name).sort(),
      lastMessage: JSON.stringify(options.messages.at(-1) ?? null),
    })
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

const runCacheSafe = async (input: { readonly steps: readonly Step[]; readonly denyTool?: string }) => {
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
    if (toolSearch.setup === undefined) throw new Error('Tool-search Host setup is missing')
    await ctx.plugin({ ...toolSearch, apply: toolSearch.setup }, { mode: 'cache-safe', alwaysVisible: [] })

    const adapter = new ScriptedAdapter(input.steps)
    ctx.llm.registerAdapter(['cache-safe-test'], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId(`tool-search-cache-safe-${Date.now()}`),
      agentOptions: { provider: 'cache-safe-test', model: 'scripted' },
    })
    disposeAgent = () => handle.dispose()
    await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Do the task.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    return { writes, purges, requests: adapter.requests }
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
