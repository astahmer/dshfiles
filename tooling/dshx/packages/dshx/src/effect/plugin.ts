import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Cause, Context, Effect, Exit, Fiber, Layer, Schema, Scope } from 'effect'
import { redactConfigSchema } from '../host/config-schema.js'
import type { HostDefinition } from '../host/types.js'
import { SdkSetupRuntime } from '../sdk/setup.js'
import type { SettingsContribution } from '../settings/types.js'
import type { ApiBinding } from './api.js'
import { HostContext, cordisLogger } from './host-context.js'
import { type ActivationSlot, makeActivationSlot, type PluginRuntime, runtimeOf } from './plugin-runtime.js'
import { causeReport } from './cause-report.js'
import { detached, detachedContext } from './detached.js'
import { hostLoggerLayer } from './host-logger.js'
import { processEnvConfig } from './process-env-config.js'

export { detached, detachedContext } from './detached.js'
export { processEnvConfig } from './process-env-config.js'
import type { AnyEffectTool } from './tool.js'
import { toDefinition } from './tool-edge.js'
import { tracerLayer } from './tracer.js'

/** The plugin's layer, its row config or its activation failed; the plugin did not start and its Scope is closed. */
export class PluginActivationError extends Schema.TaggedError<PluginActivationError>()('PluginActivationError', {
  plugin: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.plugin} failed to activate. See the Host log for its cause.`
  }
}

type ConfigSchema = Schema.Codec<unknown, unknown>
type ConfigOf<Config> = Config extends ConfigSchema ? Config['Type'] : undefined
type PluginLayer<ROut, E, Config> = Layer.Layer<ROut, E, HostContext> | ((config: ConfigOf<Config>) => Layer.Layer<ROut, E, HostContext>)

/** What the plugin's services, `main`, handlers and tools can require: its own layer's output plus the Host edge. */
export type PluginServices<ROut> = ROut | HostContext

export interface PluginDefinition<ROut, E, Config extends ConfigSchema | undefined> {
  /** The Loader row id and Host plugin name, e.g. `dshfiles-memory`. */
  readonly name: string
  /** Extra Cordis services to inject before activation; APIs and tools add `connection` and `tools` themselves. */
  readonly inject?: readonly string[]
  /** Native Loader config, validated by the Loader and decoded again before the layer is built. */
  readonly Config?: Config
  readonly settings?: readonly SettingsContribution[]
  /** Every service of the plugin, built once per activation from `HostContext`; finalizers run on unload. */
  readonly layer: PluginLayer<ROut, E, Config>
  /** The plugin's root fiber, forked into its Scope after the layer is built and interrupted on unload. */
  readonly main?: Effect.Effect<void, never, NoInfer<PluginServices<ROut>> | Scope.Scope>
  readonly apis?: ReadonlyArray<ApiBinding<NoInfer<PluginServices<ROut>>>>
  readonly tools?: ReadonlyArray<AnyEffectTool<NoInfer<PluginServices<ROut>>>>
  /**
   * Build `layer` and start `main` on the first API or tool call instead of at activation; opt-in, default off.
   * Only for a plugin whose boot-time side effects are optional: until that first call it subscribes to nothing,
   * indexes nothing and provides no Cordis service another row needs, because a layer that never builds cannot.
   * `Config` and the static registrations (tools, APIs, settings, prompt contributions) stay eager, so a bad row
   * config still fails the row at boot; the first call pays the build and reports its failure.
   */
  readonly lazy?: boolean
}

const decodeConfig = <Config extends ConfigSchema | undefined>(schema: Config, rowConfig: unknown) =>
  schema === undefined ? Effect.succeed(undefined) : Schema.decodeUnknownEffect(schema)(SdkSetupRuntime.unwrapRowConfig(rowConfig))

const pluginLayer = <ROut, E, Config extends ConfigSchema | undefined>(layer: PluginLayer<ROut, E, Config>, config: ConfigOf<Config>) =>
  typeof layer === 'function' ? layer(config) : layer

/**
 * One Effect Host plugin: `layer` is built once per activation inside a Scope that the Cordis disposer closes;
 * `apis` and `tools` run each call in those services, with the call's abort as fiber interruption.
 * Returns a `defineHost` definition, so it is the plugin's default Host export.
 */
export const make = <ROut, E = never, const Config extends ConfigSchema | undefined = undefined>(
  definition: PluginDefinition<ROut, E, Config>,
): HostDefinition => {
  const slot: ActivationSlot<PluginServices<ROut> | Scope.Scope> = makeActivationSlot(definition.name)
  const runtimeFor = (signal: AbortSignal | undefined) => slot.runtime(signal)

  const activate = async (ctx: CordisContext, rowConfig: unknown, packageId: string): Promise<() => Promise<void>> => {
    slot.begin()
    const scope = Scope.makeUnsafe()

    const layerBuild = (config: ConfigOf<Config>) =>
      Effect.gen(function* () {
        const layer = pluginLayer(definition.layer, config)
        const host = HostContext.layer({ ctx, packageId })
        const base = Layer.mergeAll(host, tracerLayer, processEnvConfig, Layer.provide(hostLoggerLayer, host))
        const services = yield* Layer.buildWithScope(Layer.provideMerge(layer, base), scope)
        return Context.add(services, Scope.Scope, scope)
      })

    const activationSpan = (lazy: boolean) =>
      Effect.withSpan('plugin activate', {
        attributes: { 'dshx.plugin.package': packageId, ...(lazy ? { 'dshx.plugin.lazy': true } : {}) },
      })

    const forkMain = (services: Context.Context<PluginServices<ROut> | Scope.Scope>, runtime: PluginRuntime<PluginServices<ROut> | Scope.Scope>) => {
      if (definition.main === undefined) return
      const main = definition.main.pipe(
        Effect.catchCause(cause =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => runtime.log({ topic: 'plugin', level: 'error', message: `${definition.name} main failed:\n${causeReport(cause)}` })),
        ),
      )
      Effect.runForkWith(services)(Effect.forkIn(main, scope))
    }

    const deactivate = async (cause: Cause.Cause<unknown>): Promise<PluginActivationError> => {
      await Effect.runPromise(Scope.close(scope, Exit.failCause(cause)))
      cordisLogger(ctx, 'dshx:plugin').error(`${definition.name} failed to activate:\n${causeReport(cause)}`)
      const error = new PluginActivationError({ plugin: definition.name, cause })
      slot.fail(error)
      return error
    }

    if (definition.lazy !== true) {
      const built = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const config = yield* decodeConfig(definition.Config, rowConfig)
          return yield* layerBuild(config as ConfigOf<Config>)
        }).pipe(activationSpan(false), Effect.provide(tracerLayer)),
      )
      if (Exit.isFailure(built)) throw await deactivate(built.cause)
      const runtime: PluginRuntime<PluginServices<ROut> | Scope.Scope> = runtimeOf({ services: built.value, ctx })
      slot.activate(runtime)
      forkMain(built.value, runtime)
      return async () => {
        slot.stop()
        await Effect.runPromise(Scope.close(scope, Exit.void))
      }
    }

    // A lazy row still decodes its config here: a bad row config fails the row at boot instead of hiding behind a panel
    // nobody opened. Only the layer build and `main` wait for the first call.
    const decoded = await Effect.runPromiseExit(decodeConfig(definition.Config, rowConfig))
    if (Exit.isFailure(decoded)) throw await deactivate(decoded.cause)
    const config = decoded.value as ConfigOf<Config>
    let building: Fiber.Fiber<Context.Context<PluginServices<ROut> | Scope.Scope>, E> | undefined
    slot.defer(async () => {
      const fiber = Effect.runFork(layerBuild(config).pipe(activationSpan(true), Effect.provide(tracerLayer)))
      building = fiber
      const built = await Effect.runPromise(Fiber.await(fiber))
      if (Exit.isFailure(built)) {
        // An unload interrupts the build: the slot is already stopped and its callers were refused, so nothing is logged.
        if (!Cause.hasInterruptsOnly(built.cause)) throw await deactivate(built.cause)
        return
      }
      const runtime: PluginRuntime<PluginServices<ROut> | Scope.Scope> = runtimeOf({ services: built.value, ctx })
      slot.activate(runtime)
      forkMain(built.value, runtime)
    })
    return async () => {
      slot.stop()
      if (building !== undefined) await Effect.runPromise(Fiber.interrupt(building))
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  }

  return {
    name: definition.name,
    ...(definition.inject !== undefined && { inject: definition.inject }),
    ...(definition.Config !== undefined && { Config: redactConfigSchema(Schema.toStandardSchemaV1(definition.Config)) }),
    ...(definition.settings !== undefined && { settings: definition.settings }),
    apis: (definition.apis ?? []).map(binding => binding.serve(runtimeFor)),
    tools: (definition.tools ?? []).map(tool => toDefinition(tool, runtimeFor)),
    setup: SdkSetupRuntime.adaptHost(
      (ctx, rowConfig) => activate(ctx, rowConfig, definition.name),
      (ctx, rowConfig, metadata) => activate(ctx, rowConfig, metadata.packageId),
    ),
  }
}

/**
 * Fork a plugin-lifetime background loop from a layer: it lives until the plugin Scope closes, and its spans start
 * their own traces instead of hanging under the `plugin activate` span.
 */
export const worker = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R | Scope.Scope> =>
  Effect.asVoid(Effect.forkScoped(detached(effect)))

/**
 * Turn an Effect function into a Promise function that runs in the current services, for a callback API that
 * must stay Promise (a polyfill, a native hook). Capture it inside the plugin (a layer or `main`), not per call.
 */
export const callback = <Args extends ReadonlyArray<unknown>, A, E, R>(
  body: (...args: Args) => Effect.Effect<A, E, R>,
): Effect.Effect<(...args: Args) => Promise<A>, never, R> =>
  Effect.map(detachedContext<R>(), services => {
    const run = Effect.runPromiseWith(services)
    return (...args: Args) => run(body(...args))
  })

/** The first argument of a `callbackWithSignal` function: the Promise caller's abort. */
export interface CallbackOptions {
  readonly signal: AbortSignal | undefined
}

/**
 * `callback` for a Promise caller that can abort: the returned function takes `{ signal }` before the body's
 * arguments, and an abort interrupts the fiber. An interrupted call rejects with `signal.reason`, as an aborted Promise
 * API does; any other failure rejects as `callback` does.
 */
export const callbackWithSignal = <Args extends ReadonlyArray<unknown>, A, E, R>(
  body: (...args: Args) => Effect.Effect<A, E, R>,
): Effect.Effect<(options: CallbackOptions, ...args: Args) => Promise<A>, never, R> =>
  Effect.map(detachedContext<R>(), services => {
    const run = Effect.runPromiseExitWith(services)
    return async (options: CallbackOptions, ...args: Args) => {
      const exit = await run(body(...args), options.signal === undefined ? undefined : { signal: options.signal })
      if (Exit.isSuccess(exit)) return exit.value
      if (options.signal?.aborted === true && Cause.hasInterruptsOnly(exit.cause)) throw options.signal.reason
      throw Cause.squash(exit.cause)
    }
  })
