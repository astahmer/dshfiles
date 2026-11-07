import type { DockPaneActions } from '@dshfiles/frame-layout/regions'
import * as Schema from 'effect/Schema'
import type { StoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import type { WorkbenchPanelIdentity } from './panel-close.js'

/** Browser presentation state, separate from the obsolete per-profile surface choice. */
export const rightPaneVisibility = createStoredValue({
  key: 'dshfiles.workbench.right-pane-visible.v1',
  schema: Schema.NullOr(Schema.Boolean),
  fallback: null,
})

/**
 * What the right pane currently holds, as its toggle needs to read it.
 *
 * Panels that float from the right region still render there, so they count as
 * open just as they do for the last-tab close rule.
 */
export interface RightPaneContents {
  readonly panels: () => readonly WorkbenchPanelIdentity[]
  /** Close one panel through its owner's own close path. */
  readonly close: (panel: WorkbenchPanelIdentity) => void
}

/**
 * The right pane's open state, driven by its toggle, its close control and its last-tab rule.
 *
 * A toggle closes the only panel it shows: there is nothing else the user could
 * mean by toggling it closed, and the pane's own last-panel rule then closes the
 * pane. With several panels open the toggle keeps the pane-level hide, so it
 * never closes a view the user did not name.
 */
export const createDockPaneActions = (visibility: StoredValue<boolean | null, null> = rightPaneVisibility, contents?: RightPaneContents): DockPaneActions => ({
  isOpen: () => visibility.get() === true,
  open: () => {
    visibility.set(true)
  },
  close: () => {
    visibility.set(false)
  },
  toggle: () => {
    if (visibility.get() !== true) {
      visibility.set(true)
      return
    }
    const open = contents?.panels() ?? []
    const only = open.length === 1 ? open[0] : undefined
    if (only !== undefined) {
      contents?.close(only)
      return
    }
    visibility.set(false)
  },
  subscribe: visibility.subscribe,
})

/** Migrate once; a deliberate new close must never be overridden by an old `dock` setting. */
export const migrateDockVisibility = (legacy: 'native' | 'dock' | undefined, visibility: StoredValue<boolean | null, null> = rightPaneVisibility): void => {
  if (visibility.get() === null) visibility.set(legacy === 'dock')
}
