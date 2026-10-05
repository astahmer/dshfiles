import { adaptHostSetup } from './setup.js'
import { HOST_CAPABILITY_INJECTIONS } from 'create-dshx/runtime-capabilities'
import type { Context, Effect } from '@deepseek-ai/cordis'
import type { CommandRuntime } from '@deepseek-ai/dsh-commands'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { ApiHostRegistration } from '../api/types.js'
import { registerApi } from '../api/host-runtime.js'
import type { HostDefinition } from '../host/types.js'
import { redactConfigSchema } from '../host/config-schema.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { assertPluginId, createBaseApi, type BasePluginApi } from './lifecycle.js'

export interface HostCapabilities {
  /** Native slash commands, automatically removed on unload. */
  readonly commands: Pick<CommandRuntime, 'register'>
  /** Native tools retain schema inference, cancellation, and execution policy. */
  readonly tools: Pick<ToolRuntime, 'register'>
  readonly prompts: Pick<SystemPrompt, 'section' | 'context'>
  readonly rpc: { register(registration: ApiHostRegistration): Promise<void> }
}

export type HostCapability = keyof HostCapabilities
type PluginConfigSchema = StandardSchemaV1<unknown, Readonly<Record<string, unknown>>> | undefined
type PluginConfig<Schema extends PluginConfigSchema> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Schema>
  : Readonly<Record<string, unknown>>

export type PluginApi<Uses extends readonly HostCapability[] = readonly [], Config = Readonly<Record<string, unknown>>> = Omit<BasePluginApi, 'config'> & {
  readonly config: Config
} & Pick<HostCapabilities, Uses[number]>

export interface PluginDefinition<Uses extends readonly HostCapability[] = readonly [], Config extends PluginConfigSchema = undefined> extends Omit<
  HostDefinition,
  'name' | 'setup' | 'Config'
> {
  /** Stable native plugin identity. Package version lives in package.json. */
  readonly id: string
  readonly name?: string
  /** Explicit capabilities produce native service injection before activation. */
  readonly uses?: Uses
  /** Native Loader schema validates this plugin's configuration before setup. */
  readonly Config?: Config
  /** Return cleanup or use lifecycle.onDispose for acquired resources. */
  readonly setup?: (api: PluginApi<Uses, PluginConfig<Config>>) => void | Effect<void>
}

/**
 * Normalize the row config the Loader hands to `apply`.
 *
 * Schemastery passes the plugin a resolver object whose fields are getters, so
 * author code reads `api.config.distribution` rather than calling it. Unwrap
 * once here so `api.config` is plain data, and treat a missing config as empty
 * instead of `undefined`.
 */
export function unwrapRowConfig(config: unknown): Record<string, unknown> {
  if (config === null || config === undefined || typeof config !== 'object') return {}
  const resolved = config as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(resolved)) {
    output[key] = typeof value === 'function' ? (value as () => unknown)() : value
  }
  return output
}

/** @internal Capability adapters always resolve services through the caller's context. */
export function createPluginApi<Uses extends readonly HostCapability[], Config = Readonly<Record<string, unknown>>>(
  ctx: Context,
  uses: Uses,
  packageId: string,
  config: Record<string, unknown> = {},
): PluginApi<Uses, Config> {
  const capabilities: {
    -readonly [Key in keyof HostCapabilities]?: HostCapabilities[Key]
  } = {}
  for (const capability of uses) {
    switch (capability) {
      case 'commands':
        capabilities.commands = {
          register: definition => ctx.commands.register(definition),
        }
        break
      case 'tools':
        capabilities.tools = {
          register: definition => ctx.tools.register(definition),
        }
        break
      case 'prompts':
        capabilities.prompts = {
          section: definition => ctx.systemPrompt.section(definition),
          context: definition => ctx.systemPrompt.context(definition),
        }
        break
      case 'rpc':
        capabilities.rpc = {
          register: registration => registerApi(ctx, packageId, registration),
        }
        break
      default:
        throw new TypeError(`Unknown Host capability ${JSON.stringify(capability)}. Use commands, tools, prompts, or rpc.`)
    }
  }
  return Object.assign(createBaseApi(ctx, config), capabilities) as PluginApi<Uses, Config>
}

/**
 * Define a native DSH Host plugin using lifecycle-safe capability APIs.
 * @example definePlugin({ id: 'hello', uses: ['commands'], setup(api) { api.commands.register({ name: 'hello', description: 'Say hello', handler: () => ({ kind: 'success', text: 'Hello' }) }) } })
 */
export function definePlugin<const Uses extends readonly HostCapability[] = readonly [], const Config extends PluginConfigSchema = undefined>(
  definition: PluginDefinition<Uses, Config>,
): HostDefinition {
  assertPluginId(definition.id)
  const { id, name, uses = [] as unknown as Uses, setup, Config, ...contributions } = definition
  for (const capability of uses)
    if (!Object.hasOwn(HOST_CAPABILITY_INJECTIONS, capability)) throw new TypeError(`Unknown Host capability ${JSON.stringify(capability)}.`)
  return {
    ...contributions,
    ...(Config === undefined ? {} : { Config: redactConfigSchema(Config) }),
    name: name ?? id,
    inject: [...new Set([...(definition.inject ?? []), ...uses.flatMap(capability => HOST_CAPABILITY_INJECTIONS[capability])])],
    setup: adaptHostSetup(
      ctx => setup?.(createPluginApi(ctx, uses, id)),
      (ctx, rowConfig, metadata) => setup?.(createPluginApi<Uses, PluginConfig<Config>>(ctx, uses, metadata.packageId, unwrapRowConfig(rowConfig))),
    ),
  }
}
