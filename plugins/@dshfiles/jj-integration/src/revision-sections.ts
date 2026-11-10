/**
 * Sections other plugins add to a revision's details in the jj panel. Published as the
 * `@dshfiles/jj-integration/revision-sections` dshx module, so a contributor imports this token and none of the panel's
 * runtime; the panel renders whatever is registered, and nothing when no plugin adds a section.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

export interface RevisionSectionTarget {
  readonly repositoryRoot: string
  /** As `jj log` prints it: reverse hex (`k`–`z`). */
  readonly changeId: string
  readonly commitId: string
}

/** One section under a revision's details. Its id starts with the contributing package scope: `@scope/plugin/...`. */
export interface RevisionSection {
  readonly id: string
  readonly order?: number
  /** Renders `null` when it has nothing to show for this revision. */
  readonly Component: ComponentType<RevisionSectionTarget>
}

export const RevisionSections = defineRegistry<RevisionSection>('@dshfiles/jj-integration.revision-section')
