import type { Context, Effect } from '@deepseek-ai/cordis'
import type { PluginContext } from '../client/plugin-context.js'
import type { ClientContext, ClientDefinition } from '../client/types.js'

type Setup = (ctx: Context, config: unknown) => void | Effect<void>
type Metadata = { readonly packageId: string }
type ClientMetadata = Metadata & { readonly plugin?: PluginContext }
type HostSetup = (ctx: Context, config: unknown, metadata: Metadata) => void | Effect<void>
type ComponentDecorator = <Component>(component: Component) => Component
type ClientSetup = (ctx: ClientContext, decorate: ComponentDecorator, metadata: ClientMetadata) => void | Effect<void>
// A defineClient({ setup }) handler receives the component decorator second and metadata third.
type ClientDefinitionSetup = NonNullable<ClientDefinition['setup']>
// Definition metadata only. Cordis still owns activation, identity, and cleanup.
const hosts = new WeakMap<Setup, HostSetup>()
const clients = new WeakMap<ClientDefinitionSetup, ClientSetup>()

const adaptHostSetup = (fallback: Setup, setup: HostSetup): Setup => {
  hosts.set(fallback, setup)
  return fallback
}

/**
 * Normalize the row config the Loader hands to `apply`.
 *
 * Schemastery passes resolver objects whose fields are getters. Resolve those
 * fields once before exposing the config to Host setup code.
 */
const unwrapRowConfig = (config: unknown) => {
  const output: Record<string, unknown> = {}
  if (config === null || config === undefined || typeof config !== 'object') return output
  const resolved = config as Record<string, unknown>
  for (const [key, value] of Object.entries(resolved)) {
    output[key] = typeof value === 'function' ? (value as () => unknown)() : value
  }
  return output
}

const adaptClientSetup = (fallback: ClientDefinitionSetup, setup: ClientSetup): ClientDefinitionSetup => {
  clients.set(fallback, setup)
  return fallback
}

const invokeHostSetup = (setup: Setup | undefined, ctx: Context, config: unknown, metadata: Metadata): void | Effect<void> => {
  if (setup === undefined) return undefined
  const adapted = hosts.get(setup)
  if (adapted !== undefined) return adapted(ctx, config, metadata)
  return setup(ctx, unwrapRowConfig(config))
}

const invokeClientSetup = (
  setup: ClientDefinitionSetup | undefined,
  ctx: ClientContext,
  decorate: ComponentDecorator,
  metadata: ClientMetadata,
): void | Effect<void> => {
  if (setup === undefined) return undefined
  const adapted = clients.get(setup)
  if (adapted !== undefined) return adapted(ctx, decorate, metadata)
  return setup(ctx, decorate, metadata)
}

export class SdkSetupRuntime {
  static readonly adaptHost = adaptHostSetup
  static readonly unwrapRowConfig = unwrapRowConfig
  static readonly adaptClient = adaptClientSetup
  static readonly invokeHost = invokeHostSetup
  static readonly invokeClient = invokeClientSetup
}
