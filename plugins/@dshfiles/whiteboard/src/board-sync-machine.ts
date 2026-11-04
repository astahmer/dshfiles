import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { BoardSummary, Scene } from './model.js'

/** How long the canvas must stay still before an edit is saved. */
export const SAVE_DEBOUNCE_MS = 800

export interface SaveRequest {
  readonly boardId: string
  readonly expectedRevision: number
  readonly scene: Scene
  readonly clearPending: boolean
}

/** A save the Host refused because another writer (an agent, another tab) saved first. */
export class SaveConflict extends Error {
  override readonly name = 'SaveConflict'
  constructor(readonly currentRevision: number) {
    super('This whiteboard changed elsewhere.')
  }
}

export type SaveBoard = (request: SaveRequest, signal: AbortSignal) => Promise<BoardSummary>

interface SyncContext {
  readonly boardId: string
  readonly save: SaveBoard
  readonly revision: number
  readonly scene: Scene | null
  readonly clearPending: boolean
  readonly editedWhileSaving: boolean
  readonly conflictRevision: number | null
  readonly error: string | null
}

interface SyncInput {
  readonly boardId: string
  readonly revision: number
  readonly save: SaveBoard
}

interface SavedEvent {
  readonly type: 'saved'
  readonly board: BoardSummary
}

type SyncEvent =
  | { readonly type: 'EDIT'; readonly scene: Scene }
  | { readonly type: 'CONVERTED'; readonly scene: Scene }
  | { readonly type: 'FLUSH' }
  | { readonly type: 'RETRY' }
  | { readonly type: 'OVERWRITE' }
  | { readonly type: 'SYNCED'; readonly revision: number }

const failureMessage = (error: unknown): string => (error instanceof Error ? error.message : 'The whiteboard could not be saved.')

/**
 * Autosave for one open board: edits settle for {@link SAVE_DEBOUNCE_MS}, then one revision-checked save runs.
 * Edits during a save queue the next one. A stale revision parks the board in `conflict` until the user reloads
 * the newer version (`SYNCED`) or overwrites it with theirs (`OVERWRITE`); any other failure waits in `failed`
 * for `RETRY` or the next edit. Data stays in Query; this machine only owns the save flow.
 */
export const boardSyncMachine = setup({
  types: {
    context: {} as SyncContext,
    events: {} as SyncEvent,
    input: {} as SyncInput,
    emitted: {} as SavedEvent,
  },
  actors: {
    save: fromPromise<BoardSummary, SaveRequest & { readonly save: SaveBoard }>(({ input, signal }) => input.save(input, signal)),
  },
  actions: {
    keepEdit: assign(({ event }) => (event.type === 'EDIT' || event.type === 'CONVERTED' ? { scene: event.scene, error: null } : {})),
    keepConversion: assign({ clearPending: true }),
  },
  guards: {
    editedWhileSaving: ({ context }) => context.editedWhileSaving,
    isConflict: ({ event }) => 'error' in event && event.error instanceof SaveConflict,
  },
}).createMachine({
  id: 'boardSync',
  context: ({ input }) => ({
    boardId: input.boardId,
    save: input.save,
    revision: input.revision,
    scene: null,
    clearPending: false,
    editedWhileSaving: false,
    conflictRevision: null,
    error: null,
  }),
  initial: 'clean',
  on: {
    SYNCED: { target: '.clean', actions: assign(({ event }) => ({ revision: event.revision, scene: null, conflictRevision: null, error: null })) },
  },
  states: {
    clean: {
      on: {
        EDIT: { target: 'dirty', actions: 'keepEdit' },
        CONVERTED: { target: 'saving', actions: ['keepEdit', 'keepConversion'] },
      },
    },
    dirty: {
      after: { [SAVE_DEBOUNCE_MS]: 'saving' },
      on: {
        EDIT: { target: 'dirty', reenter: true, actions: 'keepEdit' },
        CONVERTED: { target: 'saving', actions: ['keepEdit', 'keepConversion'] },
        FLUSH: 'saving',
      },
    },
    saving: {
      entry: assign({ editedWhileSaving: false }),
      invoke: {
        src: 'save',
        input: ({ context }) => ({
          save: context.save,
          boardId: context.boardId,
          expectedRevision: context.revision,
          // SAFETY: every transition into `saving` first stores the scene to save.
          scene: context.scene ?? { elements: [], appState: {}, files: {} },
          clearPending: context.clearPending,
        }),
        onDone: [
          {
            guard: 'editedWhileSaving',
            target: 'dirty',
            actions: [
              assign(({ event }) => ({ revision: event.output.revision, clearPending: false })),
              emit(({ event }) => ({ type: 'saved', board: event.output })),
            ],
          },
          {
            target: 'clean',
            actions: [
              assign(({ event }) => ({ revision: event.output.revision, scene: null, clearPending: false })),
              emit(({ event }) => ({ type: 'saved', board: event.output })),
            ],
          },
        ],
        onError: [
          {
            guard: 'isConflict',
            target: 'conflict',
            actions: assign(({ event }) => ({ conflictRevision: event.error instanceof SaveConflict ? event.error.currentRevision : null })),
          },
          { target: 'failed', actions: assign(({ event }) => ({ error: failureMessage(event.error) })) },
        ],
      },
      on: {
        EDIT: { actions: ['keepEdit', assign({ editedWhileSaving: true })] },
        CONVERTED: { actions: ['keepEdit', 'keepConversion', assign({ editedWhileSaving: true })] },
      },
    },
    conflict: {
      on: {
        EDIT: { actions: 'keepEdit' },
        OVERWRITE: { target: 'saving', actions: assign(({ context }) => ({ revision: context.conflictRevision ?? context.revision, conflictRevision: null })) },
      },
    },
    failed: {
      on: {
        EDIT: { target: 'dirty', actions: 'keepEdit' },
        CONVERTED: { target: 'saving', actions: ['keepEdit', 'keepConversion'] },
        RETRY: 'saving',
        FLUSH: 'saving',
      },
    },
  },
})
