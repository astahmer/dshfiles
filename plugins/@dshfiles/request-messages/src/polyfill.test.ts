import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, createUserMessage, markAgentLoopRequest, type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Scope } from 'effect'
import type { RequestMessagesPayload } from './contract.ts'
import plugin from './host.ts'
import { installRequestMessages } from './polyfill.ts'
import { requestMessagesStepProjectionDefinition } from './step-projection.ts'

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

const seeded = (steps: readonly { readonly turn: number; readonly step: number }[], openTurn?: number): readonly SessionEvent[] => {
  const source = Session.create(SessionId('seed-source'))
  const events = steps.flatMap(step => [source.append('turn/start', { turn: step.turn }), source.append('step/start', step)])
  return openTurn === undefined ? events : [...events, source.append('turn/start', { turn: openTurn })]
}

const appendStep = (session: Session, step: { readonly turn: number; readonly step: number }): void => {
  session.append('turn/start', { turn: step.turn })
  session.append('step/start', step)
}

const provideAgentHost = async (ctx: Context, input: { readonly seed?: readonly SessionEvent[]; readonly fork?: true } = {}) => {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const adapter = new EchoAdapter()
  ctx.llm.registerAdapter(['echo'], adapter)
  const seed = input.seed ?? []
  const options =
    input.fork === true ? { seed, inheritedEventCount: SessionLogOffset(seed.length), meta: { isSeeded: true } } : input.seed === undefined ? {} : { seed }
  const session = ctx.sessions.create(sessionId, options)
  const agent = { id: sessionId, session }
  ctx.provide('agents')
  ctx.set('agents', { get: (id: string) => (id === sessionId ? agent : undefined) })
  const payloads: Omit<RequestMessagesPayload, 'agent' | 'signal' | 'toolHistory'>[] = []
  ctx.on('agent/request-messages', async (payload, next) => {
    payloads.push({ turn: payload.turn, step: payload.step, isFirstStepOfTurn: payload.isFirstStepOfTurn, messages: payload.messages })
    return (await next()).slice(-1)
  })
  return { adapter, payloads, session }
}

const startHost = (input: { readonly seed?: readonly SessionEvent[]; readonly fork?: true } = {}) =>
  Effect.gen(function* () {
    const ctx = new Context()
    const host = yield* Effect.promise(() => provideAgentHost(ctx, input))
    const install = Effect.gen(function* () {
      const scope = yield* Scope.make()
      const status = yield* Scope.provide(scope)(installRequestMessages({ ctx, runtime: ctx.llm }))
      return { status, dispose: Scope.close(scope, Exit.void) }
    })
    return { ctx, ...host, install }
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

describe('the latest step projection', () => {
  it('folds the latest step/start payload and keeps the state reference for other events', () => {
    const session = Session.create(SessionId('fold'))
    const turnStart = session.append('turn/start', { turn: 1 })
    const firstStep = session.append('step/start', { turn: 1, step: 1 })
    const secondStep = session.append('step/start', { turn: 1, step: 2 })
    const stepEnd = session.append('step/end', { turn: 1, step: 2 })
    const folded = [turnStart, firstStep, secondStep, stepEnd].reduce(
      requestMessagesStepProjectionDefinition.apply,
      requestMessagesStepProjectionDefinition.init(),
    )
    expect(folded).toEqual({ turn: 1, step: 2 })
    expect(requestMessagesStepProjectionDefinition.apply(folded, stepEnd)).toBe(folded)
  })
})

describe('agent/request-messages polyfill', () => {
  it.effect('sends the messages a listener returns for an agent-loop request', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, session, install } = yield* startHost()
      yield* install
      appendStep(session, { turn: 2, step: 1 })
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(adapter.seen).toEqual([['second turn']])
      expect(payloads).toEqual([{ turn: 2, step: 1, isFirstStepOfTurn: true, messages: history }])
    }),
  )

  it.effect('leaves requests the agent loop did not build untouched', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, session, install } = yield* startHost()
      yield* install
      appendStep(session, { turn: 1, step: 1 })
      yield* drain(ctx.llm.stream({ provider: 'echo', model: 'echo-1', messages: [...history], purpose: 'compaction' }))
      expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
      expect(payloads).toEqual([])
    }),
  )

  it.effect('sends derived messages when a request-messages listener fails', () =>
    Effect.gen(function* () {
      const { ctx, adapter, session, install } = yield* startHost()
      ctx.on('agent/request-messages', () => {
        throw new Error('listener failed')
      })
      yield* install
      appendStep(session, { turn: 1, step: 1 })
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
    }),
  )

  it.effect('restores the runtime when the last copy unloads', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, session, install } = yield* startHost()
      const installed = yield* install
      appendStep(session, { turn: 1, step: 1 })
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
      const { ctx, adapter, payloads, session, install } = yield* startHost()
      const first = yield* install
      const second = yield* install
      appendStep(session, { turn: 2, step: 1 })
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

  it.effect('reads the step of a restored session whose history predates the installation', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, session, install } = yield* startHost({
        seed: seeded([
          { turn: 1, step: 1 },
          { turn: 2, step: 1 },
          { turn: 2, step: 2 },
        ]),
      })
      yield* install
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(payloads).toEqual([{ turn: 2, step: 2, isFirstStepOfTurn: false, messages: history }])
      appendStep(session, { turn: 2, step: 3 })
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(adapter.seen).toHaveLength(2)
      expect(payloads.at(-1)).toEqual({ turn: 2, step: 3, isFirstStepOfTurn: false, messages: history })
    }),
  )

  it.effect('reads the step inherited by a forked session', () =>
    Effect.gen(function* () {
      const seed = seeded([
        { turn: 1, step: 1 },
        { turn: 2, step: 1 },
      ])
      const { ctx, payloads, session, install } = yield* startHost({ seed, fork: true })
      yield* install
      expect(session.inheritedEventCount).toBe(seed.length)
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(payloads).toEqual([{ turn: 2, step: 1, isFirstStepOfTurn: true, messages: history }])
    }),
  )

  it.effect('reports the latest step own turn, not the turn the session is between', () =>
    Effect.gen(function* () {
      const seed = seeded(
        [
          { turn: 2, step: 1 },
          { turn: 2, step: 2 },
        ],
        3,
      )
      const { ctx, payloads, install } = yield* startHost({ seed })
      yield* install
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(payloads).toEqual([{ turn: 2, step: 2, isFirstStepOfTurn: false, messages: history }])
    }),
  )

  it.effect('keeps the projection until the last copy unloads', () =>
    Effect.gen(function* () {
      const { ctx, adapter, payloads, session, install } = yield* startHost()
      const first = yield* install
      const second = yield* install
      appendStep(session, { turn: 1, step: 1 })
      const stepOf = () => ctx.sessionProjections.stateOf(session, requestMessagesStepProjectionDefinition.key)
      expect(stepOf()).toEqual({ turn: 1, step: 1 })
      yield* first.dispose
      expect(stepOf()).toEqual({ turn: 1, step: 1 })
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(payloads).toHaveLength(1)
      yield* second.dispose
      expect(stepOf()).toBeUndefined()
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(payloads).toHaveLength(1)
      expect(adapter.seen.at(-1)).toEqual(['first turn', 'first answer', 'second turn'])
    }),
  )

  it.effect('reports an inactive status when the session projection registry is absent', () =>
    Effect.gen(function* () {
      const ctx = new Context()
      const adapter = new EchoAdapter()
      yield* Effect.promise(async () => {
        await ctx.plugin(LlmRuntime)
        ctx.llm.registerAdapter(['echo'], adapter)
        const session = Session.create(sessionId)
        session.append('step/start', { turn: 1, step: 1 })
        ctx.provide('agents')
        ctx.set('agents', { get: (id: string) => (id === sessionId ? { id: sessionId, session } : undefined) })
      })
      const scope = yield* Scope.make()
      const status = yield* Scope.provide(scope)(installRequestMessages({ ctx, runtime: ctx.llm }))
      expect(status.active).toBe(false)
      expect(status.active ? '' : status.reason).toContain('no session projection registry')
      yield* drain(ctx.llm.stream(loopRequest()))
      expect(adapter.seen).toEqual([['first turn', 'first answer', 'second turn']])
      yield* Scope.close(scope, Exit.void)
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
      const { adapter, session } = yield* Effect.promise(() => provideAgentHost(host.ctx))
      appendStep(session, { turn: 2, step: 1 })
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
