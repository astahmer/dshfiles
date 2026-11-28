/**
 * Sections other plugins add to the thread header's workspace menu, under its status line. Published as the
 * `@dshfiles/jj-integration/workspace-menu-sections` dshx module: a contributor depends on jj-integration, never the
 * reverse (docs/plugin-boundaries.md). The menu renders whatever is registered, and nothing when no plugin adds one.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

export interface WorkspaceMenuSectionProps {
  readonly sessionId: string
  /** Whether the thread edits its own workspace; false in the project checkout, which every thread there shares. */
  readonly ownWorkspace: boolean
  /** Closes the menu, for a row that opens another view. */
  readonly dismiss: () => void
}

/** One section of the workspace menu. Its id starts with the contributing package scope: `@scope/plugin/...`. */
export interface WorkspaceMenuSection {
  readonly id: string
  /** Lower first. */
  readonly order?: number
  /** Bind it with `plugin.bind(...)` so its hooks read the providing plugin's context. Renders `null` when it has nothing to say. */
  readonly Component: ComponentType<WorkspaceMenuSectionProps>
}

export const WorkspaceMenuSections = defineRegistry<WorkspaceMenuSection>('@dshfiles/jj-integration.workspace-menu-section')

/** One section per id (the first wins), sorted by order, then registration order. */
export const arrangeWorkspaceMenuSections = (sections: readonly WorkspaceMenuSection[]): readonly WorkspaceMenuSection[] => {
  const seen = new Set<string>()
  return sections
    .map((section, index) => ({ section, index }))
    .filter(entry => {
      if (seen.has(entry.section.id)) return false
      seen.add(entry.section.id)
      return true
    })
    .sort((left, right) => (left.section.order ?? 0) - (right.section.order ?? 0) || left.index - right.index)
    .map(entry => entry.section)
}
