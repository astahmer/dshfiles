import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { Schema } from 'effect'

const bootstrapFailureSchema = Schema.Struct({ message: Schema.String, code: Schema.optional(Schema.String) })

/** A Host refusal keeps its code so the view can hide retry on an unknown mutation outcome. */
export type BootstrapFailure = Schema.Schema.Type<typeof bootstrapFailureSchema>

const createdSessions = new Map<string, string>()
const sessionCreations = new Map<string, Promise<string>>()

/** One remote Session per target: a remount (StrictMode, a fast prop change) reuses the id instead of creating a second thread. */
export const createSessionOnce = async (input: { readonly target: string; readonly create: () => Promise<string> }): Promise<string> => {
  const created = createdSessions.get(input.target)
  if (created !== undefined) return created

  const pending = sessionCreations.get(input.target)
  if (pending !== undefined) return pending

  const operation = input.create().then(sessionId => {
    createdSessions.set(input.target, sessionId)
    return sessionId
  })
  sessionCreations.set(input.target, operation)
  try {
    return await operation
  } finally {
    if (sessionCreations.get(input.target) === operation) sessionCreations.delete(input.target)
  }
}

/** A started Session leaves the cache: the next visit to this remote folder is a new thread. */
export const forgetCreatedSession = (target: string): void => {
  createdSessions.delete(target)
}

interface BootstrapContext {
  readonly target: string
  readonly create: () => Promise<string>
  readonly onStarted: (sessionId: string) => void | Promise<void>
  readonly describeFailure: (error: unknown) => BootstrapFailure
  readonly sessionId: string | null
  readonly failure: BootstrapFailure | null
}

export interface RemoteSessionBootstrapInput {
  /** Names the remote folder; one Session per target. */
  readonly target: string
  readonly create: () => Promise<string>
  readonly onStarted: (sessionId: string) => void | Promise<void>
  readonly describeFailure: (error: unknown) => BootstrapFailure
}

type BootstrapEvent = { readonly type: 'retry' }

/**
 * Creates the remote Session the composer needs and opens it: `creating` runs the Host call, `opening` hands the id to
 * the conversation, and a refusal lands in `failed` (retry re-enters `creating`) or `unrecoverable` (the mutation
 * outcome is unknown, so a retry could create a second thread).
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const remoteSessionBootstrapMachine = setup({
  types: {
    context: {} as BootstrapContext,
    events: {} as BootstrapEvent,
    input: {} as RemoteSessionBootstrapInput,
  },
  actors: {
    create: fromPromise<string, { readonly target: string; readonly create: () => Promise<string> }>(async ({ input }) =>
      createSessionOnce({ target: input.target, create: input.create }),
    ),
    open: fromPromise<void, { readonly sessionId: string; readonly onStarted: (sessionId: string) => void | Promise<void> }>(async ({ input }) => {
      await input.onStarted(input.sessionId)
    }),
  },
}).createMachine({
  id: 'remoteSessionBootstrap',
  context: ({ input }) => ({
    target: input.target,
    create: input.create,
    onStarted: input.onStarted,
    describeFailure: input.describeFailure,
    sessionId: null,
    failure: null,
  }),
  initial: 'creating',
  states: {
    creating: {
      invoke: {
        src: 'create',
        input: ({ context }) => ({ target: context.target, create: context.create }),
        onDone: {
          target: 'opening',
          actions: assign({ sessionId: ({ event }) => event.output, failure: null }),
        },
        onError: {
          target: 'refused',
          actions: assign({ failure: ({ context, event }) => context.describeFailure(event.error) }),
        },
      },
    },
    opening: {
      invoke: {
        src: 'open',
        // SAFETY of the fallback: `opening` is only entered by `creating` once it assigned the created id.
        input: ({ context }) => ({ sessionId: context.sessionId ?? '', onStarted: context.onStarted }),
        onDone: {
          target: 'started',
          actions: ({ context }) => {
            forgetCreatedSession(context.target)
          },
        },
        onError: {
          target: 'refused',
          actions: assign({ failure: ({ context, event }) => context.describeFailure(event.error) }),
        },
      },
    },
    refused: {
      always: [
        {
          guard: ({ context }) => context.failure?.code === 'unknown-mutation-outcome',
          target: 'unrecoverable',
        },
        { target: 'failed' },
      ],
    },
    failed: {
      on: {
        retry: {
          target: 'creating',
          actions: assign({ failure: null }),
        },
      },
    },
    unrecoverable: {},
    started: { type: 'final' },
  },
})
