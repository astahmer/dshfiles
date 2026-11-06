import type { BacklogSyncBindingView, BacklogSyncStatusView } from './api.js'
import { BacklogItems } from './item.js'

/** What a batch remote create reads from one selected item. */
export interface SyncBatchItem {
  readonly id: number
  readonly project: string | null
}

/** One binding and the selected items that have no remote item through it yet. */
export interface SyncBatchTarget {
  readonly view: BacklogSyncBindingView
  readonly itemIds: readonly number[]
}

/** What one batch run did: how many items it asked for, and which of them failed with what. */
export interface SyncBatchRun {
  readonly label: string
  readonly total: number
  readonly failures: readonly string[]
}

/** The one notice a batch run leaves. */
export interface SyncBatchNotice {
  readonly text: string
  readonly kind: 'success' | 'failure'
}

export class SyncBatch {
  /** The bindings an item can link through: enabled, run here, and scoped to its project or to every project. */
  static readonly bindingsFor = (status: BacklogSyncStatusView | undefined, project: string | null | undefined): readonly BacklogSyncBindingView[] =>
    (status?.bindings ?? []).filter(
      view =>
        view.binding.enabled &&
        view.owned &&
        (view.binding.scope === null || project === undefined || (project !== null && view.binding.scope === BacklogItems.projectPath(project))),
    )

  /** The bindings that can still create an item for at least one selection member, with those items. */
  static readonly targets = (input: {
    readonly status: BacklogSyncStatusView | undefined
    readonly items: readonly SyncBatchItem[]
  }): readonly SyncBatchTarget[] => {
    const linked = input.status?.items ?? []
    return (input.status?.bindings ?? []).flatMap(view => {
      const itemIds = input.items
        .filter(item => SyncBatch.bindingsFor(input.status, item.project).some(candidate => candidate.binding.id === view.binding.id))
        .filter(item => !linked.some(entry => entry.itemId === item.id && entry.bindingId === view.binding.id))
        .map(item => item.id)
      return itemIds.length === 0 ? [] : [{ view, itemIds }]
    })
  }

  /** The one notice a batch run leaves: what was created, and where to retry the rest. */
  static readonly notice = (run: SyncBatchRun): SyncBatchNotice => {
    const created = run.total - run.failures.length
    if (run.failures.length === 0) return { text: `Created ${String(created)} remote ${run.total === 1 ? 'item' : 'items'} in ${run.label}.`, kind: 'success' }
    return {
      text: `Created ${String(created)} of ${String(run.total)} remote items in ${run.label}; ${run.failures[0] ?? ''} Retry that item from its own menu.`,
      kind: 'failure',
    }
  }
}
