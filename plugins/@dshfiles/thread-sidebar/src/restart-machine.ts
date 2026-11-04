import type { ApiClient } from '@dshfiles/dshx/api'
import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { threadSidebarRestartApi } from './restart-api.js'

export type RestartClient = Pick<ApiClient<typeof threadSidebarRestartApi.methods>, 'requestRestart' | 'availability'>

type RestartEvent =
  | { readonly type: 'open' }
  | { readonly type: 'cancel' }
  | { readonly type: 'confirm' }
  /** A restart this page did not start from the dialog (Restart when idle) has begun: wait for the new Host. */
  | { readonly type: 'watch'; readonly run: string | undefined }
  /** Keep waiting after the page gave up on the new Host. */
  | { readonly type: 'retry' }

type RestartInput = {
  readonly client: RestartClient
  readonly pollMs?: number
  readonly stallMs?: number
}

type RestartContext = {
  readonly client: RestartClient
  readonly pollMs: number
  readonly stallMs: number
  /** The run of the Host that was asked to restart; undefined on a Host older than the `run` field. */
  readonly previousRun: string | undefined
}

/** How often the page asks whether the new Host answers, and how long before it says the Host did not come back. */
export const RESTART_POLL_MS = 2_000
export const RESTART_STALL_MS = 120_000

const unprovidedRequestActor = fromPromise<string | undefined, RestartClient>(async () => {
  throw new Error('The thread-sidebar restart actor was not provided.')
})
const unprovidedWaitActor = fromPromise<void, { readonly client: RestartClient; readonly previousRun: string | undefined; readonly pollMs: number }>(
  async () => {
    throw new Error('The thread-sidebar restart wait actor was not provided.')
  },
)

// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
const restartMachine = setup({
  types: {
    context: {} as RestartContext,
    events: {} as RestartEvent,
    input: {} as RestartInput,
  },
  actors: { requestRestart: unprovidedRequestActor, waitForNewHost: unprovidedWaitActor },
  delays: { stall: ({ context }) => context.stallMs },
}).createMachine({
  id: 'thread-sidebar-restart',
  initial: 'closed',
  context: ({ input }) => ({
    client: input.client,
    pollMs: input.pollMs ?? RESTART_POLL_MS,
    stallMs: input.stallMs ?? RESTART_STALL_MS,
    previousRun: undefined,
  }),
  on: {
    watch: { target: '.restarting', actions: assign({ previousRun: ({ event }) => event.run }) },
  },
  states: {
    closed: { on: { open: 'confirming' } },
    confirming: { on: { cancel: 'closed', confirm: 'requesting' } },
    requesting: {
      invoke: {
        src: 'requestRestart',
        input: ({ context }) => context.client,
        onDone: { target: 'restarting', actions: assign({ previousRun: ({ event }) => event.output }) },
        onError: { target: 'failed' },
      },
    },
    failed: { on: { cancel: 'closed', confirm: 'requesting' } },
    /** The old Host was asked to exit; the page reconnects on its own once the new Host answers. */
    restarting: {
      invoke: {
        src: 'waitForNewHost',
        input: ({ context }) => ({ client: context.client, previousRun: context.previousRun, pollMs: context.pollMs }),
        onDone: { target: 'closed' },
      },
      after: { stall: 'stalled' },
      on: { cancel: 'closed' },
    },
    /** No new Host answered in time: the dialog names where to look and how to start DSH again. */
    stalled: {
      invoke: {
        src: 'waitForNewHost',
        input: ({ context }) => ({ client: context.client, previousRun: context.previousRun, pollMs: context.pollMs }),
        onDone: { target: 'closed' },
      },
      on: { retry: 'restarting', cancel: 'closed' },
    },
  },
})

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = globalThis.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      globalThis.clearTimeout(timer)
      resolve()
    })
  })

/**
 * Resolves once a Host other than `previousRun` answers. A Host without the `run` field counts as new once it answers
 * after at least one failed poll, the old Host having gone away in between.
 */
export const waitForNewHost = async (input: {
  readonly client: Pick<RestartClient, 'availability'>
  readonly previousRun: string | undefined
  readonly pollMs: number
  readonly signal: AbortSignal
}): Promise<void> => {
  let sawFailure = false
  while (!input.signal.aborted) {
    await pause(input.pollMs, input.signal)
    if (input.signal.aborted) return
    const answer = await input.client.availability(undefined, { signal: input.signal }).catch(() => undefined)
    if (answer === undefined) {
      sawFailure = true
      continue
    }
    if (answer.run !== undefined && input.previousRun !== undefined ? answer.run !== input.previousRun : sawFailure) return
  }
}

export const provideRestartMachine = () =>
  restartMachine.provide({
    actors: {
      requestRestart: fromPromise<string | undefined, RestartClient>(async ({ input, signal }) => {
        const before = await input.availability(undefined, { signal }).catch(() => undefined)
        await input.requestRestart(undefined, { signal })
        return before?.run
      }),
      waitForNewHost: fromPromise<void, { readonly client: RestartClient; readonly previousRun: string | undefined; readonly pollMs: number }>(
        async ({ input, signal }) => waitForNewHost({ ...input, signal }),
      ),
    },
  })
