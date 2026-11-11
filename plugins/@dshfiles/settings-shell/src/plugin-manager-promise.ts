import { Effect, Schema } from 'effect'
import type { PluginChange } from './shell-api.js'

/** Longest manager-supplied text a reply relays. */
export const MAX_REASON = 300

export class PluginManagerFailed extends Schema.TaggedError<PluginManagerFailed>()(
  'PluginManagerFailed',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'plugin-manager-failed' },
) {
  override get message(): string {
    return `${this.reason} Settings › Plugins shows the same entries; the profile’s cordis.patch.yml can be edited by hand.`
  }
}

const managerFailed = (cause: unknown): PluginManagerFailed =>
  new PluginManagerFailed({ reason: (cause instanceof Error ? cause.message : String(cause)).slice(0, MAX_REASON), cause })

/** The plugin-manager surface the plugin controls read; `PluginManager` satisfies it with its branded entry ids. */
export interface PluginManagerSurface<Id extends string> {
  listPlugins(): Promise<readonly PluginInfoLike<Id>[]>
  setPluginEnabled(id: Id, enabled: boolean): Promise<PluginChangeResult>
  /** Absent on a manager that predates bundle records; the entries then name no owner. */
  listBundles?(): Promise<readonly BundleInfoLike[]>
}

/** What the controls read of a bundle record; `BundleInfo` satisfies it. */
export interface BundleInfoLike {
  readonly name: string
  readonly rows: readonly { readonly rowId: string; readonly entryId?: string }[]
  readonly overrides: readonly string[]
}

/** What the controls read of the manager's change result; `ChangeResult` satisfies it. */
export interface PluginChangeResult {
  readonly changed: boolean
  readonly application: PluginChange['application']
  readonly restartReason?: string
  readonly enabled?: boolean
  readonly error?: { readonly code: string; readonly diagnostic?: string }
  readonly warnings?: readonly string[]
}

export interface PluginInfoLike<Id extends string> {
  readonly entryId: Id
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: string | null
  readonly readOnlyReason?: string
}

/**
 * The one edge where settings-shell adapts the plugin manager's Promise surface; the rest of the plugin sees Effects.
 * Each call fails with `PluginManagerFailed` carrying the manager's own cause, so callers choose the fallback.
 */
export const pluginManagerCalls = <Id extends string>(manager: PluginManagerSurface<Id>) => ({
  listPlugins: Effect.tryPromise({ try: () => manager.listPlugins(), catch: managerFailed }),
  /** A manager without bundle records lists none. */
  listBundles: Effect.tryPromise({ try: () => manager.listBundles?.() ?? Promise.resolve([]), catch: managerFailed }),
  setPluginEnabled: (id: Id, enabled: boolean) => Effect.tryPromise({ try: () => manager.setPluginEnabled(id, enabled), catch: managerFailed }),
})
