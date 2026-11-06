import type { ApiClient } from '@dshfiles/dshx/api'
import { assign, fromCallback, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { threadSidebarRestartApi } from './restart-api.js'

export type RestartClient = Pick<
  ApiClient<typeof threadSidebarRestartApi.methods>,
  'requestRestart' | 'requestRestartWhenIdle' | 'cancelPendingRestart' | 'availability'
>

type RestartAvailability = Awaited<ReturnType<RestartClient['availability']>>
export type RestartPending = NonNullable<RestartAvailability['pending']>

type RestartEvent =
  | { readonly type: 'open' }
  | { readonly type: 'cancel' }
  | { readonly type: 'confirm' }
  /** Ask the Host to restart once its running turns finish. */
  | { readonly type: 'whenIdle' }
  /** Call off a restart waiting for idle, before the Host begins it. */
  | { readonly type: 'cancelWhenIdle' }
  /** A restart waiting for idle this page did not request, such as one another tab or an earlier page asked for. */
  | { readonly type: 'pendingSeen'; readonly pending: RestartPending }
  | { readonly type: 'pendingChanged'; readonly pending: RestartPending }
  | { readonly type: 'drained'; readonly run: string | undefined }
  | { readonly type: 'drainLost' }
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
  /** The restart waiting for idle the Host reports, if any. */
  readonly pending: RestartPending | null
  readonly dialogOpen: boolean
}

/** How often the page asks whether the new Host answers, and how long before it says the Host did not come back. */
export const RESTART_POLL_MS = 2_000
export const RESTART_STALL_MS = 120_000
/** How many polls a restart that was accepted for idle may take to appear before the page stops watching it. */
const PENDING_DISCOVERY_POLLS = 20

const unprovidedRequestActor = fromPromise<string | undefined, RestartClient>(async () => {
  throw new Error('The thread-sidebar restart actor was not provided.')
})
const unprovidedIdleRequestActor = fromPromise<void, RestartClient>(async () => {
  throw new Error('The thread-sidebar restart-when-idle actor was not provided.')
})
const unprovidedCancelActor = fromPromise<void, RestartClient>(async () => {
  throw new Error('The thread-sidebar cancel actor was not provided.')
})
const unprovidedWaitActor = fromPromise<void, { readonly client: RestartClient; readonly previousRun: string | undefined; readonly pollMs: number }>(
  async () => {
    throw new Error('The thread-sidebar restart wait actor was not provided.')
  },
)
const unprovidedDrainActor = fromCallback<RestartEvent, { readonly client: RestartClient; readonly pollMs: number }>(() => undefined)

// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
const restartMachine = setup({
  types: {
    context: {} as RestartContext,
    events: {} as RestartEvent,
    input: {} as RestartInput,
  },
  actors: {
    requestRestart: unprovidedRequestActor,
    requestRestartWhenIdle: unprovidedIdleRequestActor,
    cancelPendingRestart: unprovidedCancelActor,
    waitForNewHost: unprovidedWaitActor,
    waitForPendingRestart: unprovidedDrainActor,
  },
  delays: { stall: ({ context }) => context.stallMs },
  actions: {
    openDialog: assign({ dialogOpen: true }),
    closeDialog: assign({ dialogOpen: false }),
    recordPending: assign({
      pending: ({ event }) => (event.type === 'pendingSeen' || event.type === 'pendingChanged' ? event.pending : null),
    }),
    clearPending: assign({ pending: null }),
    captureDrainedRun: assign({
      previousRun: ({ event }) => (event.type === 'drained' ? event.run : undefined),
      pending: null,
    }),
  },
}).createMachine({
  id: 'thread-sidebar-restart',
  initial: 'idle',
  context: ({ input }) => ({
    client: input.client,
    pollMs: input.pollMs ?? RESTART_POLL_MS,
    stallMs: input.stallMs ?? RESTART_STALL_MS,
    previousRun: undefined,
    pending: null,
    dialogOpen: false,
  }),
  on: {
    open: { actions: 'openDialog' },
    cancel: { actions: 'closeDialog' },
  },
  states: {
    idle: {
      on: {
        confirm: 'requesting',
        whenIdle: 'requestingIdle',
        pendingSeen: { target: 'draining', actions: 'recordPending' },
      },
    },
    requestingIdle: {
      invoke: {
        src: 'requestRestartWhenIdle',
        input: ({ context }) => context.client,
        onDone: { target: 'draining', actions: ['closeDialog', 'clearPending'] },
        onError: { target: 'failed', actions: 'openDialog' },
      },
    },
    /** The Host holds a restart until its running turns finish: the dialog may open over it without losing the wait. */
    draining: {
      initial: 'dismissed',
      invoke: {
        src: 'waitForPendingRestart',
        input: ({ context }) => ({ client: context.client, pollMs: context.pollMs }),
      },
      on: {
        pendingChanged: { actions: 'recordPending' },
        drained: { target: 'restarting', actions: ['openDialog', 'captureDrainedRun'] },
        drainLost: { target: 'idle', actions: 'clearPending' },
        cancelWhenIdle: 'cancelingPending',
      },
      states: {
        dismissed: { on: { open: { target: 'prompted', actions: 'openDialog' } } },
        prompted: { on: { cancel: { target: 'dismissed', actions: 'closeDialog' } } },
      },
    },
    cancelingPending: {
      invoke: {
        src: 'cancelPendingRestart',
        input: ({ context }) => context.client,
        onDone: { target: 'idle', actions: 'clearPending' },
        onError: { target: 'idle', actions: 'clearPending' },
      },
    },
    requesting: {
      invoke: {
        src: 'requestRestart',
        input: ({ context }) => context.client,
        onDone: { target: 'restarting', actions: [assign({ previousRun: ({ event }) => event.output }), 'openDialog'] },
        onError: { target: 'failed', actions: 'openDialog' },
      },
      on: { cancel: { target: 'idle', actions: 'closeDialog' } },
    },
    failed: {
      on: {
        cancel: { target: 'idle', actions: 'closeDialog' },
        confirm: 'requesting',
        whenIdle: 'requestingIdle',
      },
    },
    /** The old Host was asked to exit; the page reconnects on its own once the new Host answers. */
    restarting: {
      invoke: {
        src: 'waitForNewHost',
        input: ({ context }) => ({ client: context.client, previousRun: context.previousRun, pollMs: context.pollMs }),
        onDone: { target: 'idle', actions: 'closeDialog' },
      },
      after: { stall: 'stalled' },
      on: { cancel: { target: 'idle', actions: 'closeDialog' } },
    },
    /** No new Host answered in time: the dialog names where to look and how to start DSH again. */
    stalled: {
      invoke: {
        src: 'waitForNewHost',
        input: ({ context }) => ({ client: context.client, previousRun: context.previousRun, pollMs: context.pollMs }),
        onDone: { target: 'idle', actions: 'closeDialog' },
      },
      on: { retry: 'restarting', cancel: { target: 'idle', actions: 'closeDialog' } },
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
      requestRestartWhenIdle: fromPromise<void, RestartClient>(async ({ input, signal }) => {
        await input.requestRestartWhenIdle(undefined, { signal })
      }),
      cancelPendingRestart: fromPromise<void, RestartClient>(async ({ input, signal }) => {
        await input.cancelPendingRestart(undefined, { signal })
      }),
      waitForNewHost: fromPromise<void, { readonly client: RestartClient; readonly previousRun: string | undefined; readonly pollMs: number }>(
        async ({ input, signal }) => waitForNewHost({ ...input, signal }),
      ),
      waitForPendingRestart: fromCallback<RestartEvent, { readonly client: RestartClient; readonly pollMs: number }>(({ input, sendBack }) => {
        const controller = new AbortController()
        let stopped = false
        const watch = async (): Promise<void> => {
          let seenRun: string | undefined
          let seen = false
          let polls = 0
          while (!stopped) {
            if (polls > 0) await pause(input.pollMs, controller.signal)
            if (stopped) return
            polls += 1
            const answer = await input.client.availability(undefined, { signal: controller.signal }).catch(() => undefined)
            if (stopped) return
            if (answer === undefined) {
              if (seen) sendBack({ type: 'drained', run: seenRun })
              else sendBack({ type: 'drainLost' })
              return
            }
            const pending = answer.pending
            if (pending !== undefined && pending !== null) {
              seen = true
              seenRun = answer.run ?? seenRun
              sendBack({ type: 'pendingChanged', pending })
              continue
            }
            if (seen) {
              sendBack({ type: 'drained', run: seenRun })
              return
            }
            if (polls >= PENDING_DISCOVERY_POLLS) {
              sendBack({ type: 'drainLost' })
              return
            }
          }
        }
        void watch()
        return () => {
          stopped = true
          controller.abort()
        }
      }),
    },
  })
