import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import UpstreamAgentLoop from '@deepseek-ai/dsh-agent-loop'
import { LlmAdapter, LlmRuntime, ToolCallId, createUserMessage, type GenerateOptions, type RequestMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import ForkedAgentLoop from '../src/native/index.ts'
import { TOOL_ARGUMENTS_LIMIT_EXCEEDED } from '../src/native/tool-argument-limit.ts'

const CALL_ID = ToolCallId('call_runaway')
const DELTA = '\n '

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * First request: one `apply_patch` call whose arguments never end, like the 2026-11-11 runaway. The adapter counts
 * how many deltas it produced before the loop stopped reading. Second request: a plain answer.
 */
class RunawayAdapter extends LlmAdapter {
  readonly requests: (readonly RequestMessage[])[] = []
  deltasSent = 0
  stoppedEarly = false

  constructor(private readonly delayMs: number) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options.messages)
    if (this.requests.length > 1) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'retried in chunks' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'retried in chunks' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    let finished = false
    try {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CALL_ID, name: 'apply_patch', argumentsDelta: '{"path":"README.md","edits":[{"old":"a","new":"' }
      for (let sent = 0; sent < 2_000; sent++) {
        if (this.delayMs > 0) await pause(this.delayMs)
        this.deltasSent += 1
        yield { type: 'tool-call-delta', index: 0, id: CALL_ID, argumentsDelta: DELTA }
      }
      finished = true
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CALL_ID, name: 'apply_patch', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } finally {
      if (!finished) this.stoppedEarly = true
    }
  }
}

const run = async (input: { readonly install: (ctx: Context) => Promise<void>; readonly delayMs: number }) => {
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

    const adapter = new RunawayAdapter(input.delayMs)
    ctx.llm.registerAdapter(['runaway-test'], adapter)
    const sessionId = SessionId('runaway-test-session')
    const handle = await ctx.agents.create({ sessionId, agentOptions: { provider: 'runaway-test', model: 'scripted' } })
    try {
      await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'patch the readme' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      const session = ctx.sessions.get(sessionId)
      if (session === undefined) throw new Error('the Session was not published')
      const events = session.snapshotEvents()
      const results = events.flatMap(event => (event.type === 'tool/result' ? [event.data] : []))
      const calls = events.flatMap(event => (event.type === 'tool/call' ? [event.data] : []))
      const turnEnd = events.findLast(event => event.type === 'turn/end')
      const userMessages = events.filter(event => event.type === 'user/message' && JSON.stringify(event.data).includes('patch the readme'))
      return { adapter, results, calls, turnEnd: turnEnd?.type === 'turn/end' ? turnEnd.data.reason : undefined, userMessages: userMessages.length }
    } finally {
      await handle.dispose()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

const resultText = (result: { readonly message: { readonly content: readonly { readonly type: string; readonly text?: string }[] } } | undefined) =>
  result?.message.content.map(block => block.text ?? '').join('') ?? ''

describe('tool argument limit', () => {
  it('stops a call whose arguments outgrow the byte limit, runs nothing, and tells the model how to retry', async () => {
    const upstream = await run({
      install: async ctx => {
        await ctx.plugin(UpstreamAgentLoop)
      },
      delayMs: 0,
    })
    // Before: the loop reads every runaway delta and then hands the call to the tool.
    expect(upstream.adapter.deltasSent).toBe(2_000)
    expect(upstream.adapter.stoppedEarly).toBe(false)

    const forked = await run({
      install: async ctx => {
        await ctx.plugin(ForkedAgentLoop, { maxToolCallArgumentBytes: 256 })
      },
      delayMs: 0,
    })
    expect(forked.adapter.stoppedEarly).toBe(true)
    expect(forked.adapter.deltasSent).toBeLessThan(200)
    expect(forked.calls).toEqual([expect.objectContaining({ callId: CALL_ID, name: 'apply_patch', arguments: '{}' })])
    expect(forked.results).toHaveLength(1)
    expect(forked.results[0]?.error).toEqual({ name: 'ToolArgumentsLimitExceeded', code: TOOL_ARGUMENTS_LIMIT_EXCEEDED })
    expect(forked.results[0]?.message.isError).toBe(true)
    expect(resultText(forked.results[0])).toMatch(/was not run.*limit 256 B/s)
    expect(resultText(forked.results[0])).toMatch(/several smaller calls/)
    // The turn continues: the next step reads the error and answers; the user's input was sent once.
    expect(forked.adapter.requests).toHaveLength(2)
    expect(forked.turnEnd).toEqual({ kind: 'completed' })
    expect(forked.userMessages).toBe(1)
  })

  it('stops a call that keeps streaming arguments past the time limit', async () => {
    const forked = await run({
      install: async ctx => {
        await ctx.plugin(ForkedAgentLoop, { toolCallArgumentTimeoutMs: 40 })
      },
      delayMs: 5,
    })
    expect(forked.adapter.stoppedEarly).toBe(true)
    expect(forked.adapter.deltasSent).toBeLessThan(100)
    expect(resultText(forked.results[0])).toMatch(/streamed arguments for \d+ ms \(limit 40 ms/)
    expect(forked.turnEnd).toEqual({ kind: 'completed' })
  })
})
