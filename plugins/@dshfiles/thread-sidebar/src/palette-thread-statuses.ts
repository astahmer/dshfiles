import type { PaletteThreadStatus, PaletteThreadStatusSource } from '@dshfiles/command-palette/palette-contract'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { ThreadWorkStatus, ThreadWorkStatusSnapshot, ThreadWorkStatusSource } from './thread-status-client.js'

/** The list's six words, by status. */
export const STATUS_WORD_KEYS = {
  'needs-you': 'threadSidebarStateNeedsYou',
  failed: 'threadSidebarStateFailed',
  working: 'threadSidebarStateWorking',
  ready: 'threadSidebarStateReady',
  idle: 'threadSidebarStateIdle',
  done: 'threadSidebarStateDone',
} as const satisfies Record<WorkStatus, string>

/**
 * The palette's thread status source (command-palette's PaletteThreadStatuses): the list's projection with each status's
 * word, rebuilt only when the projection changes, so the palette re-renders once per change and a palette row and a list
 * row never disagree (F7, DESIGN.md R2). An attention thread also carries its kind (Approval, Question, Turn failed), so
 * the palette says the word the row does (council round 15 B3).
 */
const paletteStatusOf = (entry: ThreadWorkStatus, label: (status: WorkStatus) => string): PaletteThreadStatus =>
  entry.kind === undefined ? { status: entry.status, label: label(entry.status) } : { status: entry.status, label: label(entry.status), kind: entry.kind }

const sourceOf = (store: ThreadWorkStatusSource, label: (status: WorkStatus) => string): PaletteThreadStatusSource => {
  let input: ThreadWorkStatusSnapshot | null = null
  let output: ReadonlyMap<string, PaletteThreadStatus> | null = null
  return {
    getSnapshot: () => {
      const next = store.getSnapshot()
      if (next === input) return output
      input = next
      output = next === null ? null : new Map([...next].map(([sessionId, entry]): [string, PaletteThreadStatus] => [sessionId, paletteStatusOf(entry, label)]))
      return output
    },
    subscribe: store.subscribe,
  }
}

export const PaletteThreadStatusesModel = { sourceOf }
