import { z } from 'zod'
import type { Mutation, previewSchema } from './api.js'
import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'

export type ActionPreview = z.infer<typeof previewSchema>

interface ConfirmResult {
  readonly message: string
  readonly output: string
  readonly workspacePath: string | null
}

interface RevisionActionClient {
  readonly prepare: (input: { readonly repoId: string; readonly action: Mutation }, options: { readonly signal: AbortSignal }) => Promise<ActionPreview>
  readonly confirm: (input: { readonly repoId: string; readonly previewId: string }, options: { readonly signal: AbortSignal }) => Promise<ConfirmResult>
}

export type DragOrigin =
  | { readonly kind: 'revision'; readonly sourceId: string }
  | { readonly kind: 'bookmark'; readonly sourceId: string; readonly bookmark: string }

export type DropPresentation =
  | { readonly kind: 'rebase'; readonly sourceId: string; readonly destinationId: string }
  | { readonly kind: 'bookmark-move'; readonly sourceId: string; readonly destinationId: string; readonly bookmark: string }

interface RevisionActionContext {
  readonly client: RevisionActionClient
  readonly dragOrigin: DragOrigin | null
  readonly dropTarget: string | null
  readonly dropPresentation: DropPresentation | null
  readonly repoId: string | null
  readonly action: Mutation | null
  readonly preview: ActionPreview | null
  readonly result: ConfirmResult | null
  readonly error: string | null
}

type RevisionActionEvent =
  | { readonly type: 'drag.start'; readonly origin: DragOrigin }
  | { readonly type: 'drag.enter'; readonly targetId: string }
  | { readonly type: 'drag.leave'; readonly targetId: string }
  | { readonly type: 'drag.end' }
  | {
      readonly type: 'drop'
      readonly repoId: string | null
      readonly action: Mutation | null
      readonly targetId: string
      readonly presentation: DropPresentation | null
      readonly error: string | null
    }
  | { readonly type: 'prepare'; readonly repoId: string; readonly action: Mutation; readonly presentation: DropPresentation | null }
  | { readonly type: 'reject'; readonly error: string }
  | { readonly type: 'confirm' }
  | { readonly type: 'cancel' }
  | { readonly type: 'reset' }

// A Host from before PluginApiError (until the user restarts DSH) sends this generic failure; name the action instead.
const genericHostFailure = z.object({ kind: z.literal('remote'), remoteCode: z.literal('internal') })

const failureMessage = (error: unknown, fallback: string): string => {
  if (genericHostFailure.safeParse(error).success) return fallback
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}

const idleContext = { dragOrigin: null, dropTarget: null, dropPresentation: null, preview: null, action: null } as const

/**
 * drag → drop → prepare → preview → confirm, plus prepare from menus. Leaving a busy state stops its actor, which aborts
 * the Host call; `settled` fires after every confirm attempt so the caller can refresh the repository.
 */
export const revisionActionMachine = setup({
  types: {
    context: {} as RevisionActionContext,
    events: {} as RevisionActionEvent,
    input: {} as { readonly client: RevisionActionClient },
    emitted: {} as { readonly type: 'confirmed'; readonly workspacePath: string | null } | { readonly type: 'settled'; readonly repoId: string },
  },
  actors: {
    prepare: fromPromise<ActionPreview, { readonly client: RevisionActionClient; readonly repoId: string; readonly action: Mutation }>(({ input, signal }) =>
      input.client.prepare({ repoId: input.repoId, action: input.action }, { signal }),
    ),
    confirm: fromPromise<ConfirmResult, { readonly client: RevisionActionClient; readonly repoId: string; readonly previewId: string }>(({ input, signal }) =>
      input.client.confirm({ repoId: input.repoId, previewId: input.previewId }, { signal }),
    ),
  },
}).createMachine({
  id: 'revisionAction',
  context: ({ input }) => ({ client: input.client, repoId: null, result: null, error: null, ...idleContext }),
  initial: 'idle',
  on: {
    reset: { target: '.idle', actions: assign({ ...idleContext, result: null, error: null }) },
    reject: { actions: assign(({ event }) => ({ error: event.error })) },
  },
  states: {
    idle: {
      on: {
        'drag.start': {
          target: 'dragging',
          actions: assign(({ event }) => ({ dragOrigin: event.origin, dropTarget: null, dropPresentation: null, error: null })),
        },
        prepare: {
          target: 'preparing',
          actions: assign(({ event }) => ({ repoId: event.repoId, action: event.action, dropPresentation: event.presentation, error: null })),
        },
      },
    },
    dragging: {
      on: {
        'drag.enter': { actions: assign(({ event }) => ({ dropTarget: event.targetId })) },
        'drag.leave': { actions: assign(({ context, event }) => (context.dropTarget === event.targetId ? { dropTarget: null } : {})) },
        'drag.end': { target: 'idle', actions: assign({ ...idleContext, error: null }) },
        drop: [
          {
            guard: ({ event }) => event.repoId !== null && event.action !== null,
            target: 'preparing',
            actions: assign(({ event }) => ({
              ...idleContext,
              repoId: event.repoId,
              action: event.action,
              dropTarget: event.targetId,
              dropPresentation: event.presentation,
              error: null,
            })),
          },
          { target: 'idle', actions: assign(({ event }) => ({ ...idleContext, error: event.error })) },
        ],
      },
    },
    preparing: {
      tags: ['busy'],
      entry: assign({ result: null }),
      on: { cancel: { target: 'idle', actions: assign({ ...idleContext, error: null }) } },
      invoke: {
        src: 'prepare',
        input: ({ context }) => {
          if (context.action === null || context.repoId === null) throw new Error('Nothing to prepare.')
          return { client: context.client, repoId: context.repoId, action: context.action }
        },
        onDone: { target: 'previewing', actions: assign(({ event }) => ({ preview: event.output })) },
        onError: {
          target: 'idle',
          actions: assign(({ context, event }) => ({
            ...idleContext,
            action: null,
            error: failureMessage(event.error, 'Could not prepare this action.'),
            repoId: context.repoId,
          })),
        },
      },
    },
    previewing: {
      on: {
        confirm: 'confirming',
        cancel: { target: 'idle', actions: assign(({ context }) => ({ ...idleContext, repoId: context.repoId, error: null })) },
        prepare: {
          target: 'preparing',
          actions: assign(({ event }) => ({
            repoId: event.repoId,
            action: event.action,
            dropPresentation: event.presentation,
            dropTarget: event.presentation?.destinationId ?? null,
            preview: null,
            error: null,
          })),
        },
      },
    },
    confirming: {
      tags: ['busy'],
      invoke: {
        src: 'confirm',
        input: ({ context }) => ({ client: context.client, repoId: context.repoId ?? '', previewId: context.preview?.id ?? '' }),
        onDone: {
          target: 'idle',
          actions: [
            assign(({ event }) => ({ result: event.output })),
            emit(({ event }) => ({ type: 'confirmed', workspacePath: event.output.workspacePath }) as const),
            emit(({ context }) => ({ type: 'settled', repoId: context.repoId ?? '' }) as const),
          ],
        },
        onError: {
          target: 'idle',
          actions: [
            assign(({ event }) => ({ error: failureMessage(event.error, 'Action was not completed.') })),
            emit(({ context }) => ({ type: 'settled', repoId: context.repoId ?? '' }) as const),
          ],
        },
      },
      exit: assign({ ...idleContext, preview: null }),
    },
  },
})
