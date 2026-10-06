import type { Context, Effect } from '@deepseek-ai/cordis'
import type { ClientContext, ClientDefinition } from '../client/types.js'

type Setup = (ctx: Context) => void | Effect<void>
type Metadata = { readonly packageId: string }
type HostSetup = (ctx: Context, config: unknown, metadata: Metadata) => void | Effect<void>
type ComponentDecorator = <Component>(component: Component) => Component
type ClientSetup = (ctx: ClientContext, decorate: ComponentDecorator, metadata: Metadata) => void | Effect<void>
// A defineClient({ setup }) handler receives the component decorator as its
// second argument, so the runtime accepts more than the one-argument Host shape.
type ClientDefinitionSetup = NonNullable<ClientDefinition['setup']>
// Definition metadata only. Cordis still owns activation, identity, and cleanup.
const hosts = new WeakMap<Setup, HostSetup>()
const clients = new WeakMap<Setup, ClientSetup>()

export function adaptHostSetup(fallback: Setup, setup: HostSetup): Setup {
  hosts.set(fallback, setup)
  return fallback
}
export function adaptClientSetup(fallback: Setup, setup: ClientSetup): Setup {
  clients.set(fallback, setup)
  return fallback
}
export function invokeHostSetup(setup: Setup | undefined, ctx: Context, config: unknown, metadata: Metadata): void | Effect<void> {
  return setup === undefined ? undefined : hosts.has(setup) ? hosts.get(setup)!(ctx, config, metadata) : setup(ctx)
}
export function invokeClientSetup(
  setup: ClientDefinitionSetup | undefined,
  ctx: ClientContext,
  decorate: ComponentDecorator,
  metadata: Metadata,
): void | Effect<void> {
  if (setup === undefined) return undefined
  if (clients.has(setup as Setup)) return clients.get(setup as Setup)!(ctx, decorate, metadata)
  return (setup as ClientSetup)(ctx, decorate, metadata)
}
