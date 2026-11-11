import { Effect } from 'effect'

/** What the pack controls read of the plugin manager; `PluginManager` satisfies it with its branded entry ids. */
export interface PackManagerSurface<Id extends string> {
  listPlugins(): Promise<readonly { readonly entryId: Id; readonly moduleName: string; readonly enabled: boolean; readonly readOnlyReason?: string }[]>
  setPluginEnabled(
    id: Id,
    enabled: boolean,
  ): Promise<{
    readonly changed: boolean
    readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
    readonly restartReason?: string
    readonly error?: { readonly code: string; readonly diagnostic?: string }
  }>
  /** Absent on a manager without bundle records: the toolchain then cannot be located. */
  listBundles?(): Promise<readonly { readonly name: string; readonly source?: string }[]>
}

/** The native plugin manager's Promise API as Effects: the one place this plugin crosses into it. */
export class PluginManagerEdge {
  static readonly listPlugins = <Id extends string>(manager: PackManagerSurface<Id>) => Effect.tryPromise(() => manager.listPlugins())
  static readonly listBundles = <Id extends string>(manager: PackManagerSurface<Id> | undefined) =>
    Effect.tryPromise(() => manager?.listBundles?.() ?? Promise.resolve([]))
  static readonly setPluginEnabled = <Id extends string>(input: { readonly manager: PackManagerSurface<Id>; readonly id: Id; readonly enabled: boolean }) =>
    Effect.tryPromise(() => input.manager.setPluginEnabled(input.id, input.enabled))
}
