import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { LlmAdapter, LlmRuntime, ToolCallId, createUserMessage, type GenerateOptions, type RequestMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import ForkedAgentLoop from '../src/native/index.ts'

const CUT_CALL = ToolCallId('call_cut')

const text = (index: number, value: string): StreamChunk[] => [
  { type: 'block-start', index, blockType: 'text' },
  { type: 'text-delta', index, text: value },
  { type: 'block-end', index, block: { type: 'text', text: value } },
]

/** Every reply stops at the output-token limit until `cutReplies` were sent; the first one also starts a tool call. */
class TruncatingAdapter extends LlmAdapter {
  readonly requests: (readonly RequestMessage[])[] = []

  constructor(private readonly cutReplies: number) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options.messages)
    const reply = this.requests.length
    if (reply > this.cutReplies) {
      yield* text(0, ' and the end.')
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    yield* text(0, `part ${reply} of a long answer`)
    if (reply === 1) {
      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 1, id: CUT_CALL, name: 'write', argumentsDelta: '{"path":"big.md","content":"' }
    }
    yield { type: 'finish', reason: { kind: 'max-tokens' } }
  }
}

const run = async (input: { readonly install: (ctx: Context) => Promise<void>; readonly cutReplies: number }) => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TokenMeter)
    await input.install(ctx)

    const adapter = new TruncatingAdapter(input.cutReplies)
    ctx.llm.registerAdapter(['truncating-test'], adapter)
    const sessionId = SessionId('truncating-test-session')
    const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'truncating-test', model: 'scripted' } })
    try {
      await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'write the long doc' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      const session = ctx.sessions.get(sessionId)
      if (session === undefined) throw new Error('the Session was not published')
      const events = session.snapshotEvents()
      const assistantTexts = events.flatMap(event =>
        event.type === 'assistant/message' ? [event.data.message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')] : [],
      )
      const notes = events.flatMap(event =>
        event.type === 'user/message' && event.data.source.kind === 'output-limit-continuation'
          ? [event.data.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')]
          : [],
      )
      const turnEnd = events.findLast(event => event.type === 'turn/end')
      const toolCalls = events.filter(event => event.type === 'tool/call').length
      const userPrompts = events.filter(event => event.type === 'user/message' && JSON.stringify(event.data).includes('write the long doc')).length
      return { adapter, assistantTexts, notes, toolCalls, userPrompts, turnEnd: turnEnd?.type === 'turn/end' ? turnEnd.data.reason : undefined }
    } finally {
      await handle.dispose()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('output-limit continuation', () => {
  it('ends the turn at the limit by default, like upstream', async () => {
    const forked = await run({
      install: async ctx => {
        await ctx.plugin(ForkedAgentLoop)
      },
      cutReplies: 1,
    })
    expect(forked.adapter.requests).toHaveLength(1)
    expect(forked.turnEnd).toEqual({ kind: 'max-tokens' })
    expect(forked.notes).toEqual([])
  })

  it('continues a cut reply once, keeps the streamed text once, and names the cut tool call', async () => {
    const forked = await run({
      install: async ctx => {
        await ctx.plugin(ForkedAgentLoop, { maxOutputLimitContinuations: 2 })
      },
      cutReplies: 1,
    })
    expect(forked.adapter.requests).toHaveLength(2)
    expect(forked.turnEnd).toEqual({ kind: 'completed' })
    expect(forked.assistantTexts).toEqual(['part 1 of a long answer', ' and the end.'])
    expect(forked.notes).toHaveLength(1)
    expect(forked.notes[0]).toMatch(/output-token limit \(automatic continuation 1 of 2\)/)
    expect(forked.notes[0]).toMatch(/Do not repeat/)
    expect(forked.notes[0]).toMatch(/«part 1 of a long answer»/)
    expect(forked.notes[0]).toMatch(/cut a tool call \("write"\).*nothing ran/)
    // The cut call was dropped, never run; the user's prompt was sent once.
    expect(forked.toolCalls).toBe(0)
    expect(forked.userPrompts).toBe(1)
    // The second request replays the cut reply exactly once, then the note.
    const second = forked.adapter.requests[1] ?? []
    expect(JSON.stringify(second).split('part 1 of a long answer').length - 1).toBe(2)
  })

  it('stops after the configured number of continuations and keeps the max-tokens outcome', async () => {
    const forked = await run({
      install: async ctx => {
        await ctx.plugin(ForkedAgentLoop, { maxOutputLimitContinuations: 2 })
      },
      cutReplies: 5,
    })
    expect(forked.adapter.requests).toHaveLength(3)
    expect(forked.notes).toHaveLength(2)
    expect(forked.turnEnd).toEqual({ kind: 'max-tokens' })
  })

  it('refuses more than two continuations', async () => {
    await expect(
      run({
        install: async ctx => {
          await ctx.plugin(ForkedAgentLoop, { maxOutputLimitContinuations: 3 })
        },
        cutReplies: 5,
      }),
    ).rejects.toThrow()
  })
})
