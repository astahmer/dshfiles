import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { AccountKind } from './api.js'

interface SetupInput {
  readonly accountId?: string | undefined
  readonly create: (kind: AccountKind | null, signal: AbortSignal) => Promise<string>
}
interface SetupContext {
  readonly accountId: string | null
  readonly kind: AccountKind | null
  readonly create: SetupInput['create']
}
type SetupEvent = { readonly type: 'choose'; readonly kind: AccountKind } | { readonly type: 'retry' }

/** The Host prepares an isolated connection; only verified completion publishes an account. */
export const accountSetupMachine = setup({
  // SAFETY: XState uses these type-only carriers for inference; actual context/input/events are supplied by the machine.
  types: { context: {} as SetupContext, input: {} as SetupInput, events: {} as SetupEvent },
  actors: {
    create: fromPromise<string, { readonly kind: AccountKind | null; readonly create: SetupInput['create'] }>(({ input, signal }) =>
      input.create(input.kind, signal),
    ),
  },
}).createMachine({
  id: 'accountSetup',
  context: ({ input }) => ({ accountId: input.accountId ?? null, kind: null, create: input.create }),
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
    connecting: {},
    error: { on: { retry: { target: 'creating' } } },
  },
})
