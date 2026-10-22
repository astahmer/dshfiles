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

interface ObservedRequest {
  readonly toolNames: readonly string[]
  readonly schemaBytes: number
  readonly toolsTokens: number
}

interface ScenarioResult {
  readonly writes: readonly { path: string; contents: string }[]
  readonly requests: readonly ObservedRequest[]
}

const toolCallChunks = (id: string, name: string, argumentsValue: string): StreamChunk[] => {
  const toolCallId = ToolCallId(id)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: toolCallId, name, argumentsDelta: argumentsValue },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: toolCallId, name, arguments: argumentsValue } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedToolSearchAdapter extends LlmAdapter {
  readonly requests: ObservedRequest[] = []
  requestIndex = 0

  constructor(
    private readonly ctx: Context,
    private readonly progressive: boolean,
  ) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.sessionId === undefined) throw new Error('AgentLoop did not attach a session id')
    const session = this.ctx.sessions.get(options.sessionId)
    if (session === undefined) throw new Error('AgentLoop session was not published')
    const breakdown = this.ctx.sessionProjections.stateOf(session, 'contextBreakdown')
    if (breakdown === undefined) throw new Error('TokenMeter did not register contextBreakdown')

    const tools = options.tools ?? []
    this.requests.push({
      toolNames: tools.map(tool => tool.name).sort(),
      schemaBytes: JSON.stringify(tools).length,
      toolsTokens: breakdown.breakdown.toolsTokens,
    })

    this.requestIndex += 1
    const isSearchRequest = this.progressive && this.requestIndex === 1
    const isWriteRequest = this.requestIndex === (this.progressive ? 2 : 1)
    const chunks = isSearchRequest
      ? toolCallChunks('search-1', 'tool_search', JSON.stringify({ query: 'write_file', limit: 1 }))
      : isWriteRequest
        ? toolCallChunks('write-1', 'write_file', JSON.stringify({ path: '/tmp/note.txt', contents: 'measured' }))
        : ([
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text: 'Saved.' },
            { type: 'block-end', index: 0, block: { type: 'text', text: 'Saved.' } },
            { type: 'finish', reason: { kind: 'stop' } },
          ] satisfies StreamChunk[])

    for (const chunk of chunks) yield chunk
  }
}

const runScenario = async (progressive: boolean): Promise<ScenarioResult> => {
  const ctx = new Context()
  const writes: { path: string; contents: string }[] = []
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
        parameters: {
          path: { type: 'string', required: true },
          contents: { type: 'string', required: true },
        },
        output: {
          schema: { type: 'object', properties: { saved: { type: 'boolean' } }, additionalProperties: false },
          render: (_args, result) => [{ type: 'text', text: result.saved ? 'Saved.' : 'Not saved.' }],
        },
        execute: async args => {
          writes.push({ path: args.path, contents: args.contents })
          return { saved: true }
        },
      }),
    )

    if (progressive) {
      if (toolSearch.setup === undefined) throw new Error('Tool-search Host setup is missing')
      await ctx.plugin({ ...toolSearch, apply: toolSearch.setup })
    }

    const adapter = new ScriptedToolSearchAdapter(ctx, progressive)
    ctx.llm.registerAdapter(['tool-search-test'], adapter)

    const handle = await ctx.agents.create({
      sessionId: SessionId('tool-search-integration'),
      agentOptions: { provider: 'tool-search-test', model: 'scripted' },
    })
    disposeAgent = () => handle.dispose()
    await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Save the measured note.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    return { writes: [...writes], requests: [...adapter.requests] }
  } finally {
    await disposeAgent?.()
    await ctx.fiber.dispose()
  }
}

describe('tool-search AgentLoop integration', () => {
  it('compares direct and progressive discovery for a scripted file write', async () => {
    const direct = await runScenario(false)
    const progressive = await runScenario(true)
    const expectedWrites = [{ path: '/tmp/note.txt', contents: 'measured' }]

    const directToolTokens = direct.requests.reduce((total, request) => total + request.toolsTokens, 0)
    const progressiveToolTokens = progressive.requests.reduce((total, request) => total + request.toolsTokens, 0)

    expect(direct.writes).toEqual(expectedWrites)
    expect(progressive.writes).toEqual(expectedWrites)
    expect(direct.requests.map(request => request.toolNames)).toEqual([['write_file'], ['write_file']])
    expect(progressive.requests.map(request => request.toolNames)).toEqual([['tool_search'], ['tool_search', 'write_file'], ['tool_search', 'write_file']])
    expect(progressive.requests).toHaveLength(direct.requests.length + 1)
    expect(progressiveToolTokens).toBeGreaterThan(directToolTokens)
    expect(progressive.requests[0]?.schemaBytes).toBeGreaterThan(direct.requests[0]?.schemaBytes ?? 0)
    expect(progressive.requests[0]?.toolsTokens).toBeGreaterThan(direct.requests[0]?.toolsTokens ?? 0)

    if (process.env.DSH_TOOL_SEARCH_MEASURE === '1') {
      console.info(
        JSON.stringify({
          direct: {
            taskRequests: direct.requests.length,
            totalToolTokens: directToolTokens,
            requests: direct.requests.map(({ toolNames, schemaBytes, toolsTokens }) => ({ toolNames, schemaBytes, toolsTokens })),
          },
          progressive: {
            taskRequests: progressive.requests.length,
            totalToolTokens: progressiveToolTokens,
            requests: progressive.requests.map(({ toolNames, schemaBytes, toolsTokens }) => ({ toolNames, schemaBytes, toolsTokens })),
          },
        }),
      )
    }
  })
})
