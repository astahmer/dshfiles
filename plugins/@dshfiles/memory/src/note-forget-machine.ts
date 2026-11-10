import { ListSelectionModel, type ListSelection } from '@dshfiles/plugin-ui/hooks/list-selection'
import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { NoteSelectionModel, type BatchForgetOutcome } from './note-selection.js'

/** The outcome the dialog explains; the tab owns the copy. */
export type ForgetFailure =
  | { readonly kind: 'partial'; readonly forgotten: number; readonly failed: number }
  | { readonly kind: 'error'; readonly error: unknown }

export interface NoteForgetInput {
  readonly forget: (input: { readonly id: number; readonly reason: string }) => Promise<void>
  /** Reload the notes and their counts once the Host answered. */
  readonly refresh: () => void
}

interface NoteForgetContext extends NoteForgetInput {
  readonly selection: ListSelection<number>
  /** Ids captured when the confirmation opened; a reason edit cannot widen the batch. */
  readonly targetIds: readonly number[]
  readonly reason: string
  readonly failure: ForgetFailure | null
}

type NoteForgetEvent =
  | { readonly type: 'visible'; readonly ids: readonly number[] }
  | { readonly type: 'select.toggle'; readonly id: number }
  | { readonly type: 'select.extend'; readonly id: number; readonly orderedIds: readonly number[] }
  | { readonly type: 'select.all'; readonly orderedIds: readonly number[] }
  | { readonly type: 'select.clear' }
  | { readonly type: 'select.mode'; readonly on: boolean }
  | { readonly type: 'forget.ask' }
  | { readonly type: 'forget.reason'; readonly reason: string }
  | { readonly type: 'forget.cancel' }
  | { readonly type: 'forget.confirm' }
  | { readonly type: 'xstate.done.actor.forget'; readonly output: BatchForgetOutcome }
  | { readonly type: 'xstate.error.actor.forget'; readonly error: unknown }

// SAFETY: XState uses empty carriers for inference; runtime input and events are typed above.
export const noteForgetMachine = setup({
  types: {
    context: {} as NoteForgetContext,
    events: {} as NoteForgetEvent,
    input: {} as NoteForgetInput,
  },
  actors: {
    forget: fromPromise<BatchForgetOutcome, { readonly ids: readonly number[]; readonly reason: string; readonly forget: NoteForgetInput['forget'] }>(
      ({ input }) => NoteSelectionModel.forget({ ids: input.ids, reason: input.reason, forget: input.forget }),
    ),
  },
  actions: {
    pruneSelection: assign(({ context, event }) => {
      if (event.type !== 'visible') return {}
      const next = ListSelectionModel.prune({ state: context.selection, visibleIds: event.ids })
      return next.ids.length === context.selection.ids.length && next.anchorId === context.selection.anchorId ? {} : { selection: next }
    }),
    toggleSelection: assign(({ context, event }) =>
      event.type === 'select.toggle' ? { selection: ListSelectionModel.toggle({ state: context.selection, id: event.id }) } : {},
    ),
    extendSelection: assign(({ context, event }) =>
      event.type === 'select.extend' ? { selection: ListSelectionModel.extend({ state: context.selection, orderedIds: event.orderedIds, id: event.id }) } : {},
    ),
    toggleAllSelection: assign(({ context, event }) =>
      event.type === 'select.all' ? { selection: ListSelectionModel.toggleAllVisible({ state: context.selection, orderedIds: event.orderedIds }) } : {},
    ),
    clearSelection: assign({ selection: ListSelectionModel.empty<number>() }),
    captureTargets: assign(({ context }) => ({ targetIds: [...context.selection.ids], reason: '', failure: null })),
    setReason: assign(({ event }) => (event.type === 'forget.reason' ? { reason: event.reason } : {})),
    clearTargets: assign({ targetIds: [], failure: null }),
    recordForgetFailure: assign(({ event }) => (event.type === 'xstate.error.actor.forget' ? { failure: { kind: 'error', error: event.error } } : {})),
    keepFailedSelection: assign(({ event }) => {
      if (event.type !== 'xstate.done.actor.forget') return {}
      const failed = event.output.failed
      return {
        selection: { ids: failed, anchorId: failed[0] },
        targetIds: failed,
        failure: { kind: 'partial', forgotten: event.output.forgotten.length, failed: failed.length } satisfies ForgetFailure,
      }
    }),
    clearForgottenSelection: assign({ selection: ListSelectionModel.empty<number>(), targetIds: [], failure: null }),
    refreshNotes: ({ context }) => context.refresh(),
  },
  guards: {
    hasSelection: ({ context }) => context.selection.ids.length > 0,
    hasTargets: ({ context }) => context.targetIds.length > 0,
    forgotEverything: ({ event }) => event.type === 'xstate.done.actor.forget' && event.output.failed.length === 0,
  },
}).createMachine({
  id: 'noteForget',
  initial: 'browsing',
  context: ({ input }) => ({ ...input, selection: ListSelectionModel.empty<number>(), targetIds: [], reason: '', failure: null }),
  on: {
    visible: { actions: 'pruneSelection' },
    'select.toggle': { actions: 'toggleSelection' },
    'select.extend': { actions: 'extendSelection' },
    'select.mode': [
      { guard: ({ event }) => event.on, target: '#noteForget.selecting' },
      { target: '#noteForget.browsing', actions: 'clearSelection' },
    ],
    'select.clear': { actions: 'clearSelection' },
  },
  states: {
    browsing: {
      on: {
        'select.toggle': { target: '#noteForget.selecting', actions: 'toggleSelection' },
        'select.all': { target: '#noteForget.selecting', actions: 'toggleAllSelection' },
      },
    },
    selecting: {
      on: {
        'select.all': { actions: 'toggleAllSelection' },
        'forget.ask': { target: 'confirming', guard: 'hasSelection', actions: 'captureTargets' },
      },
    },
    confirming: {
      on: {
        'forget.reason': { actions: 'setReason' },
        'forget.ask': { guard: 'hasSelection', actions: 'captureTargets' },
        'forget.cancel': { target: 'selecting', actions: ['clearTargets'] },
        'forget.confirm': { target: 'forgetting', guard: 'hasTargets' },
      },
    },
    forgetting: {
      invoke: {
        id: 'forget',
        src: 'forget',
        input: ({ context }) => ({ ids: context.targetIds, reason: context.reason, forget: context.forget }),
        onDone: [
          { guard: 'forgotEverything', target: 'selecting', actions: ['clearForgottenSelection', 'refreshNotes'] },
          { target: 'confirming', actions: ['keepFailedSelection', 'refreshNotes'] },
        ],
        onError: { target: 'confirming', actions: ['recordForgetFailure'] },
      },
    },
  },
})
