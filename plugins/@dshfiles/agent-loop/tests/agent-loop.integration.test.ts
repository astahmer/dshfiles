import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import UpstreamAgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmAdapter, LlmRuntime, createUserMessage, type GenerateOptions, type RequestMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import ForkedAgentLoop from '../src/native/index.ts'

/** One provider signature, at the size the adapters emit. */
const SIGNATURE = 'sig_'.padEnd(600, 'x')

const proseChunks = (): readonly StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'done' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } },
  {
    type: 'finish',
    reason: { kind: 'stop' },
    replayState: { response: { id: 'resp-1', stopReason: 'stop' }, blocks: [{ signature: SIGNATURE }] },
  },
]

/** Answers each turn with the same replay envelope and remembers the messages each request carried. */
class ReplayAdapter extends LlmAdapter {
  readonly requests: (readonly RequestMessage[])[] = []
  private turn = 0

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options.messages)
    this.turn += 1
    if (this.turn > 2) throw new Error('the scripted adapter answered its turns')
    for (const chunk of proseChunks()) yield chunk
  }
}

interface Observed {
  readonly streamBlocks: number
  readonly sourceBlocks: number
  readonly eventBytes: number
  readonly secondRequestBlocks: number
}

const observedRun = async (loop: unknown): Promise<Observed> => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(loop as typeof UpstreamAgentLoop)

    const adapter = new ReplayAdapter()
    ctx.llm.registerAdapter(['replay-test'], adapter)
    const sessionId = SessionId('replay-test-session')
    const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'replay-test', model: 'scripted' } })
    try {
      await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()

      const session = ctx.sessions.get(sessionId)
      if (session === undefined) throw new Error('the Session was not published')
      const message = session
        .snapshotEvents()
        .filter(event => event.type === 'assistant/message')
        .at(0)
      if (message?.type !== 'assistant/message') throw new Error('the loop stored no assistant message')
      const stream = message.data.stream ?? []
      const streamBlocks = stream.reduce<number>((total, record) => {
        const entry = record as { readonly chunk?: { readonly replayState?: { readonly blocks?: unknown } } }
        return total + (entry.chunk?.replayState?.blocks === undefined ? 0 : 1)
      }, 0)
      const source = message.data.message.source?.replayState as { readonly blocks?: unknown } | undefined
      // The second model request replays the first answer, so it carries that message's source envelope.
      const replayed = adapter.requests[1]?.filter(entry => entry.role === 'assistant') ?? []
      const secondRequestBlocks = replayed.reduce<number>((total, entry) => {
        const envelope = (entry as { readonly source?: { readonly replayState?: { readonly blocks?: unknown } } }).source?.replayState
        return total + (envelope?.blocks === undefined ? 0 : 1)
      }, 0)
      return { streamBlocks, sourceBlocks: source?.blocks === undefined ? 0 : 1, eventBytes: JSON.stringify(message.data).length, secondRequestBlocks }
    } finally {
      await handle.dispose()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('agent-loop fork', () => {
  it('stores the replay envelope once and still replays it to the provider', async () => {
    const upstream = await observedRun(UpstreamAgentLoop)
    const forked = await observedRun(ForkedAgentLoop)

    // Before: the envelope's block list sits on the message source and on the terminal stream record.
    expect(upstream.sourceBlocks).toBe(1)
    expect(upstream.streamBlocks).toBe(1)
    // After: only the message source keeps it.
    expect(forked.sourceBlocks).toBe(1)
    expect(forked.streamBlocks).toBe(0)

    // The provider keeps seeing the block list on the replayed assistant message.
    expect(upstream.secondRequestBlocks).toBe(1)
    expect(forked.secondRequestBlocks).toBe(1)

    // Measured effect of one stored message.
    expect(forked.eventBytes).toBeLessThan(upstream.eventBytes)
    console.info(
      JSON.stringify({ upstreamEventBytes: upstream.eventBytes, forkedEventBytes: forked.eventBytes, savedBytes: upstream.eventBytes - forked.eventBytes }),
    )
  })
})
