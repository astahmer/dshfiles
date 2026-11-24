import type { PaletteThreadStatus, PaletteThreadStatusSource } from '@dshfiles/command-palette/palette-contract'
import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import type { ThreadWorkStatusSnapshot, ThreadWorkStatusSource } from './thread-status-client.js'

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
 * row never disagree (F7, DESIGN.md R2).
 */
const sourceOf = (store: ThreadWorkStatusSource, label: (status: WorkStatus) => string): PaletteThreadStatusSource => {
  let input: ThreadWorkStatusSnapshot | null = null
  let output: ReadonlyMap<string, PaletteThreadStatus> | null = null
  return {
    getSnapshot: () => {
      const next = store.getSnapshot()
      if (next === input) return output
      input = next
      output = next === null ? null : new Map([...next].map(([sessionId, entry]) => [sessionId, { status: entry.status, label: label(entry.status) }]))
      return output
    },
    subscribe: store.subscribe,
  }
}

export const PaletteThreadStatusesModel = { sourceOf }
