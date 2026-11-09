import type { LandResult, ThreadView } from '@dshfiles/jj-integration/api'
import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'

/** What the card says after an attempt; one notice for land, queue and unqueue. */
export interface LandNotice {
  readonly tone: 'success' | 'failure'
  readonly text: string
}

/** Host calls the card makes; the machine serialises them so two writes never overlap. */
export interface LandPorts {
  readonly land: (thread: ThreadView) => Promise<LandResult>
  readonly queue: (thread: ThreadView) => Promise<{ readonly queuedAt: number }>
  readonly unqueue: (thread: ThreadView) => Promise<{ readonly status: string }>
  readonly refresh: () => void
}

interface LandContext extends LandPorts {
  readonly thread: ThreadView | null
  readonly notice: LandNotice | null
}

type LandEvent =
  | { readonly type: 'ask'; readonly thread: ThreadView }
  | { readonly type: 'cancel' }
  | { readonly type: 'confirm' }
  | { readonly type: 'queue'; readonly thread: ThreadView }
  | { readonly type: 'unqueue'; readonly thread: ThreadView }
  | { readonly type: 'xstate.done.actor.land'; readonly output: LandResult }
  | { readonly type: 'xstate.done.actor.queue' }
  | { readonly type: 'xstate.done.actor.unqueue'; readonly output: { readonly status: string } }
  | { readonly type: 'xstate.error.actor.land'; readonly error: unknown }
  | { readonly type: 'xstate.error.actor.queue'; readonly error: unknown }
  | { readonly type: 'xstate.error.actor.unqueue'; readonly error: unknown }

/** One attempt's thread; the actors read it from the context the event captured. */
interface AttemptInput {
  readonly thread: ThreadView | null
  readonly ports: LandPorts
}

const describeResult = (result: LandResult): string => {
  if (result.status === 'landed') return `Landed ${String(result.revisions.length)} revision${result.revisions.length === 1 ? '' : 's'} on ${result.bookmark}.`
  if (result.status === 'nothing-to-land') return `Nothing to land: ${result.bookmark} already has this work.`
  if (result.status === 'needs-description') return 'Describe every revision before landing; History lets you write the descriptions.'
  return 'Landing stopped on conflicts. Resolve them in this workspace, then land again.'
}

const landedNotice = (result: LandResult): LandNotice => ({
  tone: result.status === 'landed' || result.status === 'nothing-to-land' ? 'success' : 'failure',
  text: describeResult(result),
})

const failedNotice = (error: unknown, fallback: string): LandNotice => ({ tone: 'failure', text: errorMessage(error, fallback) })

const threadOf = (input: AttemptInput): ThreadView => {
  if (input.thread === null) throw new Error('The land card has no thread workspace to act on.')
  return input.thread
}

// SAFETY: XState uses empty carriers for inference; runtime input and events are typed above.
export const landCardMachine = setup({
  types: {
    context: {} as LandContext,
    events: {} as LandEvent,
    input: {} as LandPorts,
  },
  actors: {
    land: fromPromise<LandResult, AttemptInput>(({ input }) => input.ports.land(threadOf(input))),
    queue: fromPromise<unknown, AttemptInput>(({ input }) => input.ports.queue(threadOf(input))),
    unqueue: fromPromise<{ readonly status: string }, AttemptInput>(({ input }) => input.ports.unqueue(threadOf(input))),
  },
  actions: {
    captureThread: assign(({ event }) => ('thread' in event ? { thread: event.thread } : {})),
    clearNotice: assign({ notice: null }),
    recordLanded: assign(({ event }) => (event.type === 'xstate.done.actor.land' ? { notice: landedNotice(event.output) } : {})),
    recordLandFailure: assign(({ event }) =>
      event.type === 'xstate.error.actor.land' ? { notice: failedNotice(event.error, 'Landing failed. Refresh the card and try again.') } : {},
    ),
    recordQueueFailure: assign(({ event }) =>
      event.type === 'xstate.error.actor.queue' ? { notice: failedNotice(event.error, 'Could not queue the land. Try again once the thread is idle.') } : {},
    ),
    recordUnqueueOutcome: assign(({ event }) =>
      event.type === 'xstate.done.actor.unqueue' && event.output.status === 'integrating'
        ? { notice: { tone: 'failure', text: 'The land already started; wait for it to finish.' } satisfies LandNotice }
        : {},
    ),
    refreshCard: ({ context }) => context.refresh(),
  },
}).createMachine({
  id: 'landCard',
  initial: 'idle',
  context: ({ input }) => ({ ...input, thread: null, notice: null }),
  states: {
    idle: {
      on: {
        ask: { target: 'confirming', actions: ['captureThread', 'clearNotice'] },
        queue: { target: 'queuing', actions: 'captureThread' },
        unqueue: { target: 'unqueuing', actions: 'captureThread' },
      },
    },
    confirming: {
      on: {
        cancel: { target: 'idle', actions: 'clearNotice' },
        ask: { actions: ['captureThread', 'clearNotice'] },
        confirm: { target: 'landing' },
      },
    },
    landing: {
      invoke: {
        id: 'land',
        src: 'land',
        input: ({ context }) => ({ thread: context.thread, ports: context }),
        onDone: { target: 'idle', actions: ['recordLanded', 'refreshCard'] },
        onError: { target: 'idle', actions: ['recordLandFailure', 'refreshCard'] },
      },
    },
    queuing: {
      invoke: {
        id: 'queue',
        src: 'queue',
        input: ({ context }) => ({ thread: context.thread, ports: context }),
        onDone: { target: 'queued', actions: 'refreshCard' },
        onError: { target: 'idle', actions: ['recordQueueFailure', 'refreshCard'] },
      },
    },
    queued: {
      on: {
        unqueue: { target: 'unqueuing', actions: 'captureThread' },
        ask: { target: 'confirming', actions: ['captureThread', 'clearNotice'] },
      },
    },
    unqueuing: {
      invoke: {
        id: 'unqueue',
        src: 'unqueue',
        input: ({ context }) => ({ thread: context.thread, ports: context }),
        onDone: { target: 'idle', actions: ['recordUnqueueOutcome', 'refreshCard'] },
        onError: { target: 'idle', actions: 'refreshCard' },
      },
    },
  },
})
