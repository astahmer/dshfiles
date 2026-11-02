import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { Cause, Context, Effect, Exit, Layer, Schema, Scope } from 'effect'
import { redactConfigSchema } from '../host/config-schema.js'
import type { HostDefinition } from '../host/types.js'
import { SdkSetupRuntime } from '../sdk/setup.js'
import type { SettingsContribution } from '../settings/types.js'
import type { ApiBinding } from './api.js'
import { HostContext } from './host-context.js'
import { type ActivationSlot, makeActivationSlot, type PluginRuntime, runtimeOf } from './plugin-runtime.js'
import { causeReport } from './cause-report.js'
import { detached, detachedContext } from './detached.js'
import { hostLoggerLayer } from './host-logger.js'

export { detachedContext } from './detached.js'
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
    const build = Effect.gen(function* () {
      const config = yield* decodeConfig(definition.Config, rowConfig)
      // SAFETY: decodeConfig returns the decoded type of `definition.Config`, or undefined when there is none.
      const layer = pluginLayer(definition.layer, config as ConfigOf<Config>)
      const host = HostContext.layer({ ctx, packageId })
      const base = Layer.mergeAll(host, tracerLayer, Layer.provide(hostLoggerLayer, host))
      const services = yield* Layer.buildWithScope(Layer.provideMerge(layer, base), scope)
      return Context.add(services, Scope.Scope, scope)
    }).pipe(Effect.withSpan('plugin activate', { attributes: { 'dshx.plugin.package': packageId } }), Effect.provide(tracerLayer))
    const built = await Effect.runPromiseExit(build)
    if (Exit.isFailure(built)) {
      await Effect.runPromise(Scope.close(scope, built))
      ctx.logger('dshx:plugin').error(`${definition.name} failed to activate:\n${causeReport(built.cause)}`)
      const error = new PluginActivationError({ plugin: definition.name, cause: built.cause })
      slot.fail(error)
      throw error
    }
    const runtime: PluginRuntime<PluginServices<ROut> | Scope.Scope> = runtimeOf({ services: built.value, ctx })
    slot.activate(runtime)
    if (definition.main !== undefined) {
      const main = definition.main.pipe(
        Effect.catchCause(cause =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => runtime.log({ topic: 'plugin', level: 'error', message: `${definition.name} main failed:\n${causeReport(cause)}` })),
        ),
      )
      Effect.runForkWith(built.value)(Effect.forkIn(main, scope))
    }
    return async () => {
      slot.stop()
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
