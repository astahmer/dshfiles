import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, createUserMessage, markAgentLoopRequest, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Scope } from 'effect'
import type { RequestMessagesPayload } from './contract.ts'
import plugin from './host.ts'
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

const provideAgentHost = async (ctx: Context) => {
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
  return { adapter, payloads }
}

const startHost = Effect.gen(function* () {
  const ctx = new Context()
  const { adapter, payloads } = yield* Effect.promise(() => provideAgentHost(ctx))
  const install = Effect.gen(function* () {
    const scope = yield* Scope.make()
    const status = yield* Scope.provide(scope)(installRequestMessages({ ctx, runtime: ctx.llm }))
    return { status, dispose: Scope.close(scope, Exit.void) }
  })
  return { ctx, adapter, payloads, install }
})

const drain = (stream: AsyncIterable<StreamChunk>) =>
  Effect.promise(async () => {
    for await (const _chunk of stream);
  })

const loopRequest = (): GenerateOptions => {
  const messages = [...history]
  Object.freeze(messages)
  return markAgentLoopRequest(
    Object.freeze({ provider: 'echo', model: 'echo-1', messages, toolHistory: { tools: [], updates: [] }, sessionId, signal: new AbortController().signal }),
  )
}

describe('agent/request-messages polyfill', () => {
  it.effect('sends the messages a listener returns for an agent-loop request', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, install } = yield* startHost
      yield* install
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(adapter.seen).toEqual([['second turn']])
      expect(payloads).toEqual([{ turn: 2, step: 1, isFirstStepOfTurn: true, messages: history }])
    }),
  )

  it.effect('leaves requests the agent loop did not build untouched', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, install } = yield* startHost
      yield* install
      yield* drain(ctx.llm.stream({ provider: 'echo', model: 'echo-1', messages: [...history], purpose: 'compaction' }))
      expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
      expect(payloads).toEqual([])
    }),
  )

  it.effect('sends derived messages when a request-messages listener fails', () =>
    Effect.gen(function* () {
      const { ctx, adapter, install } = yield* startHost
      ctx.on('agent/request-messages', () => {
        throw new Error('listener failed')
      })
      yield* install
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
    }),
  )

  it.effect('restores the runtime when the last copy unloads', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, install } = yield* startHost
      const installed = yield* install
      expect(installed.status).toEqual({ active: true })
      expect(Object.hasOwn(ctx.llm, 'adapterStream')).toBe(true)
      yield* installed.dispose
      expect(Object.hasOwn(ctx.llm, 'adapterStream')).toBe(false)
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
      expect(payloads).toEqual([])
    }),
  )

  it.effect('dispatches once when two copies are loaded', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, install } = yield* startHost
      const first = yield* install
      const second = yield* install
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(payloads).toHaveLength(1)
      yield* first.dispose
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(payloads).toHaveLength(2)
      expect(adapter.seen.at(-1)).toEqual(['second turn'])
      yield* second.dispose
      expect(Object.hasOwn(ctx.llm, 'adapterStream')).toBe(false)
    }),
  )
})

describe('the request-messages plugin', () => {
  it.effect('installs the polyfill for its lifetime and answers its status', () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        testHost => Effect.promise(() => testHost.dispose()),
      )
      const { adapter } = yield* Effect.promise(() => provideAgentHost(host.ctx))
      const mounted = yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/request-messages' }))
      expect(host.ctx.bail('request-messages/status')).toEqual({ active: true })
      yield* drain(host.ctx.llm.stream(loopRequest()))
      expect(adapter.seen).toEqual([['second turn']])

      yield* Effect.promise(() => mounted.dispose())
      expect(host.ctx.bail('request-messages/status')).toBeUndefined()
      expect(Object.hasOwn(host.ctx.llm, 'adapterStream')).toBe(false)
    }).pipe(Effect.scoped),
  )
})
