import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { type Context, Effect, type Exit } from 'effect'

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
    log: entry => input.ctx.logger(`dshx:${entry.topic}`)[entry.level](entry.message),
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
 */
export interface ActivationSlot<R> {
  readonly runtime: (signal: AbortSignal | undefined) => Promise<PluginRuntime<R>>
  readonly isActive: () => boolean
  readonly begin: () => void
  readonly activate: (runtime: PluginRuntime<R>) => void
  readonly fail: (error: Error) => void
  readonly stop: () => void
}

/** Refused because the plugin is not running: not activated yet, unloaded, or failed to activate. */
export class PluginInactive extends Error {
  override readonly name = 'PluginInactive'
}

export const makeActivationSlot = <R>(plugin: string): ActivationSlot<R> => {
  let state: SlotState<R> = { status: 'waiting', ready: Promise.withResolvers() }
  const waiting = (): PromiseWithResolvers<PluginRuntime<R>> => {
    if (state.status === 'waiting') return state.ready
    const ready = Promise.withResolvers<PluginRuntime<R>>()
    state = { status: 'waiting', ready }
    return ready
  }
  return {
    runtime: signal => {
      if (state.status === 'active') return Promise.resolve(state.runtime)
      if (state.status === 'failed') return Promise.reject(new PluginInactive(`${plugin} failed to activate.`, { cause: state.error }))
      if (state.status === 'stopped') return Promise.reject(new PluginInactive(`${plugin} is not running.`))
      if (signal === undefined) return state.ready.promise
      const ready = state.ready.promise
      return new Promise((resolve, reject) => {
        const abort = () => reject(new PluginInactive(`The call was aborted before ${plugin} finished activating.`, { cause: signal.reason }))
        if (signal.aborted) return abort()
        signal.addEventListener('abort', abort, { once: true })
        ready.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
      })
    },
    isActive: () => state.status === 'active',
    begin: () => {
      if (state.status === 'active') throw new PluginInactive(`${plugin} is already active in this process; unload it before activating it again.`)
      waiting()
    },
    activate: runtime => {
      const ready = waiting()
      state = { status: 'active', runtime }
      ready.resolve(runtime)
    },
    fail: error => {
      const ready = waiting()
      state = { status: 'failed', error }
      ready.promise.catch(() => undefined)
      ready.reject(error)
    },
    stop: () => {
      state = { status: 'stopped' }
    },
  }
}
