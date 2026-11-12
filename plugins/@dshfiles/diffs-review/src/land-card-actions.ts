/**
 * Verbs other plugins add beside Land on the Changes facet's Land card, such as pull-requests' **Open PR**.
 *
 * Published as the `@dshfiles/diffs-review/land-card-actions` dshx module: a provider depends on diffs-review, never the
 * reverse (docs/plugin-boundaries.md). Without a provider the card shows Land alone.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

export interface LandCardActionProps {
  readonly sessionId: string
  /** The thread workspace the card reads. */
  readonly cwd: string
  /** The bookmark Land advances. */
  readonly bookmark: string
  /** Revisions not yet on the bookmark; 0 means there is nothing to land or publish. */
  readonly unlanded: number
  /** Whether the revisions block a land (conflicts or missing descriptions), so a provider can say the same. */
  readonly blocked: boolean
  readonly threadTitle: string | undefined
}

export interface LandCardAction {
  /** The providing package; the card keeps the first action per id. */
  readonly id: string
  /** Lower first, after Land. */
  readonly order?: number
  /** Bind it with `plugin.bind(...)` so its hooks read the providing plugin's context. */
  readonly component: ComponentType<LandCardActionProps>
}

/** Providers contribute with `plugin.add(LandCardActions, { id, component: plugin.bind(View) })`. */
export const LandCardActions = defineRegistry<LandCardAction>('@dshfiles/diffs-review.land-card-action')

/** One action per id (the first wins), sorted by order, then registration order. */
export const arrangeLandCardActions = (actions: readonly LandCardAction[]): readonly LandCardAction[] => {
  const seen = new Set<string>()
  return actions
    .map((action, index) => ({ action, index }))
    .filter(entry => {
      if (seen.has(entry.action.id)) return false
      seen.add(entry.action.id)
      return true
    })
    .sort((left, right) => (left.action.order ?? 0) - (right.action.order ?? 0) || left.index - right.index)
    .map(entry => entry.action)
}
