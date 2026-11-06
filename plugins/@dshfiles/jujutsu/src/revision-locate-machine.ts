import { assign, setup } from '@dshfiles/plugin-ui/machine'
import type { Revision } from './api.js'
import { ChatReferenceModel } from './chat-reference.js'

/** What a chat reference or a panel request asks the graph to show. */
export interface LocateReference {
  readonly value: string
  readonly kind: 'revision' | 'bookmark'
  readonly behavior: 'focus' | 'path'
}

interface LocateContext {
  readonly reference: LocateReference | null
  readonly revisions: readonly Revision[]
  /** The repository state has loaded; resolving against a partial list would filter for a revision that is coming. */
  readonly loaded: boolean
  /** The last reference turned into a text filter, so one unresolved reference filters the graph once. */
  readonly searchKey: string | null
  readonly target: Revision | null
  readonly behavior: 'focus' | 'path'
  readonly highlighted: string | null
}

type LocateEvent =
  | { readonly type: 'reference'; readonly reference: LocateReference }
  | { readonly type: 'revisions'; readonly revisions: readonly Revision[]; readonly loaded: boolean }
  /** A shown revision the user asked to reveal: `visible` is whether the graph already lists it. */
  | { readonly type: 'locate'; readonly revision: Revision; readonly visible: boolean }
  /** The banner's reveal ran, so the graph lists the revision from its next render on. */
  | { readonly type: 'revealed'; readonly revision: Revision }
  /** The graph scrolled to the target and focused its row. */
  | { readonly type: 'located' }
  | { readonly type: 'cancel' }
  | { readonly type: 'reset' }

const EMPTY_CONTEXT: LocateContext = {
  reference: null,
  revisions: [],
  loaded: false,
  searchKey: null,
  target: null,
  behavior: 'focus',
  highlighted: null,
}

const matchOf = (context: LocateContext): Revision | undefined =>
  context.reference === null ? undefined : ChatReferenceModel.resolve({ reference: context.reference, revisions: context.revisions })

const searchKeyOf = (reference: LocateReference): string => `${reference.kind}:${reference.value}`

/** The locate flow a chat reference starts and the graph finishes: resolve, filter, reveal, scroll, flash. */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const revisionLocateMachine = setup({
  types: {
    context: {} as LocateContext,
    events: {} as LocateEvent,
  },
  guards: {
    resolvesReference: ({ context }) => context.loaded && matchOf(context) !== undefined,
    needsTextFilter: ({ context }) =>
      context.loaded && context.reference !== null && matchOf(context) === undefined && context.searchKey !== searchKeyOf(context.reference),
  },
}).createMachine({
  id: 'revisionLocate',
  context: EMPTY_CONTEXT,
  initial: 'idle',
  on: {
    reference: {
      target: '.resolving',
      actions: assign(({ event }) => ({ reference: event.reference, target: null, highlighted: null })),
    },
    revisions: {
      actions: assign(({ event }) => ({ revisions: event.revisions, loaded: event.loaded })),
    },
    locate: [
      {
        target: '.locating',
        guard: ({ event }) => event.visible,
        actions: assign(({ event }) => ({ target: event.revision, behavior: 'focus' as const, highlighted: null })),
      },
      {
        target: '.offscreen',
        actions: assign(({ event }) => ({ target: event.revision, behavior: 'focus' as const, highlighted: null })),
      },
    ],
    revealed: {
      target: '.locating',
      actions: assign(({ event }) => ({ target: event.revision, behavior: 'focus' as const, highlighted: null })),
    },
    cancel: { target: '.idle', actions: assign({ target: null, reference: null }) },
    reset: { target: '.idle', actions: assign({ reference: null, target: null, highlighted: null, searchKey: null }) },
  },
  states: {
    idle: {},
    resolving: {
      always: [
        {
          guard: 'resolvesReference',
          target: 'applying',
          actions: assign(({ context }) => ({ reference: null, target: matchOf(context) ?? null, behavior: context.reference?.behavior ?? 'focus' })),
        },
        {
          guard: 'needsTextFilter',
          actions: assign(({ context }) => ({ searchKey: context.reference === null ? null : searchKeyOf(context.reference) })),
        },
      ],
    },
    /** The graph applies the resolved reference (view, selection, comparison slice) and then asks to locate it. */
    applying: {},
    offscreen: {},
    locating: {
      on: {
        located: { target: 'highlighted', actions: assign(({ context }) => ({ highlighted: context.target?.commitId ?? null })) },
      },
    },
    highlighted: {
      after: { 1800: { target: 'idle', actions: assign({ highlighted: null, target: null }) } },
    },
  },
})
