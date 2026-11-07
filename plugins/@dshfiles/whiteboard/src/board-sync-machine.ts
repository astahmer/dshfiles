import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { EditorHandle } from './editor-contract.js'
import type { Board, BoardSummary, PendingSource, Scene } from './model.js'

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
export type ReadBoard = (boardId: string, signal: AbortSignal) => Promise<Board>
/** Convert agent-queued source in the browser and append it to the live canvas. */
export type ConvertPending = (input: { readonly editor: EditorHandle; readonly pending: PendingSource }) => Promise<Scene>

interface SyncContext {
  readonly boardId: string
  readonly save: SaveBoard
  readonly read: ReadBoard
  readonly convert: ConvertPending
  readonly revision: number
  readonly scene: Scene | null
  readonly clearPending: boolean
  readonly editedWhileSaving: boolean
  readonly conflictRevision: number | null
  readonly error: string | null
  readonly editor: EditorHandle | null
  readonly pending: PendingSource | null
  readonly attemptedPending: PendingSource | null
  readonly conversionError: string | null
  readonly leaving: boolean
  readonly remoteRevision: number | null
}

export interface SyncInput {
  readonly boardId: string
  readonly revision: number
  readonly pending: PendingSource | null
  readonly save: SaveBoard
  readonly read: ReadBoard
  readonly convert: ConvertPending
}

interface SavedEvent {
  readonly type: 'saved'
  readonly board: BoardSummary
}

interface AdoptedEvent {
  readonly type: 'adopted'
  readonly title: string
}

type SyncEmitted = SavedEvent | AdoptedEvent | { readonly type: 'left' } | { readonly type: 'leaveBlocked' }

type SyncEvent =
  | { readonly type: 'EDIT'; readonly scene: Scene }
  | { readonly type: 'FLUSH' }
  | { readonly type: 'RETRY' }
  | { readonly type: 'OVERWRITE' }
  | { readonly type: 'SYNCED'; readonly revision: number }
  | { readonly type: 'EDITOR_READY'; readonly editor: EditorHandle }
  | { readonly type: 'REMOTE_REVISION'; readonly revision: number }
  | { readonly type: 'RELOAD' }
  | { readonly type: 'DISCARD_PENDING' }
  | { readonly type: 'LEAVE' }

const failureMessage = (error: unknown): string => (error instanceof Error ? error.message : 'The whiteboard could not be saved.')

const conversionFailureMessage = (error: unknown): string => (error instanceof Error ? error.message : 'The queued diagram could not be converted.')

/**
 * Autosave for one open board: edits settle for {@link SAVE_DEBOUNCE_MS}, then one revision-checked save runs.
 * Edits during a save queue the next one. A stale revision parks the board in `conflict` until the user loads the
 * newer version (`RELOAD`) or overwrites it with theirs (`OVERWRITE`); any other failure waits in `failed`
 * for `RETRY` or the next edit. `SYNCED` records a revision a rename advanced to, and never discards an edit that is
 * still waiting for its save. The queued agent source converts once the editor is ready (`converting`), a newer
 * remote revision is adopted while nothing local is unsaved (`adopting`), and leaving flushes the last edit before
 * the component hears `left`. Data stays in Query; this machine only owns the save, conversion, adopt and leave flows.
 */
export const boardSyncMachine = setup({
  types: {
    context: {} as SyncContext,
    events: {} as SyncEvent,
    input: {} as SyncInput,
    emitted: {} as SyncEmitted,
  },
  actors: {
    save: fromPromise<BoardSummary, SaveRequest & { readonly save: SaveBoard }>(({ input, signal }) => input.save(input, signal)),
    readBoard: fromPromise<Board, { readonly read: ReadBoard; readonly boardId: string }>(({ input, signal }) => input.read(input.boardId, signal)),
    convertPending: fromPromise<Scene, { readonly convert: ConvertPending; readonly editor: EditorHandle | null; readonly pending: PendingSource | null }>(
      async ({ input }) => {
        const editor = input.editor
        const pending = input.pending
        if (editor === null || pending === null) throw new Error('The queued diagram needs a ready editor.')
        return input.convert({ editor, pending })
      },
    ),
  },
  actions: {
    keepEdit: assign(({ event }) => (event.type === 'EDIT' ? { scene: event.scene, error: null } : {})),
    captureEditor: assign(({ event }) => (event.type === 'EDITOR_READY' ? { editor: event.editor } : {})),
    keepRemoteRevision: assign(({ event }) => (event.type === 'REMOTE_REVISION' ? { remoteRevision: event.revision } : {})),
    requestLeave: assign({ leaving: true }),
    clearLeaving: assign({ leaving: false }),
    finishSaveClean: assign(({ context }) => ({ scene: null, clearPending: false, pending: context.clearPending ? null : context.pending })),
    finishSaveDirty: assign(({ context }) => ({ clearPending: false, pending: context.clearPending ? null : context.pending })),
    markConversionFailed: assign(({ context, event }) => ({
      conversionError: conversionFailureMessage('error' in event ? event.error : undefined),
      attemptedPending: context.pending,
    })),
    discardPending: assign(({ context }) => ({
      scene: context.editor?.scene() ?? null,
      clearPending: true,
      conversionError: null,
      attemptedPending: context.pending,
    })),
  },
  guards: {
    editedWhileSaving: ({ context }) => context.editedWhileSaving,
    isConflict: ({ event }) => 'error' in event && event.error instanceof SaveConflict,
    leavingRequested: ({ context }) => context.leaving,
    hasScene: ({ context }) => context.scene !== null,
    canAdopt: ({ context }) => context.editor !== null && context.remoteRevision !== null && context.remoteRevision > context.revision,
    canConvert: ({ context }) => context.editor !== null && context.pending !== null && context.attemptedPending !== context.pending,
    canDiscard: ({ context }) => context.editor !== null,
  },
}).createMachine({
  id: 'boardSync',
  context: ({ input }) => ({
    boardId: input.boardId,
    save: input.save,
    read: input.read,
    convert: input.convert,
    revision: input.revision,
    scene: null,
    clearPending: false,
    editedWhileSaving: false,
    conflictRevision: null,
    error: null,
    editor: null,
    pending: input.pending,
    attemptedPending: null,
    conversionError: null,
    leaving: false,
    remoteRevision: null,
  }),
  initial: 'clean',
  on: {
    // `SYNCED` is the rename response. An edit made while the rename was in flight still waits for its save, so with a
    // scene in hand only the revision advances and the current state keeps its own save, conflict or conversion flow.
    SYNCED: [
      { guard: 'hasScene', actions: assign(({ event }) => ({ revision: event.revision, conflictRevision: null, error: null })) },
      { target: '.clean', actions: assign(({ event }) => ({ revision: event.revision, scene: null, conflictRevision: null, error: null })) },
    ],
    REMOTE_REVISION: { actions: 'keepRemoteRevision' },
    EDITOR_READY: { actions: 'captureEditor' },
    DISCARD_PENDING: { guard: 'canDiscard', target: '.saving', actions: 'discardPending' },
  },
  states: {
    clean: {
      always: [
        { guard: 'leavingRequested', actions: [emit({ type: 'left' }), 'clearLeaving'] },
        { guard: 'canAdopt', target: 'adopting' },
        { guard: 'canConvert', target: 'converting' },
      ],
      on: {
        EDIT: { target: 'dirty', actions: 'keepEdit' },
        LEAVE: { actions: emit({ type: 'left' }) },
      },
    },
    dirty: {
      always: [{ guard: 'canConvert', target: 'converting' }],
      after: { [SAVE_DEBOUNCE_MS]: 'saving' },
      on: {
        EDIT: { target: 'dirty', reenter: true, actions: 'keepEdit' },
        FLUSH: 'saving',
        LEAVE: { target: 'saving', actions: 'requestLeave' },
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
              assign(({ event }) => ({ revision: event.output.revision })),
              'finishSaveDirty',
              emit(({ event }) => ({ type: 'saved', board: event.output })),
            ],
          },
          {
            target: 'clean',
            actions: [
              assign(({ event }) => ({ revision: event.output.revision })),
              'finishSaveClean',
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
        LEAVE: { actions: 'requestLeave' },
      },
    },
    adopting: {
      invoke: {
        src: 'readBoard',
        input: ({ context }) => ({ read: context.read, boardId: context.boardId }),
        onDone: [
          {
            guard: ({ event }) => event.output.pending !== null,
            target: 'converting',
            actions: [
              assign(({ event }) => ({
                revision: event.output.board.revision,
                scene: null,
                pending: event.output.pending,
                conflictRevision: null,
                error: null,
              })),
              ({ context, event }) => context.editor?.replaceScene(event.output.scene),
              emit(({ event }) => ({ type: 'adopted', title: event.output.board.title })),
            ],
          },
          {
            target: 'clean',
            actions: [
              assign(({ event }) => ({
                revision: event.output.board.revision,
                scene: null,
                pending: event.output.pending,
                conflictRevision: null,
                error: null,
              })),
              ({ context, event }) => context.editor?.replaceScene(event.output.scene),
              emit(({ event }) => ({ type: 'adopted', title: event.output.board.title })),
            ],
          },
        ],
        // A refused read must not loop: the same remote revision will not be adopted again until it changes.
        onError: { target: 'clean', actions: assign({ remoteRevision: null }) },
      },
      on: {
        EDIT: { target: 'dirty', actions: 'keepEdit' },
        LEAVE: { actions: 'requestLeave' },
      },
    },
    converting: {
      invoke: {
        src: 'convertPending',
        input: ({ context }) => ({ convert: context.convert, editor: context.editor, pending: context.pending }),
        onDone: { target: 'saving', actions: assign(({ event }) => ({ scene: event.output, clearPending: true, conversionError: null })) },
        onError: [
          { guard: 'hasScene', target: 'dirty', actions: 'markConversionFailed' },
          { target: 'clean', actions: 'markConversionFailed' },
        ],
      },
      on: {
        EDIT: { actions: 'keepEdit' },
        LEAVE: { actions: 'requestLeave' },
      },
    },
    conflict: {
      always: [{ guard: 'leavingRequested', actions: [emit({ type: 'leaveBlocked' }), 'clearLeaving'] }],
      on: {
        EDIT: { actions: 'keepEdit' },
        OVERWRITE: { target: 'saving', actions: assign(({ context }) => ({ revision: context.conflictRevision ?? context.revision, conflictRevision: null })) },
        RELOAD: { target: 'adopting' },
        LEAVE: { actions: emit({ type: 'leaveBlocked' }) },
      },
    },
    failed: {
      always: [{ guard: 'leavingRequested', actions: [emit({ type: 'leaveBlocked' }), 'clearLeaving'] }],
      on: {
        EDIT: { target: 'dirty', actions: 'keepEdit' },
        RETRY: 'saving',
        FLUSH: 'saving',
        LEAVE: { target: 'saving', actions: 'requestLeave' },
      },
    },
  },
})
