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
  /** Retire a disposable chooser, preserving live views for reopening. */
  readonly close: (panel: WorkbenchPanelIdentity) => void
}

export const createDockPaneActions = (visibility: StoredValue<boolean | null, null>, contents: RightPaneContents): DockPaneActions => {
  const close = () => {
    if (visibility.get() === true) {
      const panels = contents.panels()
      const only = panels.length === 1 ? panels[0] : undefined
      if (only !== undefined) contents.close(only)
    }
    visibility.set(false)
  }
  return {
    isOpen: () => visibility.get() === true,
    open: () => visibility.set(true),
    close,
    toggle: () => {
      if (visibility.get() === true) {
        close()
        return
      }
      visibility.set(true)
    },
    subscribe: visibility.subscribe,
  }
}

/** Migrate once; a deliberate new close must never be overridden by an old `dock` setting. */
export const migrateDockVisibility = (legacy: 'native' | 'dock' | undefined, visibility: StoredValue<boolean | null, null> = rightPaneVisibility): void => {
  if (visibility.get() === null) visibility.set(legacy === 'dock')
}
