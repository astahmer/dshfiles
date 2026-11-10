import { assign, fromCallback, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useRef } from 'react'

/** The subset of both sign-in status schemas this flow needs; query data stays in TanStack Query. */
export interface DeviceSignInStatus {
  readonly status: 'idle' | 'starting' | 'waiting' | 'complete' | 'error' | 'cancelled'
}

export interface DeviceSignInPorts {
  readonly begin: () => Promise<DeviceSignInStatus>
  readonly cancel: () => Promise<void>
  readonly signOut?: () => Promise<void>
  readonly onConnected: () => void
  readonly onCancelled: () => void
}

export type DeviceSignInFailure = 'begin' | 'cancel' | 'signOut'

interface DeviceSignInPortsRef {
  readonly read: () => DeviceSignInPorts
}

interface DeviceSignInContext {
  readonly ports: DeviceSignInPortsRef
  readonly failure: DeviceSignInFailure | null
}

type DeviceSignInStatusUpdate = { readonly type: 'began' | 'observed'; readonly status: DeviceSignInStatus['status'] }

type DeviceSignInEvent =
  | { readonly type: 'begin' }
  | { readonly type: 'cancel' }
  | { readonly type: 'signOut' }
  | { readonly type: 'reset' }
  | DeviceSignInStatusUpdate
  | { readonly type: 'begin.failed' }
  | { readonly type: 'cancel.done' }
  | { readonly type: 'cancel.failed' }
  | { readonly type: 'signOut.done' }
  | { readonly type: 'signOut.failed' }

const beginActor = fromCallback<DeviceSignInEvent, { readonly begin: DeviceSignInPorts['begin'] }>(({ input, sendBack }) => {
  void input.begin().then(
    status => sendBack({ type: 'began', status: status.status }),
    () => sendBack({ type: 'begin.failed' }),
  )
  return () => undefined
})

const cancelActor = fromCallback<DeviceSignInEvent, { readonly cancel: DeviceSignInPorts['cancel'] }>(({ input, sendBack }) => {
  void input.cancel().then(
    () => sendBack({ type: 'cancel.done' }),
    () => sendBack({ type: 'cancel.failed' }),
  )
  return () => undefined
})

const signOutActor = fromCallback<DeviceSignInEvent, { readonly signOut: () => Promise<void> }>(({ input, sendBack }) => {
  void input.signOut().then(
    () => sendBack({ type: 'signOut.done' }),
    () => sendBack({ type: 'signOut.failed' }),
  )
  return () => undefined
})

const statusOf = (event: DeviceSignInEvent): DeviceSignInStatus['status'] | null => (event.type === 'began' || event.type === 'observed' ? event.status : null)

// SAFETY: XState uses empty carriers for inference; the runtime machine and its events are typed above.
export const deviceSignInMachine = setup({
  types: {
    context: {} as DeviceSignInContext,
    events: {} as DeviceSignInEvent,
    input: {} as { readonly ports: DeviceSignInPortsRef },
  },
  actors: {
    begin: beginActor,
    cancel: cancelActor,
    signOut: signOutActor,
  },
  guards: {
    hasSignOut: ({ context }) => context.ports.read().signOut !== undefined,
    complete: ({ event }) => statusOf(event) === 'complete',
    cancelled: ({ event }) => statusOf(event) === 'cancelled',
    pending: ({ event }) => statusOf(event) === 'starting' || statusOf(event) === 'waiting',
    settles: ({ event }) => statusOf(event) === 'idle' || statusOf(event) === 'error',
  },
  actions: {
    clearFailure: assign({ failure: null }),
    noteBeginFailure: assign({ failure: 'begin' }),
    noteCancelFailure: assign({ failure: 'cancel' }),
    noteSignOutFailure: assign({ failure: 'signOut' }),
    connect: ({ context }) => context.ports.read().onConnected(),
    notifyCancelled: ({ context }) => context.ports.read().onCancelled(),
  },
}).createMachine({
  id: 'deviceSignIn',
  initial: 'ready',
  context: ({ input }) => ({ ports: input.ports, failure: null }),
  on: {
    reset: { target: '#deviceSignIn.ready', actions: 'clearFailure' },
  },
  states: {
    ready: {
      on: {
        begin: { target: 'starting', actions: 'clearFailure' },
        signOut: { guard: 'hasSignOut', target: 'disconnecting', actions: 'clearFailure' },
      },
    },
    starting: {
      invoke: {
        id: 'begin',
        src: 'begin',
        input: ({ context }) => ({ begin: context.ports.read().begin }),
      },
      on: {
        began: [
          { guard: 'complete', target: 'connected', actions: 'connect' },
          { guard: 'cancelled', target: 'cancelled' },
          { guard: 'pending', target: 'polling' },
          { guard: 'settles', target: 'ready' },
        ],
        'begin.failed': { target: 'failed', actions: 'noteBeginFailure' },
      },
    },
    polling: {
      on: {
        observed: [
          { guard: 'complete', target: 'connected', actions: 'connect' },
          { guard: 'cancelled', target: 'cancelled' },
        ],
        cancel: { target: 'cancelling' },
      },
    },
    cancelling: {
      invoke: {
        id: 'cancel',
        src: 'cancel',
        input: ({ context }) => ({ cancel: context.ports.read().cancel }),
      },
      on: {
        'cancel.done': { target: 'cancelled', actions: 'notifyCancelled' },
        'cancel.failed': { target: 'polling', actions: 'noteCancelFailure' },
      },
    },
    connected: {},
    cancelled: {
      on: { begin: { target: 'starting', actions: 'clearFailure' } },
    },
    failed: {
      on: { begin: { target: 'starting', actions: 'clearFailure' } },
    },
    disconnecting: {
      invoke: {
        id: 'signOut',
        src: 'signOut',
        input: ({ context }) => ({ signOut: context.ports.read().signOut ?? (async () => undefined) }),
      },
      on: {
        'signOut.done': { target: 'ready', actions: 'clearFailure' },
        'signOut.failed': { target: 'ready', actions: 'noteSignOutFailure' },
      },
    },
  },
})

/** An unmounting component cancels only the attempt it still owns. */
export const ownsDeviceSignIn = (value: string): boolean => value === 'starting' || value === 'polling'

export const useDeviceSignIn = (input: { readonly instanceId: string; readonly operationId?: string; readonly ports: DeviceSignInPorts }) => {
  const latest = useRef<DeviceSignInPorts>(input.ports)
  latest.current = input.ports
  const ports = useRef<DeviceSignInPortsRef>({ read: () => latest.current })
  const [snapshot, send, actor] = useMachine(deviceSignInMachine, { input: { ports: ports.current } })
  useEffect(() => {
    const cancel = latest.current.cancel
    send({ type: 'reset' })
    return () => {
      if (!ownsDeviceSignIn(actor.getSnapshot().value)) return
      void cancel().catch(() => undefined)
    }
  }, [actor, send, input.instanceId, input.operationId])
  return { snapshot, send }
}
