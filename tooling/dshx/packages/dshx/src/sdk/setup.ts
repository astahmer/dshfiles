import type { Context, Effect } from '@deepseek-ai/cordis'

type Setup = (ctx: Context) => void | Effect<void>
type Metadata = { readonly packageId: string }
type HostSetup = (ctx: Context, config: unknown, metadata: Metadata) => void | Effect<void>
type ClientSetup = (ctx: Context, decorate: (component: unknown) => unknown, metadata: Metadata) => void | Effect<void>
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
export function invokeClientSetup(setup: Setup | undefined, ctx: Context, decorate: (component: unknown) => unknown, metadata: Metadata): void | Effect<void> {
  return setup === undefined ? undefined : clients.has(setup) ? clients.get(setup)!(ctx, decorate, metadata) : setup(ctx)
}
