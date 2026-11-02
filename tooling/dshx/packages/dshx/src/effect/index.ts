import type { Context } from '@deepseek-ai/cordis'
import { Cause, Effect, Exit, Layer, ManagedRuntime, Queue, Schema, Scope, Stream } from 'effect'
import { effectClient } from './client.js'
import { provideDshxTracer, tracerLayer } from './tracer.js'
import { ApiClientEventsModel } from '../api/client-events.js'
import { thrownForApi } from './wire-error.js'
import { HostApiEventsModel } from '../api/host-events.js'
import type {
  AnyApiEventDefinition,
  AnyApiMethodDefinition,
  ApiClient,
  ApiContract,
  ApiEventClientPayload,
  ApiEventHostPayload,
  ApiHandlerContext,
  ApiHostInput,
  ApiHostOutput,
  ApiHostRegistration,
} from '../api/types.js'

export * as DshxPlugin from './plugin.js'
export * as Api from './api.js'
export * as Tool from './tool.js'
export * as HostEvents from './events.js'
export { HostContext, HostServiceMissing, hostService } from './host-context.js'
export type { WireFailure } from './wire-error.js'

/** A failed dshx API call, with the same fields as the thrown `ApiError` so it can be matched by `_tag` and `kind`. */
export { ApiCallError } from './client.js'
export type { EffectApiClient } from './client.js'

/** The Host refused to publish an event: the contract declares no such event, its payload failed the schema, or the API is not served. */
export class PublishEventError extends Schema.TaggedError<PublishEventError>()('PublishEventError', {
  message: Schema.String,
  apiId: Schema.String,
  event: Schema.String,
}) {}

type EffectHandlers<Methods extends Record<string, AnyApiMethodDefinition>, R, E> = {
  readonly [K in keyof Methods]: (context: ApiHandlerContext<ApiHostInput<Methods[K]>>) => Effect.Effect<ApiHostOutput<Methods[K]>, E, R>
}

type HostOptions<R> = [R] extends [never]
  ? [options?: { readonly runtime?: ManagedRuntime.ManagedRuntime<R, unknown> }]
  : [options: { readonly runtime: ManagedRuntime.ManagedRuntime<R, unknown> }]

type AnyManagedRuntime = ManagedRuntime.ManagedRuntime<never, unknown>
const pluginRuntimes = new WeakMap<Context, AnyManagedRuntime>()

const settle = <A, E>(exit: Exit.Exit<A, E>, call: { readonly ctx: Context; readonly apiId: string; readonly method: string }): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw thrownForApi({ cause: exit.cause, apiId: call.apiId, method: call.method, warn: message => call.ctx.logger('dshx:api').warn(message) })
}

/** Serve a contract from handlers that return Effects; the call's AbortSignal interrupts the handler fiber. */
const registerEffectHost = <const Methods extends Record<string, AnyApiMethodDefinition>, R, E>(
  contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
  handlers: EffectHandlers<Methods, R, E>,
  runtimeForContext: (ctx: Context) => AnyManagedRuntime | undefined,
  requirePluginRuntime: boolean,
): ApiHostRegistration<Methods> => {
  const run = (effect: Effect.Effect<unknown, unknown, R>, signal: AbortSignal, ctx: Context) => {
    const runtime = runtimeForContext(ctx)
    if (runtime === undefined) {
      if (requirePluginRuntime) throw new Error('DshxEffect.plugin runtime is not active for this Host context.')
      // SAFETY: the public host helper allows a missing runtime only when R is never.
      return Effect.runPromiseExit(provideDshxTracer(effect as Effect.Effect<unknown, unknown>), { signal })
    }
    // SAFETY: explicit runtimes and DshxEffect.plugin runtimes provide the handler's declared environment.
    return runtime.runPromiseExit(effect as Effect.Effect<unknown, unknown>, { signal })
  }
  const promised = Object.fromEntries(
    Object.entries<(context: ApiHandlerContext<never>) => Effect.Effect<unknown, unknown, R>>(handlers).map(([name, handler]) => [
      name,
      async (context: ApiHandlerContext<never>) =>
        settle(await run(handler(context), context.signal, context.ctx), {
          ctx: context.ctx,
          apiId: contract.id,
          method: name,
        }),
    ]),
  )
  // SAFETY: every method key of `handlers` (typed against the contract's methods) maps to a Promise handler of the same input and output.
  return contract.host(promised as Parameters<ApiContract<Methods>['host']>[0])
}

const host = <const Methods extends Record<string, AnyApiMethodDefinition>, E, R = never>(
  contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
  handlers: EffectHandlers<Methods, R, E>,
  ...[options]: HostOptions<R>
): ApiHostRegistration<Methods> =>
  registerEffectHost(
    contract,
    handlers,
    ctx => {
      // SAFETY: explicit runtimes match R; context runtimes are created by DshxEffect.plugin for the same plugin instance.
      return (options?.runtime as AnyManagedRuntime | undefined) ?? pluginRuntimes.get(ctx)
    },
    false,
  )

/**
 * A Host `setup` whose plugin lifetime is an Effect Scope: resources acquired with `Effect.acquireRelease`,
 * finalizers and fibers forked with `Effect.forkScoped` live until the plugin unloads or reloads.
 */
const setup =
  <Config, E>(program: (ctx: Context, config: Config) => Effect.Effect<void, E, Scope.Scope>) =>
  async (ctx: Context, config: Config): Promise<() => Promise<void>> => {
    const scope = Effect.runSync(Scope.make())
    const started = await Effect.runPromiseExit(provideDshxTracer(Scope.provide(scope)(program(ctx, config))))
    if (Exit.isFailure(started)) {
      await Effect.runPromise(Scope.close(scope, started))
      throw Cause.squash(started.cause)
    }
    return () => Effect.runPromise(Scope.close(scope, Exit.void))
  }

const plugin = <Config, E, R>(options: {
  readonly layer: Layer.Layer<R, E, never> | ((ctx: Context, config: Config) => Layer.Layer<R, E, never>)
  readonly setup: (ctx: Context, config: Config) => Effect.Effect<void, E, R | Scope.Scope>
}) => ({
  hostApi: <const Methods extends Record<string, AnyApiMethodDefinition>, HandlerError>(
    contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
    handlers: EffectHandlers<Methods, R, HandlerError>,
  ): ApiHostRegistration<Methods> => registerEffectHost(contract, handlers, ctx => pluginRuntimes.get(ctx), true),
  setup: async (ctx: Context, config: Config): Promise<() => Promise<void>> => {
    const layer = typeof options.layer === 'function' ? options.layer(ctx, config) : options.layer
    const runtime = ManagedRuntime.make(Layer.merge(layer, tracerLayer))
    const scope = Effect.runSync(Scope.make())
    // SAFETY: the runtime is stored only for runtime lookup; the handler adapter supplies its effect environment at execution.
    pluginRuntimes.set(ctx, runtime as AnyManagedRuntime)
    const started = await runtime.runPromiseExit(Scope.provide(scope)(options.setup(ctx, config)))
    if (Exit.isFailure(started)) {
      pluginRuntimes.delete(ctx)
      await runtime.runPromise(Scope.close(scope, started))
      await runtime.dispose()
      throw Cause.squash(started.cause)
    }
    return async () => {
      pluginRuntimes.delete(ctx)
      try {
        await runtime.runPromise(Scope.close(scope, Exit.void))
      } finally {
        await runtime.dispose()
      }
    }
  },
})

/** A browser Stream of one API event; the subscription opens on first pull and closes when the Stream ends or is interrupted. */
const events = <
  const Methods extends Record<string, AnyApiMethodDefinition>,
  const Events extends Record<string, AnyApiEventDefinition>,
  K extends keyof Events & string,
>(
  api: ApiClient<Methods, Events>,
  event: K,
): Stream.Stream<ApiEventClientPayload<Events[K]>> =>
  Stream.callback<ApiEventClientPayload<Events[K]>>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => ApiClientEventsModel.subscribe(api, event, { onEvent: payload => Queue.offerUnsafe(queue, payload) })),
      unsubscribe => Effect.sync(unsubscribe),
    ),
  )

/** Publish one event from the Host; pipe a Stream through `Stream.runForEach(stream, payload => publish(...))`. */
const publish = <const Events extends Record<string, AnyApiEventDefinition>, K extends keyof Events & string>(
  ctx: Context,
  contract: ApiContract<Record<string, AnyApiMethodDefinition>, Events>,
  event: K,
  payload: ApiEventHostPayload<Events[K]>,
): Effect.Effect<void, PublishEventError> =>
  Effect.tryPromise({
    try: () => HostApiEventsModel.publish(ctx, contract, event, payload),
    catch: error => new PublishEventError({ message: error instanceof Error ? error.message : String(error), apiId: contract.id, event }),
  })

/**
 * Effect-native authoring on top of the Promise API: handlers, setup, clients and events speak Effect, and the
 * plugin still registers through `defineHost` / `definePlugin`. Opt in by importing `@dshfiles/dshx/effect`.
 */
export class DshxEffect {
  static readonly host = host
  static readonly setup = setup
  static readonly plugin = plugin
  static readonly client = effectClient
  static readonly events = events
  static readonly publish = publish
  static readonly tracerLayer = tracerLayer
}
