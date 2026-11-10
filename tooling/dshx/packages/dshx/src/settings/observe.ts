import type z from '@deepseek-ai/schemastery'
import type { ContextLike } from './client.js'
import type { SettingsContract } from './types.js'
import { createSettingsClientRuntime } from './client.js'

/**
 * Observe decoded Settings outside React, through the same official mirror and decoder as `useSettings`. The value is
 * `undefined` while the Host has not provided a valid one, so callers supply their own default. Needed by
 * `@dshfiles/sidebar-right` and `@dshfiles/tool-meta`, whose reads happen in controller or selector code.
 */
export const observeSettings = <Schema extends z<any, object>, ClientValue extends object>(
  ctx: ContextLike,
  contract: SettingsContract<Schema, ClientValue>,
): { readonly getSnapshot: () => ClientValue | undefined; readonly subscribe: (listener: () => void) => () => void } => {
  const { scope } = createSettingsClientRuntime(ctx).binding(contract)
  return { getSnapshot: () => scope.getSnapshot().value, subscribe: listener => scope.subscribe(listener) }
}
