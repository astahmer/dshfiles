/**
 * Plugins that know of updates only a Host restart applies list them here; thread-sidebar's one restart status item
 * shows them beside the Host files it watches, and owns the restart verbs. hmr-gate adds the client bundles it held
 * back because their Host half changed.
 *
 * Published as the `@dshfiles/thread-sidebar/restart-sources` dshx module: a provider depends on thread-sidebar, never
 * the reverse (docs/plugin-boundaries.md). Without thread-sidebar nothing reads the registry.
 */
import { defineRegistry } from '@dshfiles/dshx/client'

export interface PendingRestartSource {
  /** The providing package; the item keeps the first source per id. */
  readonly id: string
  readonly subscribe: (listener: () => void) => () => void
  /** Package ids waiting for a restart; return the same array until it changes. */
  readonly packages: () => readonly string[]
}

/** Providers contribute with `api.add(PendingRestartSources, { id, subscribe, packages })`. */
export const PendingRestartSources = defineRegistry<PendingRestartSource>('@dshfiles/thread-sidebar.pending-restart-source')
