import { defineRegistry } from '@dshfiles/dshx/client'

/**
 * A tool whose calls are the Turn's deliverable (a rendered page, a chart), so Chat keeps them visible after the Turn
 * completes: outside the "Completed in" fold and the step groups, in every work-details mode. Add one with
 * `api.add(PinnedToolCalls, { toolName })`; without providers Chat folds every call as before.
 */
export interface PinnedToolCall {
  readonly toolName: string
}

export const PinnedToolCalls = defineRegistry<PinnedToolCall>('@dshfiles/chat.pinned-tool-call')
