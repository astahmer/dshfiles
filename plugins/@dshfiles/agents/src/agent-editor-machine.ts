import { assign, emit, setup } from '@dshfiles/plugin-ui/machine'

import type { Agent, AgentDraft } from './agent.js'

/**
 * Which agent the page edits, and the one dialog that may stand between the person and it.
 *
 * Leaving a dirty editor asks first, so the page is either editing (with at most one dialog open: remove or start)
 * or confirming that leave. The three nullable dialog states this replaces let a remove dialog and a start dialog be
 * open at once, and let a navigation pending from a third one apply over either.
 */

export type AgentEditorSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'agent'; readonly handle: string }
  | { readonly kind: 'new'; readonly base: AgentDraft }

export type AgentEditorModal =
  | { readonly kind: 'none' }
  | { readonly kind: 'remove'; readonly agent: Agent }
  | { readonly kind: 'start'; readonly agent: Agent; readonly pending: boolean; readonly error: string | null }

interface AgentEditorContext {
  selection: AgentEditorSelection
  modal: AgentEditorModal
  /** Where a dirty editor goes once its edits are discarded. */
  leavingTo: AgentEditorSelection | null
}

type AgentEditorEvent =
  | { readonly type: 'OPEN'; readonly selection: AgentEditorSelection; readonly dirty: boolean }
  | { readonly type: 'APPLY'; readonly selection: AgentEditorSelection }
  | { readonly type: 'KEEP_EDITING' }
  | { readonly type: 'DISCARD' }
  | { readonly type: 'ASK_REMOVE'; readonly agent: Agent }
  | { readonly type: 'CANCEL_REMOVE' }
  | { readonly type: 'ASK_START'; readonly agent: Agent }
  | { readonly type: 'CLOSE_START' }
  | { readonly type: 'START_PENDING' }
  | { readonly type: 'START_FAILED'; readonly message: string }
  | { readonly type: 'STARTED' }

interface SelectionApplied {
  readonly type: 'applied'
  readonly selection: AgentEditorSelection
}

const NONE: AgentEditorSelection = { kind: 'none' }

const selectionOf = (event: AgentEditorEvent): AgentEditorSelection | null => (event.type === 'OPEN' || event.type === 'APPLY' ? event.selection : null)

// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const agentEditorMachine = setup({
  types: { context: {} as AgentEditorContext, events: {} as AgentEditorEvent, emitted: {} as SelectionApplied },
  guards: {
    dirty: ({ event }) => event.type === 'OPEN' && event.dirty,
    starting: ({ context }) => context.modal.kind === 'start',
    selected: ({ context }) => context.leavingTo !== null,
  },
  actions: {
    applySelection: assign(({ event }): Partial<AgentEditorContext> => {
      const selection = selectionOf(event)
      return selection === null ? {} : { selection, modal: { kind: 'none' }, leavingTo: null }
    }),
    rememberTarget: assign(({ event }): Partial<AgentEditorContext> => (event.type === 'OPEN' ? { leavingTo: event.selection } : {})),
    leaveSelection: assign(({ context }): Partial<AgentEditorContext> =>
      context.leavingTo === null ? {} : { selection: context.leavingTo, modal: { kind: 'none' }, leavingTo: null },
    ),
    keepEditing: assign((): Partial<AgentEditorContext> => ({ leavingTo: null })),
    askRemove: assign(({ event }): Partial<AgentEditorContext> => (event.type === 'ASK_REMOVE' ? { modal: { kind: 'remove', agent: event.agent } } : {})),
    askStart: assign(({ event }): Partial<AgentEditorContext> =>
      event.type === 'ASK_START' ? { modal: { kind: 'start', agent: event.agent, pending: false, error: null } } : {},
    ),
    clearModal: assign((): Partial<AgentEditorContext> => ({ modal: { kind: 'none' } })),
    startPending: assign(({ context }): Partial<AgentEditorContext> =>
      context.modal.kind === 'start' ? { modal: { ...context.modal, pending: true, error: null } } : {},
    ),
    startFailed: assign(({ context, event }): Partial<AgentEditorContext> =>
      context.modal.kind === 'start' && event.type === 'START_FAILED' ? { modal: { ...context.modal, pending: false, error: event.message } } : {},
    ),
  },
}).createMachine({
  id: 'agentEditor',
  context: () => ({ selection: NONE, modal: { kind: 'none' }, leavingTo: null }),
  initial: 'editing',
  states: {
    editing: {
      on: {
        OPEN: [
          { guard: 'dirty', target: 'confirmLeave', actions: 'rememberTarget' },
          { actions: ['applySelection', emit(({ context }) => ({ type: 'applied', selection: context.selection }))] },
        ],
        APPLY: { actions: ['applySelection', emit(({ context }) => ({ type: 'applied', selection: context.selection }))] },
        ASK_REMOVE: { actions: 'askRemove' },
        CANCEL_REMOVE: { actions: 'clearModal' },
        ASK_START: { actions: 'askStart' },
        CLOSE_START: { actions: 'clearModal' },
        START_PENDING: { guard: 'starting', actions: 'startPending' },
        START_FAILED: { guard: 'starting', actions: 'startFailed' },
        STARTED: { actions: 'clearModal' },
      },
    },
    confirmLeave: {
      on: {
        KEEP_EDITING: { target: 'editing', actions: 'keepEditing' },
        OPEN: { actions: 'rememberTarget' },
        DISCARD: {
          target: 'editing',
          guard: 'selected',
          actions: ['leaveSelection', emit(({ context }) => ({ type: 'applied', selection: context.selection }))],
        },
        APPLY: { target: 'editing', actions: ['applySelection', emit(({ context }) => ({ type: 'applied', selection: context.selection }))] },
      },
    },
  },
})
