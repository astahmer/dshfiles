import type { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import {
  freezeMessage,
  isAgentLoopRequest,
  type LlmRuntime,
  markAgentLoopRequest,
  type GenerateOptions,
  type Message,
  type RequestMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Effect, Schema } from 'effect'
import type { RequestMessagesStatus } from './contract.ts'

/**
 * The runtime's opaque prepared-call handle: `adapterStream` receives it when the caller went through
 * `prepareCall`, and this plugin only forwards it untouched.
 */
interface PreparedCallHandle {
  readonly dispatch: (options: GenerateOptions) => AsyncIterable<StreamChunk>
}

type AdapterStream = (this: LlmRuntime, options: GenerateOptions, prepared?: PreparedCallHandle) => AsyncIterable<StreamChunk>

type EffectRunner = <Value, Failure>(effect: Effect.Effect<Value, Failure>) => Promise<Value>

/**
 * Shared by every loaded copy of this bundle, so the method is wrapped once and the
 * last copy to unload restores it.
 */
interface Installation {
  readonly ownDescriptor: PropertyDescriptor | undefined
  readonly hosts: Map<symbol, { readonly ctx: Context; readonly run: EffectRunner }>
}

const installationKey = Symbol.for('@dshfiles/request-messages/installation')

const isAdapterStream = (value: unknown): value is AdapterStream => typeof value === 'function'

const isInstallation = (value: unknown): value is Installation => typeof value === 'object' && value !== null && 'hosts' in value && value.hosts instanceof Map

const isMessage = (message: RequestMessage): message is Message => message.id !== undefined

class RequestMessagesListenerFailure extends Schema.TaggedError<RequestMessagesListenerFailure>()('RequestMessagesListenerFailure', {
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

const requestOptions = Effect.fn('request messages dispatch')((ctx: Context, options: GenerateOptions) =>
  Effect.gen(function* () {
    if (!isAgentLoopRequest(options) || options.sessionId === undefined || options.toolHistory === undefined) return options
    const toolHistory = options.toolHistory
    const agent = ctx.agents.get(options.sessionId)
    if (agent === undefined) return options
    const messages = options.messages
    if (!messages.every(isMessage)) return options
    const stepStart = agent.session.snapshotEvents().findLast(event => event.type === 'step/start')
    if (stepStart?.type !== 'step/start') return options
    const signal = options.signal ?? new AbortController().signal
    const sent = yield* Effect.tryPromise({
      try: () =>
        agentEvents(ctx, agent).waterfall(
          'agent/request-messages',
          {
            turn: stepStart.data.turn,
            step: stepStart.data.step,
            isFirstStepOfTurn: stepStart.data.step === 1,
            messages,
            toolHistory,
            signal,
          },
          () => Promise.resolve(messages),
        ),
      catch: cause => new RequestMessagesListenerFailure({ message: cause instanceof Error ? cause.message : String(cause), cause }),
    }).pipe(
      Effect.catch(error => {
        if (signal.aborted) return Effect.fail(error)
        ctx.logger('request-messages').warn('an agent/request-messages listener failed; sending the derived messages: %s', error.message)
        return Effect.succeed(messages)
      }),
    )
    if (sent === messages) return options
    const frozen = sent.map(message => (Object.isFrozen(message) ? message : freezeMessage(message)))
    Object.freeze(frozen)
    return markAgentLoopRequest(Object.freeze({ ...options, messages: frozen }))
  }),
)

const release = (runtime: LlmRuntime, installation: Installation, token: symbol): void => {
  installation.hosts.delete(token)
  if (installation.hosts.size > 0) return
  if (installation.ownDescriptor === undefined) Reflect.deleteProperty(runtime, 'adapterStream')
  else Reflect.defineProperty(runtime, 'adapterStream', installation.ownDescriptor)
  Reflect.deleteProperty(runtime, installationKey)
}

/**
 * Dispatch `agent/request-messages` for every agent-loop model request on stock DSH.
 *
 * Listeners of the public `llm/stream` waterfall cannot change its options, but its innermost
 * callback re-reads `adapterStream` from the runtime for each call and hands it the same options,
 * so wrapping that method is the one place a request's messages can still be swapped after the
 * waterfall and before projection and dispatch. Requests the agent loop did not build (summaries,
 * titles, compaction) pass through untouched.
 */
export const installRequestMessages = Effect.fn('request messages install')((ctx: Context, runtime: LlmRuntime, run: EffectRunner) =>
  Effect.gen(function* () {
    const token = Symbol('request-messages host')
    const existing = installationKey in runtime ? runtime[installationKey] : undefined
    if (isInstallation(existing)) {
      existing.hosts.set(token, { ctx, run })
      yield* Effect.addFinalizer(() => Effect.sync(() => release(runtime, existing, token)))
      return { active: true } satisfies RequestMessagesStatus
    }
    const original: unknown = runtime['adapterStream']
    if (!isAdapterStream(original))
      return {
        active: false,
        reason: 'this DSH llm runtime has no adapterStream method, so agent/request-messages cannot be dispatched',
      } satisfies RequestMessagesStatus
    const installation: Installation = {
      ownDescriptor: Reflect.getOwnPropertyDescriptor(runtime, 'adapterStream'),
      hosts: new Map([[token, { ctx, run }]]),
    }
    const wrapped: AdapterStream = async function* (this: LlmRuntime, options, prepared) {
      const host = installation.hosts.values().next().value
      const sent = host === undefined ? options : await host.run(requestOptions(host.ctx, options))
      yield* original.call(this, sent, prepared)
    }
    yield* Effect.addFinalizer(() => Effect.sync(() => release(runtime, installation, token)))
    Reflect.defineProperty(runtime, 'adapterStream', { value: wrapped, configurable: true, writable: true })
    Reflect.defineProperty(runtime, installationKey, { value: installation, configurable: true })
    return { active: true } satisfies RequestMessagesStatus
  }),
)
