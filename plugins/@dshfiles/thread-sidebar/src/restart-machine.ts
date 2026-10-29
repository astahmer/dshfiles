import type { ApiClient } from '@dshfiles/dshx/api'
import { fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { threadSidebarRestartApi } from './restart-api.js'

export type RestartClient = Pick<ApiClient<typeof threadSidebarRestartApi.methods>, 'requestRestart'>

type RestartEvent = { readonly type: 'open' } | { readonly type: 'cancel' } | { readonly type: 'confirm' }

type RestartInput = { readonly client: RestartClient }

type RestartContext = { readonly client: RestartClient }

const unprovidedRestartActor = fromPromise<void, RestartClient>(async () => {
  throw new Error('The thread-sidebar restart actor was not provided.')
})

// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
const restartMachine = setup({
  types: {
    context: {} as RestartContext,
    events: {} as RestartEvent,
    input: {} as RestartInput,
  },
  actors: { requestRestart: unprovidedRestartActor },
}).createMachine({
  id: 'thread-sidebar-restart',
  initial: 'closed',
  context: ({ input }) => ({ client: input.client }),
  states: {
    closed: { on: { open: 'confirming' } },
    confirming: { on: { cancel: 'closed', confirm: 'requesting' } },
    requesting: {
      invoke: {
        src: 'requestRestart',
        input: ({ context }) => context.client,
        onDone: { target: 'closed' },
        onError: { target: 'failed' },
      },
    },
    failed: { on: { cancel: 'closed', confirm: 'requesting' } },
  },
})

export const provideRestartMachine = () =>
  restartMachine.provide({
    actors: {
      requestRestart: fromPromise<void, RestartClient>(async ({ input, signal }) => {
        await input.requestRestart(undefined, { signal })
      }),
    },
  })
