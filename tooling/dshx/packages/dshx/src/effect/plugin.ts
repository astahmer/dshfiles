import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Cause, Context, Effect, Exit, Fiber, Layer, Schema, Scope } from 'effect'
import { ApiDefinitionModel, type ApiHostRegistrationParts } from '../api/define.js'
import type { ApiContract, ApiHostRegistration } from '../api/types.js'
import { redactConfigSchema } from '../host/config-schema.js'
import type { HostDefinition } from '../host/types.js'
import { SdkSetupRuntime } from '../sdk/setup.js'
import type { SettingsContribution } from '../settings/types.js'
import type { ApiBinding } from './api.js'
import { HostContext, cordisLogger } from './host-context.js'
import { type ActivationSlot, makeActivationSlot, PluginInactive, type PluginRuntime, runtimeOf } from './plugin-runtime.js'
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

/** A facade could not import its Host implementation module, so the plugin did not start. */
export class PluginLoadError extends Schema.TaggedError<PluginLoadError>()('PluginLoadError', {
  plugin: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `${this.plugin} could not import its Host implementation. Rebuild the plugin with \`dshx build\`, then restart DSH.`
  }
}

/** A facade's implementation serves other API methods than the facade registered, so it is refused instead of half-wired. */
export class PluginImplementationMismatch extends Schema.TaggedError<PluginImplementationMismatch>()('PluginImplementationMismatch', {
  plugin: Schema.String,
  missing: Schema.Array(Schema.String),
  unexpected: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `${this.plugin}'s implementation does not serve what its facade declares (missing: ${this.missing.join(', ') || 'none'}; unexpected: ${this.unexpected.join(', ') || 'none'}). Rebuild the plugin so both halves come from one build, then restart DSH.`
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

const pluginLayer = <ROut, E, Config>(layer: Layer.Layer<ROut, E, HostContext> | ((config: Config) => Layer.Layer<ROut, E, HostContext>), config: Config) =>
  typeof layer === 'function' ? layer(config) : layer

/** What one activation builds: the layer and the root fiber, resolved from the row's decoded config. */
interface Activation<ROut> {
  readonly layer: Layer.Layer<ROut, unknown, HostContext>
  readonly main: Effect.Effect<void, never, PluginServices<ROut> | Scope.Scope> | undefined
}

type Services<ROut> = PluginServices<ROut> | Scope.Scope
type RuntimeFor<ROut> = (signal: AbortSignal | undefined) => Promise<PluginRuntime<Services<ROut>>>

/** The activation edge `make` and `facade` share: one slot, one Scope per activation, eager or deferred to the first call. */
const host = <ROut, Config extends ConfigSchema | undefined>(input: {
  readonly name: string
  readonly inject: readonly string[] | undefined
  readonly Config: Config | undefined
  readonly settings: readonly SettingsContribution[] | undefined
  readonly lazy: boolean
  readonly spanAttributes: Readonly<Record<string, boolean>>
  readonly resolve: (input: {
    readonly config: ConfigOf<Config>
    readonly packageId: string
    readonly runtimeFor: RuntimeFor<ROut>
  }) => Effect.Effect<Activation<ROut>, unknown>
  readonly register: (runtimeFor: RuntimeFor<ROut>) => Pick<HostDefinition, 'apis' | 'tools'>
}): HostDefinition => {
  const slot: ActivationSlot<Services<ROut>> = makeActivationSlot(input.name)
  const runtimeFor: RuntimeFor<ROut> = signal => slot.runtime(signal)

  const activate = async (ctx: CordisContext, rowConfig: unknown, packageId: string): Promise<() => Promise<void>> => {
    slot.begin()
    const scope = Scope.makeUnsafe()

    const layerBuild = (config: ConfigOf<Config>) =>
      Effect.gen(function* () {
        const activation = yield* input.resolve({ config, packageId, runtimeFor })
        const host = HostContext.layer({ ctx, packageId })
        const base = Layer.mergeAll(host, tracerLayer, processEnvConfig, Layer.provide(hostLoggerLayer, host))
        const services = yield* Layer.buildWithScope(Layer.provideMerge(activation.layer, base), scope)
        return { services: Context.add(services, Scope.Scope, scope), main: activation.main }
      })

    const activationSpan = (lazy: boolean) =>
      Effect.withSpan('plugin activate', {
        attributes: lazy ? { 'dshx.plugin.package': packageId, 'dshx.plugin.lazy': true, ...input.spanAttributes } : { 'dshx.plugin.package': packageId },
      })

    const forkMain = (
      built: { readonly services: Context.Context<Services<ROut>>; readonly main: Activation<ROut>['main'] },
      runtime: PluginRuntime<Services<ROut>>,
    ) => {
      if (built.main === undefined) return
      const main = built.main.pipe(
        Effect.catchCause(cause =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => runtime.log({ topic: 'plugin', level: 'error', message: `${input.name} main failed:\n${causeReport(cause)}` })),
        ),
      )
      Effect.runForkWith(built.services)(Effect.forkIn(main, scope))
    }

    const deactivate = async (cause: Cause.Cause<unknown>): Promise<PluginActivationError> => {
      await Effect.runPromise(Scope.close(scope, Exit.failCause(cause)))
      cordisLogger(ctx, 'dshx:plugin').error(`${input.name} failed to activate:\n${causeReport(cause)}`)
      const error = new PluginActivationError({ plugin: input.name, cause })
      slot.fail(error)
      return error
    }

    if (!input.lazy) {
      const built = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const config = yield* decodeConfig(input.Config, rowConfig)
          return yield* layerBuild(config as ConfigOf<Config>)
        }).pipe(activationSpan(false), Effect.provide(tracerLayer)),
      )
      if (Exit.isFailure(built)) throw await deactivate(built.cause)
      const runtime: PluginRuntime<Services<ROut>> = runtimeOf({ services: built.value.services, ctx })
      slot.activate(runtime)
      forkMain(built.value, runtime)
      return async () => {
        slot.stop()
        await Effect.runPromise(Scope.close(scope, Exit.void))
      }
    }

    // A lazy row still decodes its config here: a bad row config fails the row at boot instead of hiding behind a panel
    // nobody opened. Only the layer build and `main` wait for the first call.
    const decoded = await Effect.runPromiseExit(decodeConfig(input.Config, rowConfig))
    if (Exit.isFailure(decoded)) throw await deactivate(decoded.cause)
    const config = decoded.value as ConfigOf<Config>
    let building: Fiber.Fiber<Effect.Success<ReturnType<typeof layerBuild>>, unknown> | undefined
    slot.defer(async () => {
      const fiber = Effect.runFork(layerBuild(config).pipe(activationSpan(true), Effect.provide(tracerLayer)))
      building = fiber
      const built = await Effect.runPromise(Fiber.await(fiber))
      if (Exit.isFailure(built)) {
        // An unload interrupts the build: the slot is already stopped and its callers were refused, so nothing is logged.
        if (!Cause.hasInterruptsOnly(built.cause)) throw await deactivate(built.cause)
        return
      }
      const runtime: PluginRuntime<Services<ROut>> = runtimeOf({ services: built.value.services, ctx })
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
    name: input.name,
    ...(input.inject !== undefined && { inject: input.inject }),
    ...(input.Config !== undefined && { Config: redactConfigSchema(Schema.toStandardSchemaV1(input.Config)) }),
    ...(input.settings !== undefined && { settings: input.settings }),
    ...input.register(runtimeFor),
    setup: SdkSetupRuntime.adaptHost(
      (ctx, rowConfig) => activate(ctx, rowConfig, input.name),
      (ctx, rowConfig, metadata) => activate(ctx, rowConfig, metadata.packageId),
    ),
  }
}

/**
 * One Effect Host plugin: `layer` is built once per activation inside a Scope that the Cordis disposer closes;
 * `apis` and `tools` run each call in those services, with the call's abort as fiber interruption.
 * Returns a `defineHost` definition, so it is the plugin's default Host export.
 */
export const make = <ROut, E = never, const Config extends ConfigSchema | undefined = undefined>(
  definition: PluginDefinition<ROut, E, Config>,
): HostDefinition =>
  host<ROut, Config>({
    name: definition.name,
    inject: definition.inject,
    Config: definition.Config,
    settings: definition.settings,
    lazy: definition.lazy === true,
    spanAttributes: {},
    resolve: input => Effect.succeed({ layer: pluginLayer(definition.layer, input.config), main: definition.main }),
    register: runtimeFor => ({
      apis: (definition.apis ?? []).map(binding => binding.serve(runtimeFor)),
      tools: (definition.tools ?? []).map(tool => toDefinition(tool, runtimeFor)),
    }),
  })

/**
 * The real Host half of a `facade`: its layer, root fiber and API handlers, in a module the facade imports on first use.
 * `Config` is the row config the facade decoded; a layer that ignores it takes no argument.
 */
export interface PluginImplementation<in Config> {
  readonly layer: Layer.Layer<unknown, unknown, HostContext> | ((config: Config) => Layer.Layer<unknown, unknown, HostContext>)
  readonly main: Effect.Effect<void, never, unknown> | undefined
  readonly apis: ReadonlyArray<ApiBinding<unknown>>
}

/** Declare a facade's implementation, type-checked like `make`: every handler and `main` runs in what `layer` builds. */
export const implementation = <ROut, E = never, Config = unknown>(definition: {
  readonly layer: Layer.Layer<ROut, E, HostContext> | ((config: Config) => Layer.Layer<ROut, E, HostContext>)
  readonly main?: Effect.Effect<void, never, NoInfer<PluginServices<ROut>> | Scope.Scope>
  readonly apis: ReadonlyArray<ApiBinding<NoInfer<PluginServices<ROut>>>>
}): PluginImplementation<Config> => ({
  // SAFETY: the signature above checks that `main` and every handler need only what this layer builds, so the facade may
  // forget the layer's output type: it runs them in exactly the services this layer built and nowhere else.
  layer: definition.layer as PluginImplementation<Config>['layer'],
  main: definition.main,
  apis: definition.apis,
})

export interface FacadeDefinition<Config extends ConfigSchema | undefined> {
  /** The Loader row id and Host plugin name, as for `make`. */
  readonly name: string
  readonly inject?: readonly string[]
  /** Decoded at activation, as for a lazy `make` row: a bad row config fails the row at boot. */
  readonly Config?: Config
  readonly settings?: readonly SettingsContribution[]
  /** Every contract the implementation serves; registered at boot with their method tools, answered after the first load. */
  readonly apis: ReadonlyArray<ApiContract>
  /** Import the implementation module, e.g. `() => import('./host-implementation.js')`; called once per activation, on the first call. */
  readonly load: () => Promise<{ readonly default: PluginImplementation<ConfigOf<NoInfer<Config>>> }>
}

const methodKeys = (contracts: ReadonlyArray<ApiContract>): ReadonlyArray<string> =>
  contracts.flatMap(contract => Object.keys(contract.methods).map(method => `${contract.id}.${method}`)).sort()

/**
 * A Host row whose module graph loads on first use: the facade registers `apis` (and their method tools), `settings`
 * and `Config` at boot from a small entry, and the first API call imports `load`, checks that it serves exactly those
 * methods and builds its layer, as `make({ lazy: true })` does. Concurrent first calls share one import and one build;
 * a failed import or a mismatched implementation fails the row with `PluginActivationError`, and every call answers
 * `plugin-inactive` until DSH restarts. Opt-in: only for a row nothing needs before its panel or tool is used.
 */
export const facade = <const Config extends ConfigSchema | undefined = undefined>(definition: FacadeDefinition<Config>): HostDefinition => {
  const served = new Map<string, ApiHostRegistration>()
  return host<unknown, Config>({
    name: definition.name,
    inject: definition.inject,
    Config: definition.Config,
    settings: definition.settings,
    lazy: true,
    spanAttributes: { 'dshx.plugin.facade': true },
    resolve: input =>
      Effect.gen(function* () {
        const loaded = yield* Effect.tryPromise({
          try: definition.load,
          catch: cause => new PluginLoadError({ plugin: definition.name, cause }),
        }).pipe(Effect.withSpan('plugin load', { attributes: { 'dshx.plugin.package': input.packageId } }))
        const implementation = loaded.default
        const declared = methodKeys(definition.apis)
        const actual = methodKeys(implementation.apis.map(binding => binding.contract))
        const missing = declared.filter(key => !actual.includes(key))
        const unexpected = actual.filter(key => !declared.includes(key))
        if (missing.length > 0 || unexpected.length > 0) return yield* new PluginImplementationMismatch({ plugin: definition.name, missing, unexpected })
        for (const binding of implementation.apis) served.set(binding.contract.id, binding.serve(input.runtimeFor))
        return { layer: pluginLayer(implementation.layer, input.config), main: implementation.main }
      }),
    register: runtimeFor => ({
      apis: definition.apis.map(contract => forwarded({ contract, runtimeFor, plugin: definition.name, registration: () => served.get(contract.id) })),
      tools: [],
    }),
  })
}

/** One facade contract registration whose handlers wait for activation, then call the implementation's served handler. */
const forwarded = (input: {
  readonly contract: ApiContract
  readonly plugin: string
  readonly runtimeFor: RuntimeFor<unknown>
  readonly registration: () => ApiHostRegistration | undefined
}): ApiHostRegistration => {
  type Handler = ApiHostRegistrationParts['handlers'][string]
  const forward = (method: string): Handler => {
    const refused = (cause: unknown) => {
      if (cause instanceof PluginInactive) throw cause.apiError({ apiId: input.contract.id, method })
      throw cause
    }
    return async context => {
      await input.runtimeFor(context.signal).catch(refused)
      const registration = input.registration()
      const handler = registration === undefined ? undefined : ApiDefinitionModel.hostRegistrationParts(registration).handlers[method]
      if (handler === undefined) return refused(new PluginInactive(`${input.plugin} is not running.`))
      return handler(context)
    }
  }
  const promised: ApiHostRegistrationParts['handlers'] = Object.fromEntries(Object.keys(input.contract.methods).map(method => [method, forward(method)]))
  // SAFETY: every contract method is mapped above to a Promise handler that forwards the same input and output.
  return input.contract.host(promised as Parameters<ApiContract['host']>[0])
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
