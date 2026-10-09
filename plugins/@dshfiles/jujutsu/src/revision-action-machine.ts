import type { z } from 'zod'
import type { Mutation, previewSchema } from './api.js'
import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'

type ActionPreview = z.infer<typeof previewSchema>

interface ConfirmResult {
  readonly message: string
  readonly output: string
  readonly workspacePath: string | null
}

interface RevisionActionClient {
  readonly prepare: (input: { readonly repoId: string; readonly action: Mutation }, options: { readonly signal: AbortSignal }) => Promise<ActionPreview>
  readonly confirm: (input: { readonly repoId: string; readonly previewId: string }, options: { readonly signal: AbortSignal }) => Promise<ConfirmResult>
}

interface RevisionActionContext {
  readonly client: RevisionActionClient
  readonly dragSource: string | null
  readonly dropTarget: string | null
  readonly repoId: string | null
  readonly action: Mutation | null
  readonly preview: ActionPreview | null
  readonly result: ConfirmResult | null
  readonly error: string | null
}

type RevisionActionEvent =
  | { readonly type: 'drag.start'; readonly sourceId: string }
  | { readonly type: 'drag.enter'; readonly targetId: string }
  | { readonly type: 'drag.end' }
  | { readonly type: 'drop'; readonly repoId: string | null; readonly action: Mutation | null }
  | { readonly type: 'prepare'; readonly repoId: string; readonly action: Mutation }
  | { readonly type: 'confirm' }
  | { readonly type: 'cancel' }
  | { readonly type: 'reset' }

const failureMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message.length > 0 ? error.message : fallback)

const idleContext = { dragSource: null, dropTarget: null, preview: null } as const

/**
 * drag → drop → prepare → preview → confirm, plus prepare from menus. Leaving a busy state stops its actor, which aborts
 * the Host call; `settled` fires after every confirm attempt so the caller can refresh the repository.
 */
export const revisionActionMachine = setup({
  types: {
    context: {} as RevisionActionContext,
    events: {} as RevisionActionEvent,
    input: {} as { readonly client: RevisionActionClient },
    emitted: {} as
      | { readonly type: 'confirmed'; readonly workspacePath: string | null }
      | { readonly type: 'settled'; readonly repoId: string },
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
  context: ({ input }) => ({ client: input.client, repoId: null, action: null, result: null, error: null, ...idleContext }),
  initial: 'idle',
  on: {
    reset: { target: '.idle', actions: assign({ ...idleContext, result: null, error: null }) },
  },
  states: {
    idle: {
      on: {
        'drag.start': { target: 'dragging', actions: assign(({ event }) => ({ dragSource: event.sourceId, dropTarget: null })) },
        prepare: { target: 'preparing', actions: assign(({ event }) => ({ repoId: event.repoId, action: event.action, error: null })) },
      },
    },
    dragging: {
      on: {
        'drag.enter': { actions: assign(({ event }) => ({ dropTarget: event.targetId })) },
        'drag.end': { target: 'idle', actions: assign(idleContext) },
        drop: [
          {
            guard: ({ event }) => event.repoId !== null && event.action !== null,
            target: 'preparing',
            actions: assign(({ event }) => ({ ...idleContext, repoId: event.repoId, action: event.action, error: null })),
          },
          { target: 'idle', actions: assign(idleContext) },
        ],
      },
    },
    preparing: {
      tags: ['busy'],
      entry: assign({ result: null }),
      invoke: {
        src: 'prepare',
        input: ({ context }) => {
          if (context.action === null || context.repoId === null) throw new Error('Nothing to prepare.')
          return { client: context.client, repoId: context.repoId, action: context.action }
        },
        onDone: { target: 'previewing', actions: assign(({ event }) => ({ preview: event.output })) },
        onError: { target: 'idle', actions: assign(({ event }) => ({ error: failureMessage(event.error, 'Could not prepare this action.') })) },
      },
    },
    previewing: {
      on: {
        confirm: 'confirming',
        cancel: { target: 'idle', actions: assign({ preview: null }) },
        prepare: { target: 'preparing', actions: assign(({ event }) => ({ repoId: event.repoId, action: event.action, preview: null, error: null })) },
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
      exit: assign({ preview: null }),
    },
  },
})
