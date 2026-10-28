import type { DockPaneActions } from '@dshfiles/frame-layout/regions'
import { createStoredValue, type StoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

/** Browser presentation state, separate from the obsolete per-profile surface choice. */
export const rightPaneVisibility = createStoredValue({ key: 'dshfiles.workbench.right-pane-visible.v1', schema: z.boolean().nullable(), fallback: null })

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
