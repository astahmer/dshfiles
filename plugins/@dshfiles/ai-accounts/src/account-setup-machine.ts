import { isApiError } from '@dshfiles/dshx/api'
import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { AccountKind } from './api.js'

interface SetupInput {
  readonly accountId?: string | undefined
  readonly create: (kind: AccountKind | null, signal: AbortSignal) => Promise<string>
}

type SetupFailure = 'configure' | 'verify' | 'key' | null

interface SetupContext {
  readonly accountId: string | null
  readonly kind: AccountKind | null
  readonly create: SetupInput['create']
  readonly connectAnother: boolean
  readonly failure: SetupFailure
}

type SetupEvent =
  | { readonly type: 'choose'; readonly kind: AccountKind }
  | { readonly type: 'retry' }
  | { readonly type: 'verify.begin'; readonly failure: 'verify' | 'key' }
  | { readonly type: 'verify.succeeded' }
  | { readonly type: 'verify.failed'; readonly error: unknown }
  | { readonly type: 'configure.begin' }
  | { readonly type: 'configure.succeeded' }
  | { readonly type: 'configure.failed' }
  | { readonly type: 'signInAnother' }

// A response/transport failure can occur after an accepted commit. Never infer
// authentication failure or safe credential replacement from a missing receipt.
export const isUnknownConnectionResult = (error: unknown): boolean =>
  isApiError(error) && (error.kind === 'contract' || error.kind === 'transport' || error.kind === 'unavailable')

/** The Host prepares an isolated connection; only verified completion publishes an account. */
export const accountSetupMachine = setup({
  // SAFETY: XState uses these type-only carriers for inference; actual context/input/events are supplied by the machine.
  types: { context: {} as SetupContext, input: {} as SetupInput, events: {} as SetupEvent },
  actors: {
    create: fromPromise<string, { readonly kind: AccountKind | null; readonly create: SetupInput['create'] }>(({ input, signal }) =>
      input.create(input.kind, signal),
    ),
  },
  guards: {
    unknownResult: ({ event }) => event.type === 'verify.failed' && isUnknownConnectionResult(event.error),
  },
}).createMachine({
  id: 'accountSetup',
  context: ({ input }) => ({ accountId: input.accountId ?? null, kind: null, create: input.create, connectAnother: false, failure: null }),
  initial: 'deciding',
  states: {
    deciding: { always: [{ guard: ({ context }) => context.accountId !== null, target: 'creating' }, { target: 'choosing' }] },
    choosing: { on: { choose: { target: 'creating', actions: assign({ kind: ({ event }) => event.kind }) } } },
    creating: {
      invoke: {
        src: 'create',
        input: ({ context }) => ({ kind: context.kind, create: context.create }),
        onDone: { target: 'connecting', actions: assign({ accountId: ({ event }) => event.output }) },
        onError: { target: 'error' },
      },
    },
    connecting: {
      on: {
        'verify.begin': { target: 'verifying', actions: assign({ failure: ({ event }) => event.failure }) },
        'configure.begin': { target: 'configuring', actions: assign({ failure: null }) },
        signInAnother: { actions: assign({ connectAnother: true }) },
      },
    },
    configuring: {
      on: {
        'configure.succeeded': { target: 'connecting', actions: [assign({ connectAnother: false }), assign({ failure: null })] },
        'configure.failed': { target: 'connecting', actions: assign({ failure: 'configure' }) },
      },
    },
    verifying: {
      on: {
        'verify.succeeded': { target: 'success' },
        'verify.failed': [{ guard: 'unknownResult', target: 'unknownResult' }, { target: 'failed' }],
      },
    },
    failed: {
      on: {
        'verify.begin': { target: 'verifying', actions: assign({ failure: ({ event }) => event.failure }) },
        'configure.begin': { target: 'configuring', actions: assign({ failure: null }) },
      },
    },
    unknownResult: {},
    success: {},
    error: { on: { retry: { target: 'creating' } } },
  },
})
