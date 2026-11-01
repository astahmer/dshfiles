import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, createUserMessage, markAgentLoopRequest, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import type { RequestMessagesPayload } from './contract.ts'
import { installRequestMessages } from './polyfill.ts'

class EchoAdapter extends LlmAdapter {
  readonly seen: (readonly string[])[] = []
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options.messages.map(message => (message.content[0]?.type === 'text' ? message.content[0].text : '')))
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const sessionId = SessionId('session-1')
const history: readonly Message[] = ['first turn', 'first answer', 'second turn'].map(text =>
  createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
)

const startHost = async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const adapter = new EchoAdapter()
  ctx.llm.registerAdapter(['echo'], adapter)
  const agent = { id: sessionId, session: { id: sessionId, snapshotEvents: () => [{ type: 'step/start', data: { turn: 2, step: 1 } }] } }
  ctx.provide('agents')
  ctx.set('agents', { get: (id: string) => (id === sessionId ? agent : undefined) })
  const payloads: Omit<RequestMessagesPayload, 'agent' | 'signal' | 'toolHistory'>[] = []
  ctx.on('agent/request-messages', async (payload, next) => {
    payloads.push({ turn: payload.turn, step: payload.step, isFirstStepOfTurn: payload.isFirstStepOfTurn, messages: payload.messages })
    return (await next()).slice(-1)
  })
  const install = async () => {
    const scope = Effect.runSync(Scope.make())
    const status = await Effect.runPromise(Scope.provide(scope)(installRequestMessages(ctx, ctx.llm, effect => Effect.runPromise(effect))))
    return { status, dispose: () => Effect.runPromise(Scope.close(scope, Exit.void)) }
  }
  return { ctx, adapter, payloads, install }
}

const drain = async (stream: AsyncIterable<StreamChunk>): Promise<void> => {
  for await (const _chunk of stream);
}

const loopRequest = (): GenerateOptions => {
  const messages = [...history]
  Object.freeze(messages)
  return markAgentLoopRequest(
    Object.freeze({ provider: 'echo', model: 'echo-1', messages, toolHistory: { tools: [], updates: [] }, sessionId, signal: new AbortController().signal }),
  )
}

describe('agent/request-messages polyfill', () => {
  it('sends the messages a listener returns for an agent-loop request', async () => {
    const { ctx, adapter, payloads, install } = await startHost()
    await install()
    await drain(ctx.llm.stream(loopRequest()))
    expect(adapter.seen).toEqual([['second turn']])
    expect(payloads).toEqual([{ turn: 2, step: 1, isFirstStepOfTurn: true, messages: history }])
  })

  it('leaves requests the agent loop did not build untouched', async () => {
    const { ctx, adapter, payloads, install } = await startHost()
    await install()
    await drain(ctx.llm.stream({ provider: 'echo', model: 'echo-1', messages: [...history], purpose: 'compaction' }))
    expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
    expect(payloads).toEqual([])
  })

  it('sends derived messages when a request-messages listener fails', async () => {
    const { ctx, adapter, install } = await startHost()
    ctx.on('agent/request-messages', () => {
      throw new Error('listener failed')
    })
    await install()
    await drain(ctx.llm.stream(loopRequest()))
    expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
  })

  it('restores the runtime when the last copy unloads', async () => {
    const { ctx, adapter, payloads, install } = await startHost()
    const fiber = await install()
    expect(fiber.status).toEqual({ active: true })
    expect(Object.hasOwn(ctx.llm, 'adapterStream')).toBe(true)
    await fiber.dispose()
    expect(Object.hasOwn(ctx.llm, 'adapterStream')).toBe(false)
    await drain(ctx.llm.stream(loopRequest()))
    expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
    expect(payloads).toEqual([])
  })

  it('dispatches once when two copies are loaded', async () => {
    const { ctx, adapter, payloads, install } = await startHost()
    const first = await install()
    const second = await install()
    await drain(ctx.llm.stream(loopRequest()))
    expect(payloads).toHaveLength(1)
    await first.dispose()
    await drain(ctx.llm.stream(loopRequest()))
    expect(payloads).toHaveLength(2)
    expect(adapter.seen.at(-1)).toEqual(['second turn'])
    await second.dispose()
    expect(Object.hasOwn(ctx.llm, 'adapterStream')).toBe(false)
  })
})
