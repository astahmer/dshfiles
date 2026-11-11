import { Effect, Schema } from 'effect'
import type { PackManagerSurface } from './pack-controls.js'

/** The plugin manager refused or failed one call; `reason` is its own message. */
export class PackManagerFailed extends Schema.TaggedError<PackManagerFailed>()('PackManagerFailed', {
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason
  }
}

const managerFailed = (cause: unknown): PackManagerFailed => new PackManagerFailed({ reason: cause instanceof Error ? cause.message : String(cause), cause })

/**
 * The one edge where onboarding adapts the plugin manager's Promise surface; the pack controls see Effects. Each call
 * fails with `PackManagerFailed` carrying the manager's own cause, so the caller chooses the fallback.
 */
export const packManagerCalls = <Id extends string>(manager: PackManagerSurface<Id>) => ({
  listPlugins: Effect.tryPromise({ try: () => manager.listPlugins(), catch: managerFailed }),
  /** A manager without bundle records lists none. */
  listBundles: Effect.tryPromise({ try: () => manager.listBundles?.() ?? Promise.resolve([]), catch: managerFailed }),
  setPluginEnabled: (id: Id, enabled: boolean) => Effect.tryPromise({ try: () => manager.setPluginEnabled(id, enabled), catch: managerFailed }),
})
