import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import type { GraphSlice, Revision, RevisionRelationship } from './api.js'
import { GraphNavigationModel, type GraphViewFilter, type HiddenGraphHistory } from './graph-navigation.js'

export type GraphSliceMode = 'history' | 'exclusive'

export interface GraphSliceRequest {
  readonly repoId: string
  readonly commitId: string
  readonly mode: GraphSliceMode
}

export interface GraphNavigationClient {
  readonly graphSlice: (input: GraphSliceRequest, options: { readonly signal: AbortSignal }) => Promise<GraphSlice>
}

interface GraphSliceOperation {
  readonly operationId: number
  readonly scope: string
  readonly repoId: string
  readonly commitId: string
  readonly revisionLabel: string
  readonly mode: GraphSliceMode
}

interface GraphSliceActorInput extends GraphSliceOperation {
  readonly client: GraphNavigationClient
}

interface GraphSliceCompletion extends GraphSliceOperation {
  readonly slice: GraphSlice
}

interface RelationshipLensSelection {
  readonly commitId: string
  readonly targetCommitId: string
}

interface GraphNavigationContext {
  readonly client: GraphNavigationClient
  readonly scope: string
  readonly repoId: string | null
  readonly operationId: number
  readonly request: GraphSliceOperation | null
  readonly view: GraphViewFilter | null
  readonly hidden: readonly HiddenGraphHistory[]
  readonly revealed: readonly Revision[]
  readonly lensSelection: RelationshipLensSelection | null
  readonly notice: string
}

type GraphNavigationViewState = Pick<GraphNavigationContext, 'view' | 'hidden' | 'revealed' | 'lensSelection' | 'notice'>

export const selectGraphNavigationViewState = (context: GraphNavigationContext, scope: string): GraphNavigationViewState => {
  if (context.scope !== scope) return { view: null, hidden: [], revealed: [], lensSelection: null, notice: '' }
  return { view: context.view, hidden: context.hidden, revealed: context.revealed, lensSelection: context.lensSelection, notice: context.notice }
}

interface GraphNavigationInput {
  readonly client: GraphNavigationClient
  readonly scope: string
  readonly repoId: string | null
}

type GraphNavigationEvent =
  | { readonly type: 'scope.change'; readonly scope: string; readonly repoId: string | null }
  | { readonly type: 'slice.apply'; readonly revision: Revision; readonly mode: GraphSliceMode }
  | { readonly type: 'slice.cancel' }
  | {
      readonly type: 'relationship.apply'
      readonly kind: 'difference' | 'connection'
      readonly relationship: RevisionRelationship
      readonly targetLabel: string
    }
  | { readonly type: 'relationship.highlight'; readonly commitId: string; readonly targetCommitId: string }
  | { readonly type: 'reset' }
  | { readonly type: 'view.clear' }
  | { readonly type: 'lens.clear' }
  | { readonly type: 'hidden.remove'; readonly commitId: string }
  | { readonly type: 'revealed.clear' }
  | { readonly type: 'revision.reveal'; readonly revision: Revision }
  | { readonly type: 'notice.clear' }

const completeSlice = (context: GraphNavigationContext, completion: GraphSliceCompletion): Partial<GraphNavigationContext> => {
  const request = context.request
  if (request === null) return { request: null }
  if (completion.mode === 'history') {
    return {
      request: null,
      view: {
        kind: 'history',
        label: `History leading to ${completion.revisionLabel}`,
        commitIds: new Set(completion.slice.revisions.map(revision => revision.commitId)),
        revisions: completion.slice.revisions,
        truncated: completion.slice.truncated,
      },
      lensSelection: null,
      revealed: [],
      notice: '',
    }
  }
  if (completion.slice.revisions.length === 0) {
    return {
      request: null,
      notice: 'Nothing exclusive to hide: this history is shared with retained descendants, bookmarks, or workspaces.',
    }
  }
  return {
    request: null,
    hidden: [
      ...context.hidden.filter(history => history.commitId !== completion.commitId),
      {
        commitId: completion.commitId,
        label: completion.revisionLabel,
        commitIds: completion.slice.revisions.map(revision => revision.commitId),
        truncated: completion.slice.truncated,
      },
    ],
    revealed: [],
    notice: `Hidden exclusive history leading to ${completion.revisionLabel}. Shared history remains visible.`,
  }
}

// SAFETY: XState uses these empty carriers only for compile-time inference; runtime behavior comes from the typed machine.
export const graphNavigationMachine = setup({
  types: {
    context: {} as GraphNavigationContext,
    events: {} as GraphNavigationEvent,
    input: {} as GraphNavigationInput,
  },
  actors: {
    slice: fromPromise<GraphSliceCompletion, GraphSliceActorInput>(async ({ input, signal }) => ({
      operationId: input.operationId,
      scope: input.scope,
      repoId: input.repoId,
      commitId: input.commitId,
      revisionLabel: input.revisionLabel,
      mode: input.mode,
      slice: await input.client.graphSlice({ repoId: input.repoId, commitId: input.commitId, mode: input.mode }, { signal }),
    })),
  },
  guards: {
    hasRepository: ({ context }) => context.repoId !== null,
  },
}).createMachine({
  id: 'graphNavigation',
  context: ({ input }) => ({
    client: input.client,
    scope: input.scope,
    repoId: input.repoId,
    operationId: 0,
    request: null,
    view: null,
    hidden: [],
    revealed: [],
    lensSelection: null,
    notice: '',
  }),
  initial: 'idle',
  on: {
    'scope.change': {
      target: '.idle',
      actions: assign(({ context, event }) => ({
        scope: event.scope,
        repoId: event.repoId,
        operationId: context.operationId + 1,
        request: null,
        view: null,
        hidden: [],
        revealed: [],
        lensSelection: null,
        notice: '',
      })),
    },
    'slice.apply': {
      guard: 'hasRepository',
      target: '.loading',
      reenter: true,
      actions: assign(({ context, event }) => {
        if (context.repoId === null) return {}
        const operationId = context.operationId + 1
        return {
          operationId,
          request: {
            operationId,
            scope: context.scope,
            repoId: context.repoId,
            commitId: event.revision.commitId,
            revisionLabel: event.revision.shortestChangeId,
            mode: event.mode,
          },
          notice: '',
        }
      }),
    },
    'slice.cancel': {
      target: '.idle',
      actions: assign(({ context }) => ({ operationId: context.operationId + 1, request: null })),
    },
    'relationship.apply': {
      target: '.idle',
      actions: assign(({ context, event }) => {
        const commitIds =
          event.kind === 'difference'
            ? event.relationship.differenceIds
            : [...event.relationship.connectionIds, event.relationship.commitId, event.relationship.targetCommitId, ...event.relationship.commonAncestorIds]
        return {
          operationId: context.operationId + 1,
          request: null,
          view: {
            kind: event.kind,
            label: event.kind === 'difference' ? `Selected-only relative to ${event.targetLabel}` : `Connection to ${event.targetLabel}`,
            commitIds: new Set(commitIds),
            revisions: event.relationship.revisions,
            truncated: event.relationship.truncated,
          },
          revealed: [],
          lensSelection: null,
          notice: '',
        }
      }),
    },
    'relationship.highlight': {
      target: '.idle',
      actions: assign(({ context, event }) => ({
        operationId: context.operationId + 1,
        request: null,
        lensSelection: { commitId: event.commitId, targetCommitId: event.targetCommitId },
        notice: 'Connection highlighted; unrelated revision text dimmed. Graph rails remain unchanged.',
      })),
    },
    reset: {
      target: '.idle',
      actions: assign(({ context }) => ({
        operationId: context.operationId + 1,
        request: null,
        view: null,
        hidden: [],
        revealed: [],
        lensSelection: null,
        notice: '',
      })),
    },
    'view.clear': {
      target: '.idle',
      actions: assign(({ context }) => ({ operationId: context.operationId + 1, request: null, view: null })),
    },
    'lens.clear': { actions: assign({ lensSelection: null }) },
    'hidden.remove': {
      actions: assign(({ context, event }) => ({ hidden: context.hidden.filter(history => history.commitId !== event.commitId) })),
    },
    'revealed.clear': { actions: assign({ revealed: [] }) },
    'revision.reveal': {
      actions: assign(({ context, event }) => ({ revealed: GraphNavigationModel.mergeGraphRevisions(context.revealed, [event.revision]) })),
    },
    'notice.clear': { actions: assign({ notice: '' }) },
  },
  states: {
    idle: {},
    loading: {
      tags: ['busy'],
      invoke: {
        src: 'slice',
        input: ({ context }) => {
          const request = context.request
          if (request === null) throw new Error('No graph slice operation is active.')
          return {
            client: context.client,
            operationId: request.operationId,
            scope: request.scope,
            repoId: request.repoId,
            commitId: request.commitId,
            revisionLabel: request.revisionLabel,
            mode: request.mode,
          }
        },
        onDone: [
          {
            guard: ({ context, event }) => {
              const request = context.request
              return (
                request !== null &&
                request.operationId === event.output.operationId &&
                request.scope === event.output.scope &&
                request.repoId === event.output.repoId &&
                request.commitId === event.output.commitId &&
                request.mode === event.output.mode &&
                context.operationId === request.operationId &&
                context.scope === request.scope &&
                context.repoId === request.repoId
              )
            },
            target: 'idle',
            actions: assign(({ context, event }) => completeSlice(context, event.output)),
          },
          { target: 'idle', actions: assign({ request: null }) },
        ],
        onError: {
          target: 'idle',
          actions: assign(({ event }) => ({ request: null, notice: errorMessage(event.error, 'Graph view could not be loaded.') })),
        },
      },
    },
  },
})
