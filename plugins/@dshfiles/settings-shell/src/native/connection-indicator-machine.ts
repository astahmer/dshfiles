import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { assign, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'

/** Minimum visible time for the connecting pill; shorter attempts read as flicker. */
const CONNECTING_MIN_VISIBLE_MS = 800
const RECOVERY_CONFIRMATION_MS = 2_000

export type ConnectionIndicatorState = 'connecting' | 'disconnected' | 'recovered' | undefined

type HoldTarget = 'idle' | 'disconnected' | 'recovered'

interface ConnectionIndicatorContext {
  readonly initialConnectionState: ConnectionState | undefined
  readonly connectingStartedAt: number
  readonly holdMs: number
  readonly holdTarget: HoldTarget
}

interface ConnectionIndicatorInput {
  readonly connectionState: ConnectionState | undefined
}

type ConnectionIndicatorEvent = { readonly type: 'connection.changed'; readonly state: ConnectionState | undefined }

const targetFor = (state: ConnectionState | undefined): HoldTarget => (state === 'connected' ? 'recovered' : state === 'disconnected' ? 'disconnected' : 'idle')

const holdMsFor = (context: ConnectionIndicatorContext): number => Math.max(CONNECTING_MIN_VISIBLE_MS - (Date.now() - context.connectingStartedAt), 0)

/**
 * The sidebar-foot connection pill: connecting shows for at least its minimum visible time, then a reconnect
 * confirms itself for two seconds before the pill disappears. The timers are transitions, not effects beside it.
 */
export const connectionIndicatorMachine = setup({
  types: {
    context: {} as ConnectionIndicatorContext,
    events: {} as ConnectionIndicatorEvent,
    input: {} as ConnectionIndicatorInput,
  },
  guards: {
    initiallyConnecting: ({ context }) => context.initialConnectionState === 'connecting',
    initiallyDisconnected: ({ context }) => context.initialConnectionState === 'disconnected',
    staysConnecting: ({ event }) => event.state === 'connecting',
    connected: ({ event }) => event.state === 'connected',
    disconnected: ({ event }) => event.state === 'disconnected',
    noConnectionState: ({ event }) => event.state === undefined,
    connectingVisible: ({ context }) => Date.now() - context.connectingStartedAt >= CONNECTING_MIN_VISIBLE_MS,
    recoveringHold: ({ context }) => context.holdTarget === 'recovered',
    disconnectedHold: ({ context }) => context.holdTarget === 'disconnected',
  },
  delays: {
    hold: ({ context }) => context.holdMs,
  },
  actions: {
    startConnecting: assign({ connectingStartedAt: () => Date.now() }),
    beginHold: assign(({ context, event }) => ({ holdMs: holdMsFor(context), holdTarget: targetFor(event.state) })),
    retargetHold: assign(({ event }) => ({ holdTarget: targetFor(event.state) })),
  },
}).createMachine({
  id: 'connection-indicator',
  initial: 'start',
  context: ({ input }) => ({
    initialConnectionState: input.connectionState,
    connectingStartedAt: input.connectionState === 'connecting' ? Date.now() : 0,
    holdMs: CONNECTING_MIN_VISIBLE_MS,
    holdTarget: 'idle',
  }),
  states: {
    start: {
      always: [{ guard: 'initiallyConnecting', target: 'connecting' }, { guard: 'initiallyDisconnected', target: 'disconnected' }, { target: 'idle' }],
    },
    idle: {
      on: {
        'connection.changed': [
          { guard: 'disconnected', target: 'disconnected' },
          { guard: 'staysConnecting', target: 'connecting' },
        ],
      },
    },
    disconnected: {
      on: {
        'connection.changed': [
          { guard: 'staysConnecting', target: 'connecting' },
          { guard: 'connected', target: 'recovered' },
          { guard: 'noConnectionState', target: 'idle' },
        ],
      },
    },
    connecting: {
      entry: 'startConnecting',
      on: {
        'connection.changed': [
          { guard: 'staysConnecting' },
          {
            guard: ({ context, event }) => event.state === 'connected' && Date.now() - context.connectingStartedAt >= CONNECTING_MIN_VISIBLE_MS,
            target: 'recovered',
          },
          { guard: 'connected', target: 'holding', actions: 'beginHold' },
          {
            guard: ({ context, event }) => event.state === 'disconnected' && Date.now() - context.connectingStartedAt >= CONNECTING_MIN_VISIBLE_MS,
            target: 'disconnected',
          },
          { guard: 'disconnected', target: 'holding', actions: 'beginHold' },
          { guard: 'connectingVisible', target: 'idle' },
          { target: 'holding', actions: 'beginHold' },
        ],
      },
    },
    holding: {
      after: {
        hold: [{ guard: 'recoveringHold', target: 'recovered' }, { guard: 'disconnectedHold', target: 'disconnected' }, { target: 'idle' }],
      },
      on: {
        'connection.changed': [
          { guard: 'staysConnecting', target: 'connecting' },
          { guard: ({ context, event }) => event.state === 'connected' && context.holdTarget !== 'idle', actions: 'retargetHold' },
          { guard: 'connected' },
          { guard: 'disconnected', actions: 'retargetHold' },
          { guard: 'noConnectionState', actions: 'retargetHold' },
        ],
      },
    },
    recovered: {
      after: { [RECOVERY_CONFIRMATION_MS]: { target: 'idle' } },
      on: {
        'connection.changed': [
          { guard: 'staysConnecting', target: 'connecting' },
          { guard: 'disconnected', target: 'disconnected' },
          { guard: 'noConnectionState', target: 'idle' },
        ],
      },
    },
  },
})

export type ConnectionIndicatorSnapshot = ReturnType<ActorRefFrom<typeof connectionIndicatorMachine>['getSnapshot']>

export const connectionIndicatorState = (snapshot: ConnectionIndicatorSnapshot): ConnectionIndicatorState => {
  if (snapshot.matches('connecting') || snapshot.matches('holding')) return 'connecting'
  if (snapshot.matches('disconnected')) return 'disconnected'
  return snapshot.matches('recovered') ? 'recovered' : undefined
}
