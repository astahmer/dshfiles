import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { type Context, Effect, type Exit } from 'effect'
import { ApiProtocolModel } from '../api/common.js'
import { cordisLogger } from './host-context.js'

/** How the edge runs one effect inside an active plugin: its built services, the call's signal as interruption. */
export interface PluginRuntime<R> {
  readonly run: <A, E>(effect: Effect.Effect<A, E, R>, options?: { readonly signal?: AbortSignal | undefined }) => Promise<Exit.Exit<A, E>>
  /** Write one line to the Host log under `dshx:<topic>`. */
  readonly log: (input: { readonly topic: string; readonly level: 'warn' | 'error'; readonly message: string }) => void
}

/** A runtime over services already built (an active plugin, or the context captured by a scoped registration). */
export const runtimeOf = <R>(input: { readonly services: Context.Context<R>; readonly ctx: CordisContext }): PluginRuntime<R> => {
  const runWith = Effect.runPromiseExitWith(input.services)
  return {
    run: (effect, options) => runWith(effect, options?.signal === undefined ? undefined : { signal: options.signal }),
    log: entry => cordisLogger(input.ctx, `dshx:${entry.topic}`)[entry.level](entry.message),
  }
}

type SlotState<R> =
  | { readonly status: 'waiting'; readonly ready: PromiseWithResolvers<PluginRuntime<R>> }
  | { readonly status: 'active'; readonly runtime: PluginRuntime<R> }
  | { readonly status: 'failed'; readonly error: Error }
  | { readonly status: 'stopped' }

/**
 * The one activation of a plugin definition. Contract handlers and static tools are registered before `setup`
 * runs, so a call that arrives early waits for the layer (or its own abort); a call after unload is refused.
 * A lazy definition `defer`s activation instead: the first API or tool call runs the build, and every call that
 * arrives while it runs waits for that same build.
 */
export interface ActivationSlot<R> {
  readonly runtime: (signal: AbortSignal | undefined) => Promise<PluginRuntime<R>>
  readonly isActive: () => boolean
  readonly begin: () => void
  /** Defer activation to the first call; `start` runs at most once and must `activate` or `fail` this slot. */
  readonly defer: (start: () => Promise<void>) => void
  readonly activate: (runtime: PluginRuntime<R>) => void
  readonly fail: (error: Error) => void
  readonly stop: () => void
}

/** Refused because the plugin is not running: not activated yet, unloaded, or failed to activate. */
export class PluginInactive extends Error {
  override readonly name = 'PluginInactive'
}

/** The wire code a Client sees when this plugin was not running; `ApiProtocolModel.error` would report it as internal. */
export const PLUGIN_INACTIVE_CODE = 'plugin-inactive'

/**
 * A call to a plugin that is not running. The Host API dispatch serializes an ApiError by its `remoteCode` and calls an
 * uncoded one `internal`, so name it: a Client can stop polling instead of reporting a handler failure.
 */
export const inactiveError = (input: { readonly cause: PluginInactive; readonly apiId: string; readonly method: string }) =>
  ApiProtocolModel.error('unavailable', input.cause.message, input.apiId, input.method, false, input.cause, PLUGIN_INACTIVE_CODE)

export const makeActivationSlot = <R>(plugin: string): ActivationSlot<R> => {
  let state: SlotState<R> = { status: 'waiting', ready: Promise.withResolvers() }
  let deferred: (() => Promise<void>) | undefined
  let started: Promise<void> | undefined

  const fail = (error: Error) => {
    if (state.status !== 'waiting') return
    const ready = state.ready
    state = { status: 'failed', error }
    ready.promise.catch(() => undefined)
    ready.reject(new PluginInactive(`${plugin} failed to activate.`, { cause: error }))
  }

  const activate = (runtime: PluginRuntime<R>) => {
    if (state.status !== 'waiting') return
    const ready = state.ready
    state = { status: 'active', runtime }
    ready.resolve(runtime)
  }

  /** The first call starts the deferred activation once; a start that throws instead of failing the slot still releases it. */
  const startOnce = () => {
    if (started !== undefined || deferred === undefined) return
    const start = deferred
    started = Promise.resolve()
      .then(start)
      .then(
        () => undefined,
        (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
      )
  }

  return {
    runtime: signal => {
      if (state.status === 'active') return Promise.resolve(state.runtime)
      if (state.status === 'failed') return Promise.reject(new PluginInactive(`${plugin} failed to activate.`, { cause: state.error }))
      if (state.status === 'stopped') return Promise.reject(new PluginInactive(`${plugin} is not running.`))
      if (signal?.aborted === true)
        return Promise.reject(new PluginInactive(`The call was aborted before ${plugin} finished activating.`, { cause: signal.reason }))
      const ready = state.ready.promise
      startOnce()
      if (signal === undefined) return ready
      return new Promise((resolve, reject) => {
        const abort = () => reject(new PluginInactive(`The call was aborted before ${plugin} finished activating.`, { cause: signal.reason }))
        signal.addEventListener('abort', abort, { once: true })
        ready.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
    },
    isActive: () => state.status === 'active',
    begin: () => {
      if (state.status === 'active') throw new PluginInactive(`${plugin} is already active in this process; unload it before activating it again.`)
      if (state.status !== 'waiting') state = { status: 'waiting', ready: Promise.withResolvers() }
      deferred = undefined
      started = undefined
    },
    defer: start => {
      deferred = start
      started = undefined
    },
    activate,
    fail,
    stop: () => {
      deferred = undefined
      started = undefined
      if (state.status === 'stopped') return
      const ready = state.status === 'waiting' ? state.ready : undefined
      state = { status: 'stopped' }
      if (ready === undefined) return
      ready.promise.catch(() => undefined)
      ready.reject(new PluginInactive(`${plugin} is not running.`))
    },
  }
}
