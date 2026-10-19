import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { listChildThreads, partitionFinishedChildren, type FinishedSubagentsMode } from './thread-children.js'

/** Stable empty lists: a parent without children keeps the same row arrays across renders. */
export const NO_CHILD_THREADS: readonly SessionSummary[] = []

export interface ThreadChildRow {
  /** Children this parent lists after the view filters; empty for the `main` source filter. */
  readonly listed: readonly SessionSummary[]
  readonly live: readonly SessionSummary[]
  readonly finished: readonly SessionSummary[]
  readonly selectedChildId: SessionSummary['id'] | undefined
}

export interface ThreadChildRowInputs {
  readonly children: readonly SessionSummary[]
  readonly groupedAttentionIds: ReadonlySet<string>
  /** False under the `main` source filter, which lists no child rows. */
  readonly listChildren: boolean
  readonly mode: FinishedSubagentsMode
  readonly waitingSessionIds: ReadonlySet<string>
  readonly selectedSessionId: SessionSummary['id'] | undefined
}

interface CacheEntry {
  readonly inputs: ThreadChildRowInputs
  readonly row: ThreadChildRow
}

const sameInputs = (left: ThreadChildRowInputs, right: ThreadChildRowInputs): boolean =>
  left.children === right.children &&
  left.groupedAttentionIds === right.groupedAttentionIds &&
  left.listChildren === right.listChildren &&
  left.mode === right.mode &&
  left.waitingSessionIds === right.waitingSessionIds &&
  left.selectedSessionId === right.selectedSessionId

const EMPTY_ROW: ThreadChildRow = { listed: NO_CHILD_THREADS, live: NO_CHILD_THREADS, finished: NO_CHILD_THREADS, selectedChildId: undefined }

const deriveRow = (inputs: ThreadChildRowInputs): ThreadChildRow => {
  if (!inputs.listChildren || inputs.children.length === 0) return EMPTY_ROW
  const listed = listChildThreads({ children: inputs.children, groupedAttentionIds: inputs.groupedAttentionIds })
  const selectedChildId =
    inputs.selectedSessionId !== undefined && listed.some(child => child.id === inputs.selectedSessionId) ? inputs.selectedSessionId : undefined
  const partition = partitionFinishedChildren({
    children: listed,
    mode: inputs.mode,
    isFinished: child => child.origin === 'subagent' && !child.running && !inputs.waitingSessionIds.has(child.id),
    selectedId: selectedChildId,
  })
  return { listed, live: partition.live, finished: partition.finished, selectedChildId }
}

export interface ThreadChildRowCache {
  /**
   * Derived child rows for one parent. The children array is the cache key because
   * the thread tree hands out a new array only when that parent's children moved,
   * so an untouched parent keeps the arrays its row already renders.
   */
  readonly resolve: (inputs: ThreadChildRowInputs) => ThreadChildRow
}

export const createThreadChildRowCache = (): ThreadChildRowCache => {
  const entries = new WeakMap<readonly SessionSummary[], CacheEntry>()
  return {
    resolve: inputs => {
      const cached = entries.get(inputs.children)
      if (cached !== undefined && sameInputs(cached.inputs, inputs)) return cached.row
      const row = deriveRow(inputs)
      entries.set(inputs.children, { inputs, row })
      return row
    },
  }
}
