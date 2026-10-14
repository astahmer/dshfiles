import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'

type SessionId = SessionSummary['id']

export interface ArchivedViewClient {
  /** Show the Session in the main view; DSH acquires a fresh main reference for every call. */
  readonly open: (sessionId: SessionId) => void
  /** Resolves once a reference of our own to the Session loaded, so a load failure surfaces as an error. */
  readonly ready: (sessionId: SessionId, signal: AbortSignal) => Promise<void>
  readonly now: () => number
}

type ArchivedViewEvent =
  | { readonly type: 'open'; readonly sessionId: SessionId; readonly archived: boolean }
  | { readonly type: 'selection.changed'; readonly sessionId: SessionId | null }
  | { readonly type: 'retry' }
  | { readonly type: 'dismiss' }

export type ArchivedViewFailure = 'load-failed' | 'keeps-closing'

interface ArchivedViewContext {
  readonly client: ArchivedViewClient
  readonly sessionId: SessionId | null
  readonly selected: SessionId | null
  readonly reopenedAt: readonly number[]
  readonly failure: ArchivedViewFailure | null
  readonly error: string | null
}

interface ArchivedViewInput {
  readonly client: ArchivedViewClient
}

interface ArchivedViewFailed {
  readonly type: 'failed'
  readonly sessionId: SessionId | null
  readonly failure: ArchivedViewFailure
  readonly error: string | null
}

/** DSH clears an archived main Session on every list change; past this many reopens in the window we stop fighting it. */
const REOPEN_LIMIT = 3
const REOPEN_WINDOW_MS = 10_000

const errorText = (error: unknown): string => (error instanceof Error && error.message.length > 0 ? error.message : String(error))

/**
 * An archived thread opened from the sidebar: open → viewing, reopened when DSH drops it from the main view, and a
 * failure state (with the Session id) when it cannot load or keeps getting closed. Leaving a busy state aborts the load.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const archivedViewMachine = setup({
  types: {
    context: {} as ArchivedViewContext,
    events: {} as ArchivedViewEvent,
    input: {} as ArchivedViewInput,
    emitted: {} as ArchivedViewFailed,
  },
  actors: {
    load: fromPromise<void, { readonly client: ArchivedViewClient; readonly sessionId: SessionId | null }>(async ({ input, signal }) => {
      if (input.sessionId === null) return
      input.client.open(input.sessionId)
      await input.client.ready(input.sessionId, signal)
    }),
  },
  guards: {
    archivedTarget: ({ event }) => event.type === 'open' && event.archived,
    canReopen: ({ context }) => {
      const since = context.client.now() - REOPEN_WINDOW_MS
      return context.reopenedAt.filter(time => time >= since).length < REOPEN_LIMIT
    },
    shown: ({ context }) => context.selected === context.sessionId,
    navigatedAway: ({ context }) => context.selected !== null && context.selected !== context.sessionId,
  },
}).createMachine({
  id: 'archivedView',
  context: ({ input }) => ({ client: input.client, sessionId: null, selected: null, reopenedAt: [], failure: null, error: null }),
  initial: 'idle',
  on: {
    open: [
      {
        guard: 'archivedTarget',
        target: '.opening',
        actions: assign(({ event }) => ({ sessionId: event.sessionId, reopenedAt: [], failure: null, error: null })),
      },
      { target: '.idle', actions: assign({ sessionId: null, reopenedAt: [], failure: null, error: null }) },
    ],
    dismiss: { target: '.idle', actions: assign({ sessionId: null, reopenedAt: [], failure: null, error: null }) },
    'selection.changed': { actions: assign(({ event }) => ({ selected: event.sessionId })) },
  },
  states: {
    idle: {},
    opening: {
      invoke: {
        src: 'load',
        input: ({ context }) => ({ client: context.client, sessionId: context.sessionId }),
        onDone: { target: 'settling' },
        onError: { target: 'failed', actions: assign(({ event }) => ({ failure: 'load-failed' as const, error: errorText(event.error) })) },
      },
      on: {
        'selection.changed': [
          {
            guard: ({ context, event }) => event.sessionId !== null && event.sessionId !== context.sessionId,
            target: 'idle',
            actions: assign({ sessionId: null, selected: ({ event }) => event.sessionId }),
          },
          { actions: assign(({ event }) => ({ selected: event.sessionId })) },
        ],
      },
    },
    // DSH clears an archived main Session whenever its lists change, so check what is shown once the load settled.
    settling: {
      always: [
        { guard: 'shown', target: 'viewing' },
        { guard: 'navigatedAway', target: 'idle', actions: assign({ sessionId: null, reopenedAt: [] }) },
        { guard: 'canReopen', target: 'opening', actions: assign(({ context }) => ({ reopenedAt: [...context.reopenedAt, context.client.now()] })) },
        { target: 'failed', actions: assign({ failure: 'keeps-closing' as const, error: null }) },
      ],
    },
    viewing: {
      on: {
        'selection.changed': { target: 'settling', actions: assign(({ event }) => ({ selected: event.sessionId })) },
      },
    },
    failed: {
      entry: emit(({ context }) => ({
        type: 'failed' as const,
        sessionId: context.sessionId,
        failure: context.failure ?? 'load-failed',
        error: context.error,
      })),
      on: {
        retry: { target: 'opening', actions: assign({ reopenedAt: [], failure: null, error: null }) },
        'selection.changed': {
          guard: ({ event }) => event.sessionId !== null,
          target: 'idle',
          actions: assign(({ event }) => ({ sessionId: null, selected: event.sessionId, reopenedAt: [] })),
        },
      },
    },
  },
})
