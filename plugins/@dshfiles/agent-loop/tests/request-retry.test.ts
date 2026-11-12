import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { LlmAdapter, LlmRuntime, createUserMessage, type GenerateOptions, type RequestMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import ForkedAgentLoop from '../src/native/index.ts'

const INPUT = 'the request whose first attempt never started'

/** The first request fails before any chunk, like a provider that accepted it and never streamed; the second answers. */
class NeverStartedAdapter extends LlmAdapter {
  readonly requests: (readonly RequestMessage[])[] = []

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options.messages)
    if (this.requests.length === 1) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'pi-ai stream idle timeout after 300000ms', code: 'TIMEOUT' } } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'answered' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answered' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const inputCopies = (messages: readonly RequestMessage[] | undefined): number =>
  (messages ?? []).filter(message => message.role === 'user' && JSON.stringify(message.content).includes(INPUT)).length

describe('request retry', () => {
  it('retries a request that never started without sending its input twice', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(SessionStore)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(AgentRegistry)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(NativeToolExecutor)
      await ctx.plugin(TokenMeter)
      await ctx.plugin(ForkedAgentLoop)
      ctx.on('agent/request-error', () => Promise.resolve({ kind: 'retry' as const }))

      const adapter = new NeverStartedAdapter()
      ctx.llm.registerAdapter(['never-started-test'], adapter)
      const sessionId = SessionId('never-started-session')
      const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'never-started-test', model: 'scripted' } })
      try {
        await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: INPUT }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
        const session = ctx.sessions.get(sessionId)
        if (session === undefined) throw new Error('the Session was not published')
        const stored = session.snapshotEvents().filter(event => event.type === 'user/message' && JSON.stringify(event.data).includes(INPUT))

        expect(adapter.requests).toHaveLength(2)
        expect(inputCopies(adapter.requests[0])).toBe(1)
        expect(inputCopies(adapter.requests[1])).toBe(1)
        expect(stored).toHaveLength(1)
      } finally {
        await handle.dispose()
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
