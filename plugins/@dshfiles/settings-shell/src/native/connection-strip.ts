/**
 * The page's one connection state (DESIGN.md Connection). settings-shell watches the socket and probes the Host on
 * every device, decides what the strip says, and publishes the result through the kit's `HostConnection`, which every
 * other plugin reads: clocks stop, spinners stand still and queries refetch on the return.
 */

import type { ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { HostConnection, type HostConnectionInput } from '@dshfiles/plugin-ui/lib/host-connection'
import { assign, createActor, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { probeHost, ReachabilityModel, type ReachabilityState, type ReachabilityView } from './reachability.js'

const REACHABILITY_PROBE_MS = 20_000
const REACHABILITY_CONFIRM_MS = 5_000
const RECOVERED_VISIBLE_MS = 2_000
/** A socket still opening this long after load is no longer the page starting. */
const BOOT_GRACE_MS = 5_000

/** What the strip says; `undefined` draws nothing. */
export type ConnectionStripState = 'reconnecting' | 'offline' | 'connected' | undefined

type ConnectionStripEvent = { readonly type: 'view.changed'; readonly view: ReachabilityView }

/** The last view seen while booting, so the boot grace knows whether the socket is still opening. */
interface ConnectionStripContext {
  readonly view: ReachabilityView
}

/**
 * Reconnecting, then offline after two failed probes, then Connected for two seconds. Offline holds through the retry
 * probes that run during an outage, so the strip does not flip its sentence (and the screen reader does not repeat
 * it) every 20 s. Before the first answer a socket that is still opening is the page starting, not DSH going away.
 */
export const connectionStripMachine = setup({
  types: {
    context: {} as ConnectionStripContext,
    events: {} as ConnectionStripEvent,
  },
  guards: {
    online: ({ event }) => event.view === 'online',
    checking: ({ event }) => event.view === 'checking',
    offline: ({ event }) => event.view === 'offline',
    stillChecking: ({ context }) => context.view === 'checking',
  },
  actions: {
    remember: assign({ view: ({ event }) => event.view }),
  },
}).createMachine({
  id: 'connection-strip',
  initial: 'booting',
  context: { view: 'online' },
  states: {
    booting: {
      after: { [BOOT_GRACE_MS]: [{ guard: 'stillChecking', target: 'reconnecting' }, { target: 'hidden' }] },
      on: {
        'view.changed': [{ guard: 'online', target: 'hidden' }, { guard: 'offline', target: 'offline' }, { actions: 'remember' }],
      },
    },
    hidden: {
      on: { 'view.changed': [{ guard: 'checking', target: 'reconnecting' }, { guard: 'offline', target: 'offline' }] },
    },
    reconnecting: {
      on: { 'view.changed': [{ guard: 'online', target: 'connected' }, { guard: 'offline', target: 'offline' }] },
    },
    offline: {
      on: { 'view.changed': [{ guard: 'online', target: 'connected' }] },
    },
    connected: {
      after: { [RECOVERED_VISIBLE_MS]: { target: 'hidden' } },
      on: { 'view.changed': [{ guard: 'checking', target: 'reconnecting' }, { guard: 'offline', target: 'offline' }] },
    },
  },
})

type ConnectionStripSnapshot = ReturnType<ActorRefFrom<typeof connectionStripMachine>['getSnapshot']>

export const connectionStripState = (snapshot: ConnectionStripSnapshot): ConnectionStripState => {
  if (snapshot.matches('reconnecting')) return 'reconnecting'
  if (snapshot.matches('offline')) return 'offline'
  return snapshot.matches('connected') ? 'connected' : undefined
}

/** What every other plugin reads: "Connected" is already online, so queries refetch while it shows. */
const publishedState = (strip: ConnectionStripState): HostConnectionInput => (strip === 'reconnecting' || strip === 'offline' ? strip : 'online')

export interface HostReachabilityDeps {
  readonly connectionState: ObservableSnapshot<ConnectionState | undefined>
  /** Reopens the socket: after a probe finds the Host again, and on Retry. */
  readonly reconnect: () => void
  /** One reachability probe; tests replace it. */
  readonly probe?: () => Promise<boolean>
}

export interface HostReachability {
  readonly reachability: ObservableSnapshot<ReachabilityState>
  readonly strip: ObservableSnapshot<ConnectionStripState>
  readonly retry: () => void
  readonly dispose: () => void
}

/**
 * Probe on resume, on `online`, at once on each socket change and every 20 s while the page is visible, on every
 * device; a first miss is confirmed 5 s later. A probe that reaches the Host again after an outage reopens the socket.
 */
export const startHostReachability = (deps: HostReachabilityDeps): HostReachability => {
  const probe = deps.probe ?? (() => probeHost())
  const reachability = createSnapshotStore<ReachabilityState>(ReachabilityModel.initial)
  const actor = createActor(connectionStripMachine).start()
  let disposed = false
  let confirm: ReturnType<typeof setTimeout> | undefined
  let socket = deps.connectionState.getSnapshot()
  /** Whether the socket moved since the probe last found the Host: a socket that reopened itself is not stale. */
  let socketMoved = false

  const probeNow = (): void => {
    if (disposed || reachability.getSnapshot().probing) return
    reachability.set(ReachabilityModel.started(reachability.getSnapshot()))
    void probe().then((reachable) => {
      if (disposed) return
      const next = ReachabilityModel.settled(reachability.getSnapshot(), reachable)
      // A probe that finds the Host again reopens a socket that never noticed the outage (a silent tunnel) or gave up; one
      // that
      // is reopening (or reopened) itself is left alone, so the strip does not flip back to Reconnecting.
      const stale = !socketMoved || socket === 'disconnected'
      if (reachable) socketMoved = false
      reachability.set(next.state)
      if (next.recovered && stale) deps.reconnect()
      // One miss is not an outage yet (a phone just woke); confirm it soon instead of a full interval later.
      if (!reachable && next.state.probe !== 'unreachable') {
        clearTimeout(confirm)
        confirm = setTimeout(probeNow, REACHABILITY_CONFIRM_MS)
      }
    })
  }

  const sendView = (): void => {
    actor.send({ type: 'view.changed', view: ReachabilityModel.view({ state: reachability.getSnapshot(), connection: deps.connectionState.getSnapshot() }) })
  }
  const visible = (): boolean => document.visibilityState === 'visible'

  const strip = actor.subscribe(snapshot => HostConnection.publish(publishedState(connectionStripState(snapshot))))
  const offReachability = reachability.subscribe(sendView)
  const offSocket = deps.connectionState.subscribe(() => {
    const next = deps.connectionState.getSnapshot()
    if (next === socket) return
    socket = next
    socketMoved = true
    sendView()
    probeNow()
  })
  sendView()

  const onVisibility = (): void => {
    if (visible()) probeNow()
  }
  const interval = setInterval(() => {
    if (visible()) probeNow()
  }, REACHABILITY_PROBE_MS)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', probeNow)

  return {
    reachability,
    strip: {
      getSnapshot: () => connectionStripState(actor.getSnapshot()),
      subscribe: (listener) => {
        const subscription = actor.subscribe(() => listener())
        return () => subscription.unsubscribe()
      },
    },
    retry: () => {
      probeNow()
      deps.reconnect()
    },
    dispose: () => {
      disposed = true
      clearInterval(interval)
      clearTimeout(confirm)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', probeNow)
      offSocket()
      offReachability()
      strip.unsubscribe()
      actor.stop()
      // A bundle that goes away must not leave every clock on the page stopped.
      HostConnection.publish('online')
    },
  }
}
