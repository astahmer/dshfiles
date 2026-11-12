import type { AccessProblem, PairingOffer, PairingStatus } from './api.ts'
import type { BusyPort } from './busy-port.ts'
import type { Provider } from './providers.ts'
import { isCookieSafeOrigin, type PhoneSettings } from './settings.ts'
import type { PairingStore } from './store.ts'

/** What the lifecycle needs from a gateway: bind, and close again. */
export interface AccessGateway {
  readonly listen: () => Promise<void>
  readonly close: () => void
  /** The bound loopback port once listening (an OS-assigned one when asked for 0). */
  readonly port: () => number | undefined
  /** Drop sockets of devices that no longer authenticate (revocation). */
  readonly closeUnauthorised?: () => void
}

/**
 * Phone access QR's proxy as phone pairing sees it: when it listens on a public origin, pairing claims its
 * routes there instead of starting a tunnel, so it never repoints or removes that origin's Tailscale route.
 */
export interface EdgeLink {
  /** The origin phones already use through phone-access; `undefined` when phone-access is absent, not listening or has none. */
  readonly find: () => Promise<{ readonly origin: string } | undefined>
  /** Route `/pair` and the paired-device cookie on that origin to this loopback port. */
  readonly claim: (port: number) => Promise<void>
  readonly release: () => Promise<void>
}

export interface AccessTunnel {
  readonly origin: string
  readonly stop?: () => Promise<void>
}

export interface AccessDeps {
  /** `gatewayPort` from the row config; a port passed to phone_pairing_enable (settings) wins. */
  readonly defaultPort: number
  readonly settingsPath: string
  readonly openStore: () => Promise<PairingStore>
  readonly settings: () => PhoneSettings | undefined
  readonly saveSettings: (next: PhoneSettings) => Promise<void>
  readonly resolveProvider: (preferred: Provider | undefined) => Promise<Provider>
  /** `undefined` when the provider cannot start (not installed, not signed in). */
  readonly startTunnel: (port: number, provider: Provider) => Promise<AccessTunnel | undefined>
  /** The native listener's port the gateway proxies to. */
  readonly serverPort: () => number | undefined
  readonly createGateway: (input: {
    readonly upstream: number
    readonly port: number
    readonly store: PairingStore
    readonly origin: () => string | undefined
  }) => AccessGateway
  readonly inspectBusyPort: (port: number) => Promise<BusyPort>
  /** The install hint for a provider that did not start. */
  readonly tunnelHint: () => string
  /** Absent without phone-access in the profile. */
  readonly edge?: EdgeLink | undefined
}

interface Running {
  readonly gateway: AccessGateway
  readonly origin: string
  readonly port: number
  readonly provider: Provider
  /** `shared`: routes claimed on phone-access's origin; `own`: this plugin's tunnel (or a manual origin). */
  readonly mode: 'shared' | 'own'
  readonly tunnel: AccessTunnel | undefined
}

class AccessFailure extends Error {
  constructor(
    readonly problem: AccessProblem,
    message: string,
  ) {
    super(message)
  }
}

const isAddressInUse = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE'

/** The Host's words for a busy port: who holds it and the two ways out, for the agent tool and the terminal. */
export const busyPortMessage = (port: number, busy: BusyPort): string => {
  const holder = busy.holder === undefined ? '' : ` by ${busy.holder}`
  const self = busy.holderSelf ? ' (another plugin, usually Phone access QR, listens there)' : ''
  const instead = busy.suggestedPort === undefined ? '' : `Turn phone access on with port ${String(busy.suggestedPort)} instead, or free it`
  return `Port ${String(port)} is already in use${holder}${self}, so the pairing gateway cannot start. ${instead === '' ? 'Free it' : instead}: lsof -nP -iTCP:${String(port)} -sTCP:LISTEN shows the program.`
}

/**
 * Phone access on and off, owned in one place. It binds the gateway before it touches a tunnel, publishes
 * nothing until both are up, and rolls back what it started when a step fails, so a busy port never leaves a
 * half-started gateway that reads as "on" and keeps minting codes no phone can redeem.
 */
export const createAccess = (deps: AccessDeps) => {
  let store: PairingStore | undefined
  let running: Running | undefined
  let starting: Promise<PairingStatus> | undefined
  let failure: { readonly problem: AccessProblem; readonly message: string } | undefined

  const status = (): PairingStatus => {
    if (running !== undefined) return { enabled: true, origin: running.origin, port: running.port, mode: running.mode }
    return failure === undefined ? { enabled: false } : { enabled: false, failure: failure.message, problem: failure.problem }
  }

  const bind = async (port: number, upstream: number, pairing: PairingStore, origin: () => string | undefined): Promise<AccessGateway> => {
    const gateway = deps.createGateway({ upstream, port, store: pairing, origin })
    try {
      await gateway.listen()
      return gateway
    } catch (error) {
      gateway.close()
      if (!isAddressInUse(error)) throw error
      const busy = await deps.inspectBusyPort(port).catch((): BusyPort => ({ holderSelf: false }))
      throw new AccessFailure(
        {
          reason: 'port-busy',
          port,
          holderSelf: busy.holderSelf,
          holder: busy.holder,
          suggestedPort: busy.suggestedPort,
        },
        busyPortMessage(port, busy),
      )
    }
  }

  const begin = async (input: { readonly provider?: Provider; readonly port?: number }): Promise<PairingStatus> => {
    const current = deps.settings()
    const port = input.port ?? current?.port ?? deps.defaultPort
    const upstream = deps.serverPort()
    if (upstream === undefined)
      throw new AccessFailure(
        { reason: 'no-listener' },
        "DSH's own web listener is not available, so there is nothing to proxy to. Reload the page; if it stays, restart DSH when your work is finished.",
      )
    if (current?.origin !== undefined && !isCookieSafeOrigin(current.origin))
      throw new AccessFailure(
        { reason: 'insecure-origin' },
        `The manual origin ${current.origin} is not HTTPS, so a phone cannot keep its pairing cookie there. Put an HTTPS reverse proxy in front of the gateway port and set "origin" to its https:// URL in ${deps.settingsPath}, or remove "origin" to use a tunnel. Then turn phone access on again.`,
      )
    store ??= await deps.openStore()
    const provider = await deps.resolveProvider(input.provider ?? current?.provider)
    // A manual origin is the user's own proxy to the gateway port; otherwise phone-access's origin wins over a tunnel.
    const shared = current?.origin === undefined ? await deps.edge?.find().catch(() => undefined) : undefined
    if (shared !== undefined) {
      const gateway = await bind(0, upstream, store, () => shared.origin)
      const bound = gateway.port()
      try {
        if (bound === undefined) throw new Error('the pairing gateway reported no port')
        await deps.edge?.claim(bound)
      } catch (error) {
        gateway.close()
        throw error
      }
      running = { gateway, origin: shared.origin, port: bound, provider, mode: 'shared', tunnel: undefined }
      failure = undefined
      await deps.saveSettings({ enabled: true, provider, origin: current?.origin, port: current?.port })
      return status()
    }
    let origin: string | undefined
    const gateway = await bind(port, upstream, store, () => origin)
    let tunnel: AccessTunnel | undefined
    try {
      tunnel = current?.origin === undefined ? await deps.startTunnel(port, provider) : undefined
    } catch (error) {
      gateway.close()
      throw error
    }
    origin = current?.origin ?? tunnel?.origin
    if (origin === undefined) {
      gateway.close()
      throw new AccessFailure(
        { reason: 'no-tunnel', port },
        `No tunnel started for ${provider}. ${deps.tunnelHint()} Or set "origin" in ${deps.settingsPath}. Then turn phone access on again.`,
      )
    }
    running = { gateway, origin, port, provider, mode: 'own', tunnel }
    failure = undefined
    await deps.saveSettings({ enabled: true, provider, origin: current?.origin, port: input.port ?? current?.port })
    return status()
  }

  /** Turn phone access on; a second call while one runs joins it, and a running gateway answers at once. */
  const enable = (input: { readonly provider?: Provider; readonly port?: number } = {}): Promise<PairingStatus> => {
    if (running !== undefined) return Promise.resolve(status())
    starting ??= begin(input)
      .catch((error: unknown) => {
        failure =
          error instanceof AccessFailure
            ? { problem: error.problem, message: error.message }
            : {
                problem: { reason: 'failed' },
                message: `${error instanceof Error ? error.message : String(error)}. Turn phone access on again; if it keeps failing, ask the agent to run phone_pairing_status.`,
              }
        return status()
      })
      .finally(() => {
        starting = undefined
      })
    return starting
  }

  /** Undo only what this run added: its claim on phone-access's proxy, or its own tunnel route. */
  const teardown = async (stopped: Running | undefined): Promise<void> => {
    if (stopped === undefined) return
    if (stopped.mode === 'shared') await deps.edge?.release().catch(() => undefined)
    stopped.gateway.close()
    await stopped.tunnel?.stop?.()
  }

  const disable = async (): Promise<PairingStatus> => {
    // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot required: `running` clears before the awaits below, so a concurrent enable never sees the stopping gateway.
    const stopped = running
    running = undefined
    failure = undefined
    await teardown(stopped)
    const current = deps.settings()
    if (current !== undefined) await deps.saveSettings({ ...current, enabled: false })
    return status()
  }

  /** `state: 'off'` rather than an error while phone access is off; the popover shows how to turn it on. */
  const offer = (): PairingOffer => {
    if (running === undefined || store === undefined) return { state: 'off' }
    const minted = store.beginOffer()
    return {
      state: 'ready',
      payload: `${running.origin}/pair#id=${minted.id}&secret=${minted.secret}`,
      code: minted.code,
      expiresAt: minted.expiresAt,
      origin: running.origin,
    }
  }

  return {
    status,
    enable,
    disable,
    offer,
    running: (): Readonly<Running> | undefined => running,
    store: (): PairingStore | undefined => store,
    /** Shutdown: close the gateway and stop the tunnel without persisting "off". */
    dispose: async (): Promise<void> => {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot required: `running` clears before the awaits below, so a concurrent enable never sees the stopping gateway.
      const stopped = running
      running = undefined
      await teardown(stopped)
    },
  }
}

export type PhoneAccess = ReturnType<typeof createAccess>
