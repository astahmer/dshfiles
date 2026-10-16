import { assign, createActor, fromPromise, setup, waitFor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'

export interface ModelRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

export interface SideChatPorts {
  /** Fork the source thread at its latest completed turn; resolves the child's id. */
  readonly fork: (sourceId: string) => Promise<string>
  /** Mark the child as a side chat and pin it to the source's model and route, so the provider's prefix cache can hit. */
  readonly configure: (input: { readonly childId: string; readonly title: string; readonly route: ModelRoute | null }) => Promise<void>
  readonly ask: (input: { readonly childId: string; readonly question: string }) => Promise<void>
  readonly openPanel: (childId: string) => void
  readonly archive: (childId: string) => Promise<void>
}

export interface SideChatInput {
  readonly ports: SideChatPorts
  readonly sourceId: string
  readonly question: string
  readonly route: ModelRoute | null
}

interface SideChatContext extends SideChatInput {
  readonly childId: string | null
  readonly error: string | null
}

type SideChatEvent = { readonly type: 'close' } | { readonly type: 'dismiss' }

/** Shown in the thread list filter and the panel tab; the sidebar hides threads whose title starts with it. */
export const SIDE_CHAT_TITLE_PREFIX = 'btw · '

const TITLE_LENGTH = 80

const sideChatTitle = (question: string): string => {
  const oneLine = question.replace(/\s+/gu, ' ').trim()
  return `${SIDE_CHAT_TITLE_PREFIX}${oneLine.length > TITLE_LENGTH ? `${oneLine.slice(0, TITLE_LENGTH - 1)}…` : oneLine}`
}

const failure = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/**
 * forking → configuring → asking → open → archiving → closed. The fork exists from `configuring` on, so every later
 * failure or close archives it: a side chat never lingers in the thread list.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
const sideChatMachine = setup({
  types: {
    input: {} as SideChatInput,
    context: {} as SideChatContext,
    events: {} as SideChatEvent,
  },
  actors: {
    fork: fromPromise<string, { readonly ports: SideChatPorts; readonly sourceId: string }>(({ input }) => input.ports.fork(input.sourceId)),
    configure: fromPromise<void, { readonly ports: SideChatPorts; readonly childId: string; readonly question: string; readonly route: ModelRoute | null }>(
      ({ input }) => input.ports.configure({ childId: input.childId, title: sideChatTitle(input.question), route: input.route }),
    ),
    ask: fromPromise<void, { readonly ports: SideChatPorts; readonly childId: string; readonly question: string }>(({ input }) =>
      input.ports.ask({ childId: input.childId, question: input.question }),
    ),
    archive: fromPromise<void, { readonly ports: SideChatPorts; readonly childId: string }>(({ input }) => input.ports.archive(input.childId)),
  },
}).createMachine({
  id: 'sideChat',
  context: ({ input }) => ({ ...input, childId: null, error: null }),
  initial: 'forking',
  states: {
    forking: {
      invoke: {
        src: 'fork',
        input: ({ context }) => ({ ports: context.ports, sourceId: context.sourceId }),
        onDone: { target: 'configuring', actions: assign(({ event }) => ({ childId: event.output })) },
        onError: { target: 'failed', actions: assign(({ event }) => ({ error: failure(event.error) })) },
      },
    },
    configuring: {
      invoke: {
        src: 'configure',
        input: ({ context }) => ({ ports: context.ports, childId: context.childId ?? '', question: context.question, route: context.route }),
        onDone: 'asking',
        onError: { target: 'archiving', actions: assign(({ event }) => ({ error: failure(event.error) })) },
      },
    },
    asking: {
      entry: ({ context }) => context.ports.openPanel(context.childId ?? ''),
      invoke: {
        src: 'ask',
        input: ({ context }) => ({ ports: context.ports, childId: context.childId ?? '', question: context.question }),
        onDone: 'open',
        onError: { target: 'archiving', actions: assign(({ event }) => ({ error: failure(event.error) })) },
      },
      on: { close: 'archiving' },
    },
    open: {
      on: { close: 'archiving' },
    },
    archiving: {
      invoke: {
        src: 'archive',
        input: ({ context }) => ({ ports: context.ports, childId: context.childId ?? '' }),
        onDone: [{ guard: ({ context }) => context.error !== null, target: 'failed' }, { target: 'closed' }],
        onError: { target: 'failed', actions: assign(({ context, event }) => ({ error: context.error ?? failure(event.error) })) },
      },
    },
    failed: {
      on: { dismiss: 'closed', close: 'closed' },
    },
    closed: { type: 'final' },
  },
})

export type SideChatActor = ActorRefFrom<typeof sideChatMachine>

export const startSideChat = (input: SideChatInput): SideChatActor => createActor(sideChatMachine, { input }).start()

export type SideChatStart = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** Waits for the fork only: a refusal is reported to whoever asked, while the answer itself streams into the tab. */
const sideChatStarted = async (actor: SideChatActor): Promise<SideChatStart> => {
  const settled = await waitFor(actor, snapshot => !snapshot.matches('forking') && !snapshot.matches('configuring'))
  if (settled.matches('asking') || settled.matches('open')) return { ok: true }
  return { ok: false, reason: settled.context.error ?? 'unknown' }
}

export class SideChatModel {
  static readonly title = sideChatTitle
  static readonly started = sideChatStarted
}
