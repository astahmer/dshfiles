/* oxlint-disable antislop/no-export-bag -- the deprecated DshxEffect namespace is a Cordis edge kept for existing callers; delete it when they reach 0. */
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Cause, Context, Effect, Exit, Layer, type ManagedRuntime, Option, Queue, Scope, Stream } from 'effect'
import { ApiProtocolModel } from '../api/common.js'
import { ApiClientEventsModel } from '../api/client-events.js'
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
import { PublishEventError } from './api.js'
import { effectClient } from './client.js'
import { PluginActivationError } from './plugin.js'
import { inactiveError, makeActivationSlot, PluginInactive, type PluginRuntime, runtimeOf } from './plugin-runtime.js'
import { processEnvConfig } from './process-env-config.js'
import { tracerLayer } from './tracer.js'
import { thrownForApi } from './wire-error.js'

type EffectHandlers<Methods extends Record<string, AnyApiMethodDefinition>, R, E> = {
  readonly [K in keyof Methods]: (context: ApiHandlerContext<ApiHostInput<Methods[K]>>) => Effect.Effect<ApiHostOutput<Methods[K]>, E, R>
}

type HostOptions<R> = [R] extends [never]
  ? [options?: { readonly runtime?: ManagedRuntime.ManagedRuntime<R, unknown> }]
  : [options: { readonly runtime: ManagedRuntime.ManagedRuntime<R, unknown> }]

const edgeLayer = Layer.merge(tracerLayer, processEnvConfig)

const tracerServices = Effect.runSync(Effect.scoped(Layer.build(edgeLayer)))

const legacyRegistration = <const Methods extends Record<string, AnyApiMethodDefinition>, R, E>(
  contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
  handlers: EffectHandlers<Methods, R, E>,
  runtimeFor: (input: { readonly signal: AbortSignal; readonly ctx: CordisContext }) => Promise<PluginRuntime<R>>,
): ApiHostRegistration<Methods> => {
  const promised: Record<string, (context: ApiHandlerContext<never>) => Promise<unknown>> = {}
  for (const [method, handler] of Object.entries<(context: ApiHandlerContext<never>) => Effect.Effect<unknown, unknown, R>>(handlers)) {
    promised[method] = async context => {
      const runtime = await runtimeFor({ signal: context.signal, ctx: context.ctx }).catch((cause: unknown) => {
        if (cause instanceof PluginInactive) throw inactiveError({ cause, apiId: contract.id, method })
        throw cause
      })
      const exit = await runtime.run(handler(context), { signal: context.signal })
      if (Exit.isSuccess(exit)) return exit.value
      throw thrownForApi({ cause: exit.cause, apiId: contract.id, method, warn: message => runtime.log({ topic: 'api', level: 'warn', message }) })
    }
  }
  // SAFETY: every contract method is mapped above to a Promise handler of the same input and output.
  return contract.host(promised as Parameters<ApiContract<Methods>['host']>[0])
}

/**
 * Serve a contract from handlers that return Effects; the call's AbortSignal interrupts the handler fiber.
 * @deprecated Use `DshxPlugin.make({ apis: [Api.bind(contract, handlers)] })`.
 */
export const host = <const Methods extends Record<string, AnyApiMethodDefinition>, E, R = never>(
  contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
  handlers: EffectHandlers<Methods, R, E>,
  ...[options]: HostOptions<R>
): ApiHostRegistration<Methods> =>
  legacyRegistration(contract, handlers, async ({ ctx }) => {
    const runtime = options?.runtime
    if (runtime === undefined) {
      // SAFETY: without a runtime HostOptions forces R to never, so the dshx tracer alone is the handler environment.
      return runtimeOf({ services: tracerServices as Context.Context<R>, ctx })
    }
    return runtimeOf({ services: await runtime.context(), ctx })
  })

/** The thrown value of a failed deprecated setup: its first typed failure, as before, or the activation error. */
const setupFailure = (input: { readonly plugin: string; readonly cause: Cause.Cause<unknown> }): unknown =>
  Option.getOrElse(Cause.findErrorOption(input.cause), () => new PluginActivationError({ plugin: input.plugin, cause: input.cause }))

/**
 * A Host `setup` whose plugin lifetime is an Effect Scope: resources acquired with `Effect.acquireRelease`,
 * finalizers and fibers forked with `Effect.forkScoped` live until the plugin unloads or reloads.
 * @deprecated Use `DshxPlugin.make({ layer, main })`.
 */
export const setup =
  <Config, E>(program: (ctx: CordisContext, config: Config) => Effect.Effect<void, E, Scope.Scope>) =>
  async (ctx: CordisContext, config: Config): Promise<() => Promise<void>> => {
    const scope = Scope.makeUnsafe()
    const run = Effect.runPromiseExitWith(tracerServices)
    const started = await run(Scope.provide(scope)(program(ctx, config)))
    if (Exit.isFailure(started)) {
      await run(Scope.close(scope, started))
      throw setupFailure({ plugin: 'DshxEffect.setup', cause: started.cause })
    }
    return async () => {
      await run(Scope.close(scope, Exit.void))
    }
  }

/**
 * One layered runtime for the plugin lifetime and its Host handlers.
 * @deprecated Use `DshxPlugin.make({ layer, main, apis: [Api.bind(contract, handlers)] })`.
 */
export const plugin = <Config, E, R>(options: {
  readonly layer: Layer.Layer<R, E, never> | ((ctx: CordisContext, config: Config) => Layer.Layer<R, E, never>)
  readonly setup: (ctx: CordisContext, config: Config) => Effect.Effect<void, E, R | Scope.Scope>
}) => {
  const slot = makeActivationSlot<R | Scope.Scope>('DshxEffect.plugin')
  return {
    hostApi: <const Methods extends Record<string, AnyApiMethodDefinition>, HandlerError>(
      contract: ApiContract<Methods, Record<string, AnyApiEventDefinition>>,
      handlers: EffectHandlers<Methods, R, HandlerError>,
    ): ApiHostRegistration<Methods> => legacyRegistration(contract, handlers, ({ signal }) => slot.runtime(signal)),
    setup: async (ctx: CordisContext, config: Config): Promise<() => Promise<void>> => {
      slot.begin()
      const scope = Scope.makeUnsafe()
      const layer = typeof options.layer === 'function' ? options.layer(ctx, config) : options.layer
      const program = Effect.gen(function* () {
        const built = yield* Layer.buildWithScope(Layer.provideMerge(layer, edgeLayer), scope)
        const services = Context.add(built, Scope.Scope, scope)
        yield* Effect.provideContext(options.setup(ctx, config), services)
        return services
      })
      const started = await Effect.runPromiseExitWith(tracerServices)(program)
      if (Exit.isFailure(started)) {
        await Effect.runPromise(Scope.close(scope, started))
        const failure = setupFailure({ plugin: 'DshxEffect.plugin', cause: started.cause })
        slot.fail(failure instanceof Error ? failure : new PluginActivationError({ plugin: 'DshxEffect.plugin', cause: started.cause }))
        throw failure
      }
      slot.activate(runtimeOf({ services: started.value, ctx }))
      return async () => {
        slot.stop()
        await Effect.runPromise(Scope.close(scope, Exit.void))
      }
    },
  }
}

/**
 * A browser Stream of one API event; the subscription opens on first pull and closes when the Stream ends or is interrupted.
 * @deprecated Kept for existing callers; prefer `useApiEvent` in Client components.
 */
export const events = <
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
export const publish = <const Events extends Record<string, AnyApiEventDefinition>, K extends keyof Events & string>(
  ctx: CordisContext,
  contract: ApiContract<Record<string, AnyApiMethodDefinition>, Events>,
  event: K,
  payload: ApiEventHostPayload<Events[K]>,
): Effect.Effect<void, PublishEventError> =>
  Effect.tryPromise({
    try: () => HostApiEventsModel.publish(ctx, contract, event, payload),
    catch: cause => new PublishEventError({ message: `The Host refused the ${contract.id} ${event} event.`, apiId: contract.id, event, cause }),
  })

/**
 * Convert the Promise API client into Effect calls failing with `ApiCallError`.
 * @deprecated Use `Api.client`, whose failures are typed per kind.
 */
export const client = effectClient

/** The dshx tracer as an Effect layer; `DshxPlugin.make` already provides it under the plugin layer. */
export { tracerLayer }
