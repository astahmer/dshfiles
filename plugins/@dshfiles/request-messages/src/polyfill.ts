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
import type { RequestMessagesStatus } from './contract.ts'

type AdapterStream = (this: unknown, options: GenerateOptions, prepared?: unknown) => AsyncIterable<StreamChunk>

/**
 * Shared by every loaded copy of this bundle, so the method is wrapped once and the
 * last copy to unload restores it.
 */
interface Installation {
  readonly ownDescriptor: PropertyDescriptor | undefined
  readonly hosts: Map<symbol, Context>
}

const installationKey = Symbol.for('@dshfiles/request-messages/installation')

const isAdapterStream = (value: unknown): value is AdapterStream => typeof value === 'function'

const isInstallation = (value: unknown): value is Installation => typeof value === 'object' && value !== null && 'hosts' in value && value.hosts instanceof Map

const isMessage = (message: RequestMessage): message is Message => message.id !== undefined

const requestOptions = async (ctx: Context, options: GenerateOptions): Promise<GenerateOptions> => {
  if (!isAgentLoopRequest(options) || options.sessionId === undefined || options.toolHistory === undefined) return options
  const agent = ctx.agents.get(options.sessionId)
  if (agent === undefined) return options
  const messages = options.messages
  if (!messages.every(isMessage)) return options
  const stepStart = agent.session.snapshotEvents().findLast(event => event.type === 'step/start')
  if (stepStart?.type !== 'step/start') return options
  const signal = options.signal ?? new AbortController().signal
  try {
    const sent = await agentEvents(ctx, agent).waterfall(
      'agent/request-messages',
      {
        turn: stepStart.data.turn,
        step: stepStart.data.step,
        isFirstStepOfTurn: stepStart.data.step === 1,
        messages,
        toolHistory: options.toolHistory,
        signal,
      },
      () => Promise.resolve(messages),
    )
    if (sent === messages) return options
    const frozen = sent.map(message => (Object.isFrozen(message) ? message : freezeMessage(message)))
    Object.freeze(frozen)
    return markAgentLoopRequest(Object.freeze({ ...options, messages: frozen }))
  } catch (error) {
    if (signal.aborted) throw error
    ctx
      .logger('request-messages')
      .warn('an agent/request-messages listener failed; sending the derived messages: %s', error instanceof Error ? error.message : String(error))
    return options
  }
}

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
export const installRequestMessages = (ctx: Context): RequestMessagesStatus => {
  // Cordis hands out a tracing proxy without define, delete or `in` traps, so those land on the instance the waterfall calls.
  const runtime = ctx.llm
  const token = Symbol('request-messages host')
  const existing = installationKey in runtime ? runtime[installationKey] : undefined
  if (isInstallation(existing)) {
    ctx.effect(() => {
      existing.hosts.set(token, ctx)
      return () => release(runtime, existing, token)
    }, 'request-messages host')
    return { active: true }
  }
  const original: unknown = runtime['adapterStream']
  if (!isAdapterStream(original))
    return { active: false, reason: 'this DSH llm runtime has no adapterStream method, so agent/request-messages cannot be dispatched' }
  const installation: Installation = { ownDescriptor: Reflect.getOwnPropertyDescriptor(runtime, 'adapterStream'), hosts: new Map([[token, ctx]]) }
  const wrapped: AdapterStream = async function* (this: unknown, options, prepared) {
    const host = installation.hosts.values().next().value
    const sent = host === undefined ? options : await requestOptions(host, options)
    yield* original.call(this, sent, prepared)
  }
  ctx.effect(() => {
    Reflect.defineProperty(runtime, 'adapterStream', { value: wrapped, configurable: true, writable: true })
    Reflect.defineProperty(runtime, installationKey, { value: installation, configurable: true })
    return () => release(runtime, installation, token)
  }, 'request-messages adapterStream wrap')
  return { active: true }
}
