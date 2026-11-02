import type { DockPaneActions } from '@dshfiles/frame-layout/regions'
import * as Schema from 'effect/Schema'
import type { StoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { createEffectStoredValue } from './effect-stored-value.js'

/** Browser presentation state, separate from the obsolete per-profile surface choice. */
export const rightPaneVisibility = createEffectStoredValue({
  key: 'dshfiles.workbench.right-pane-visible.v1',
  schema: Schema.NullOr(Schema.Boolean),
  fallback: null,
})

export const createDockPaneActions = (visibility: StoredValue<boolean | null, null> = rightPaneVisibility): DockPaneActions => ({
  isOpen: () => visibility.get() === true,
  open: () => {
    visibility.set(true)
  },
  close: () => {
    visibility.set(false)
  },
  toggle: () => {
    visibility.set(visibility.get() !== true)
  },
  subscribe: visibility.subscribe,
})

/** Migrate once; a deliberate new close must never be overridden by an old `dock` setting. */
export const migrateDockVisibility = (legacy: 'native' | 'dock' | undefined, visibility: StoredValue<boolean | null, null> = rightPaneVisibility): void => {
  if (visibility.get() === null) visibility.set(legacy === 'dock')
}
