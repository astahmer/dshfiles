/**
 * Rows other plugins add to a thread's context menu in the sidebar. Published as the
 * `@dshfiles/thread-sidebar/thread-row-actions` dshx module, so a contributor imports this token and none of the
 * sidebar's runtime; the sidebar renders whatever is registered, and nothing when no plugin adds a row.
 */
import { defineRegistry } from '@dshfiles/dshx/client'

export interface ThreadRowActionTarget {
  readonly sessionId: string
  readonly workspaceId: string | undefined
  readonly archived: boolean
  readonly running: boolean
}

/** One context-menu row. Its id starts with the contributing package scope: `@scope/plugin/...`. */
export interface ThreadRowAction {
  readonly id: string
  readonly label: string | (() => string)
  readonly order?: number
  /** Hide the row for this thread; shown when omitted. */
  readonly isAvailable?: (target: ThreadRowActionTarget) => boolean
  readonly run: (target: ThreadRowActionTarget) => void
}

export const ThreadRowActions = defineRegistry<ThreadRowAction>('@dshfiles/thread-sidebar.row-action')
