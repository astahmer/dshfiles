/**
 * The composer bar's More (⋯) menu (polish pass b:r4et), published as the `@dshfiles/rich-composer/composer-more` dshx
 * module. Undo, rewind, redo and saved prompts are occasional verbs, so they leave the always-visible bar and become
 * labelled rows of one menu the composer owns. A plugin adds rows with `api.add(ComposerMoreItems, …)`; each row is plain
 * data (every plugin bundles its own menu primitives, so the composer draws the rows itself) and `select` asks the
 * plugin's own composer control, which stays mounted, to open its popover or dialog.
 *
 * Each plugin keeps its own channel from `select` to its control (a map of listeners by Session id).
 *
 * `ComposerBar` says whether the user pinned those controls back into the bar (Settings › Composer, the
 * `showComposerExtras` setting): while pinned, plugins draw their buttons as before and the More menu hides. A consumer
 * whose composer owner is absent (pending contract) keeps its buttons in the bar.
 *
 * Imports no React and no provider: a plugin that adds a row depends on rich-composer, never the reverse
 * (docs/plugin-boundaries.md).
 */
import { defineContract, defineRegistry } from '@dshfiles/dshx/client'

export interface ComposerMoreItem {
  /** Unique across plugins: the providing package plus a verb (`@dshfiles/session-undo.undo`). */
  readonly id: string
  /** Lower first; rows from one plugin keep their group together. */
  readonly order?: number
  /** Rows with the same group sit together between separators (`history`, `prompts`). */
  readonly group?: string
  /** The row's words, sentence case ("Undo last turn"). */
  readonly label: string
  /** Keys that do the same outside the menu, shown at the row's end ("/prompts", "↑"). */
  readonly keys?: readonly string[]
  /** Read when the menu opens, for the composer of `sessionId`; false shows the row disabled. Absent: always available. */
  readonly available?: (sessionId: string) => boolean
  /**
   * Run the verb in the composer of `sessionId`. Called once the menu has closed and unmounted, so a popover or dialog
   * it opens keeps focus and stays open; no extra deferral is needed.
   */
  readonly select: (sessionId: string) => void
}

export const ComposerMoreItems = defineRegistry<ComposerMoreItem>('@dshfiles/rich-composer.composer-more-item')

export interface ComposerBarPlacement {
  /** True while the user keeps undo, history and saved prompts in the bar (the `showComposerExtras` setting). */
  readonly pinned: () => boolean
  readonly subscribe: (listener: () => void) => () => void
}

export const ComposerBar = defineContract<ComposerBarPlacement>('@dshfiles/rich-composer.composer-bar', { owner: '@dshfiles/rich-composer' })
