import type { CleanupResult } from '@dshfiles/jj-integration/api'

type CleanupSkipReason = CleanupResult['skipped'][number]['reason']

const SKIP_LABELS = {
  'has-work': { singular: 'workspace with unlanded work', plural: 'workspaces with unlanded work' },
  busy: { singular: 'workspace with a working thread', plural: 'workspaces with a working thread' },
  'activity-unknown': { singular: 'workspace with unknown activity', plural: 'workspaces with unknown activity' },
  queued: { singular: 'workspace with an integration queued', plural: 'workspaces with integrations queued' },
  'too-recent': { singular: 'recently used workspace', plural: 'recently used workspaces' },
  'kind-excluded': { singular: 'workspace excluded by kind', plural: 'workspaces excluded by kind' },
  'working-copy-dirty': { singular: 'workspace with uncommitted changes', plural: 'workspaces with uncommitted changes' },
  'workspace-state-unknown': { singular: 'workspace with unverifiable state', plural: 'workspaces with unverifiable state' },
} satisfies Record<CleanupSkipReason, { readonly singular: string; readonly plural: string }>

const joinList = (items: readonly string[]): string => {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

export class WorkspaceCleanupSummary {
  static formatCount(count: number, singular: string, plural: string): string {
    return `${String(count)} ${count === 1 ? singular : plural}`
  }

  static resolveAgeHours(input: { readonly presetHours: number | null; readonly customHours: string }): number | undefined {
    if (input.presetHours !== null) return input.presetHours

    const customHours = Number(input.customHours)
    if (input.customHours.trim() === '' || !Number.isSafeInteger(customHours) || customHours < 1) return undefined
    return customHours
  }

  static format(input: { readonly emptyRevisionCount: number; readonly skippedReasons: readonly CleanupSkipReason[] }): string[] {
    const skippedCounts = new Map<CleanupSkipReason, number>()
    for (const reason of input.skippedReasons) skippedCounts.set(reason, (skippedCounts.get(reason) ?? 0) + 1)

    const skippedItems = [...skippedCounts].map(([reason, count]) =>
      WorkspaceCleanupSummary.formatCount(count, SKIP_LABELS[reason].singular, SKIP_LABELS[reason].plural),
    )

    return [
      `${WorkspaceCleanupSummary.formatCount(input.emptyRevisionCount, 'empty revision', 'empty revisions')} will be abandoned.`,
      ...(input.skippedReasons.length === 0
        ? []
        : [`Skipped ${WorkspaceCleanupSummary.formatCount(input.skippedReasons.length, 'workspace', 'workspaces')}: ${joinList(skippedItems)}.`]),
    ]
  }
}
