import { assign, setup } from '@dshfiles/plugin-ui/machine'
import type { Revision } from './api.js'
import { ChatReferenceModel } from './chat-reference.js'
import { containsPath } from './side-panel-repository.js'

/** What a chat reference or a panel request asks the graph to show. */
export interface LocateReference {
  readonly value: string
  readonly kind: 'revision' | 'bookmark'
  readonly behavior: 'focus' | 'path'
}

interface LocateContext {
  readonly reference: LocateReference | null
  /** The repository the reference was requested for; it only resolves against that repository's revisions. */
  readonly referencePath: string | null
  readonly revisions: readonly Revision[]
  /** The repository `revisions` came from. */
  readonly root: string | null
  /** The repository state has loaded; resolving against a partial list would filter for a revision that is coming. */
  readonly loaded: boolean
  /** The last reference turned into a text filter, so one unresolved reference filters the graph once. */
  readonly searchKey: string | null
  readonly target: Revision | null
  readonly behavior: 'focus' | 'path'
  readonly highlighted: string | null
}

type LocateEvent =
  | { readonly type: 'reference'; readonly reference: LocateReference; readonly path: string }
  | { readonly type: 'revisions'; readonly revisions: readonly Revision[]; readonly loaded: boolean; readonly root: string | null }
  /** Another repository came on screen: what was located goes, a reference still waiting for its repository stays. */
  | { readonly type: 'repository.changed' }
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
  referencePath: null,
  revisions: [],
  root: null,
  loaded: false,
  searchKey: null,
  target: null,
  behavior: 'focus',
  highlighted: null,
}

/** The revisions on hand are the requested repository's, loaded: a panel moving to another one still lists the old one's. */
const ready = (context: LocateContext): boolean =>
  context.loaded && context.root !== null && context.referencePath !== null && containsPath(context.root, context.referencePath)

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
    resolvesReference: ({ context }) => ready(context) && matchOf(context) !== undefined,
    needsTextFilter: ({ context }) =>
      ready(context) && context.reference !== null && matchOf(context) === undefined && context.searchKey !== searchKeyOf(context.reference),
    referenceWaiting: ({ context }) => context.reference !== null,
  },
}).createMachine({
  id: 'revisionLocate',
  context: EMPTY_CONTEXT,
  initial: 'idle',
  on: {
    reference: {
      target: '.resolving',
      actions: assign(({ event }) => ({ reference: event.reference, referencePath: event.path, target: null, highlighted: null })),
    },
    revisions: {
      actions: assign(({ event }) => ({ revisions: event.revisions, loaded: event.loaded, root: event.root })),
    },
    'repository.changed': [
      { guard: 'referenceWaiting', target: '.resolving', actions: assign({ target: null, highlighted: null, searchKey: null }) },
      { target: '.idle', actions: assign({ target: null, highlighted: null, searchKey: null }) },
    ],
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
    cancel: { target: '.idle', actions: assign({ target: null, reference: null, referencePath: null }) },
    reset: { target: '.idle', actions: assign({ reference: null, referencePath: null, target: null, highlighted: null, searchKey: null }) },
  },
  states: {
    idle: {},
    resolving: {
      always: [
        {
          guard: 'resolvesReference',
          target: 'applying',
          actions: assign(({ context }) => ({
            reference: null,
            referencePath: null,
            target: matchOf(context) ?? null,
            behavior: context.reference?.behavior ?? 'focus',
          })),
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
