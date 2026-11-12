import net from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect, Layer } from 'effect'
import { NodeServices } from '@effect/platform-node'
import { afterEach, describe, expect, it } from 'vitest'
import { createAccess, type AccessDeps, type EdgeLink } from '../src/access.ts'
import { holderOf, inspectBusyPort } from '../src/busy-port.ts'
import { createPairingGateway } from '../src/gateway.ts'
import type { PhoneSettings } from '../src/settings.ts'
import { createPairingStore } from '../src/store.ts'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** A loopback port some other program holds, the live case (phone-access's proxy on 3443). */
const occupied = async (): Promise<number> => {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  if (address === null || !('port' in address)) throw new Error('no port')
  return address.port
}

/** A port nothing holds right now. */
const freePort = async (): Promise<number> => {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  await new Promise<void>(resolve => server.close(() => resolve()))
  if (address === null || !('port' in address)) throw new Error('no port')
  return address.port
}

const fixture = async (input: {
  readonly defaultPort: number
  readonly tunnel?: AccessDeps['startTunnel']
  readonly edge?: EdgeLink
  readonly settings?: PhoneSettings
}) => {
  const directory = await mkdtemp(join(tmpdir(), 'phone-access-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  let settings: PhoneSettings | undefined = input.settings ?? { enabled: false }
  const saved: PhoneSettings[] = []
  const tunnel = input.tunnel ?? (async () => ({ origin: 'https://phone.example', stop: async () => {} }))
  /** Every tunnel start, as `[port, provider]`. */
  const tunnels: Parameters<AccessDeps['startTunnel']>[] = []
  const startTunnel: AccessDeps['startTunnel'] = async (...args) => {
    tunnels.push(args)
    return tunnel(...args)
  }
  const closed: number[] = []
  const access = createAccess({
    edge: input.edge,
    defaultPort: input.defaultPort,
    settingsPath: join(directory, 'settings.json'),
    openStore: () => createPairingStore({ path: join(directory, 'devices.json') }),
    settings: () => settings,
    saveSettings: async next => {
      saved.push(next)
      settings = next
    },
    resolveProvider: async preferred => preferred ?? 'tailscale-serve',
    startTunnel,
    serverPort: () => 1,
    createGateway: gatewayInput => {
      const gateway = createPairingGateway({
        upstream: gatewayInput.upstream,
        port: gatewayInput.port,
        store: gatewayInput.store,
        publicOrigin: gatewayInput.origin,
        nativeCookie: async () => undefined,
      })
      return {
        listen: () => gateway.listen(),
        port: () => gateway.port(),
        close: () => {
          closed.push(gatewayInput.port)
          gateway.server.close()
        },
      }
    },
    inspectBusyPort: async () => ({ holder: 'this DSH', holderSelf: true, suggestedPort: input.defaultPort + 1 }),
    tunnelHint: () => 'Install cloudflared: brew install cloudflared.',
  })
  cleanups.push(() => access.dispose())
  return { access, saved, tunnels, closed }
}

describe('phone access lifecycle', () => {
  it('reports a busy gateway port with its holder and a free port, and starts no tunnel', async () => {
    const port = await occupied()
    const { access, tunnels } = await fixture({ defaultPort: port })
    const status = await access.enable()
    expect(status.enabled).toBe(false)
    expect(status.problem).toEqual({ reason: 'port-busy', port, holder: 'this DSH', holderSelf: true, suggestedPort: port + 1 })
    expect(status.failure).toMatch(new RegExp(`Port ${String(port)} is already in use by this DSH`, 'u'))
    expect(status.failure).toMatch(/lsof -nP/u)
    expect(tunnels).toEqual([])
    // Before this fix the half-started gateway read as "on" and kept minting codes nothing could redeem.
    expect(access.offer()).toEqual({ state: 'off' })
    expect(access.status().enabled).toBe(false)
  })

  it('turns on with the suggested port, remembers it, and mints from then on', async () => {
    const port = await occupied()
    const free = await freePort()
    const { access, saved, tunnels } = await fixture({ defaultPort: port })
    await access.enable()
    const status = await access.enable({ port: free })
    expect(status).toEqual({ enabled: true, origin: 'https://phone.example', port: free, mode: 'own' })
    expect(tunnels).toEqual([[free, 'tailscale-serve']])
    expect(saved.at(-1)).toEqual({ enabled: true, provider: 'tailscale-serve', port: free })
    expect(access.offer()).toMatchObject({ state: 'ready', origin: 'https://phone.example' })
    await access.disable()
    expect(saved.at(-1)).toEqual({ enabled: false, provider: 'tailscale-serve', port: free })
  })

  it('closes the gateway again when no tunnel starts, and says what to install', async () => {
    const port = await freePort()
    const { access, closed } = await fixture({ defaultPort: port, tunnel: async () => undefined })
    const status = await access.enable()
    expect(status.enabled).toBe(false)
    expect(status.problem).toEqual({ reason: 'no-tunnel', port })
    expect(status.failure).toMatch(/brew install cloudflared/u)
    expect(closed).toEqual([port])
  })

  it('joins a second enable while the first is starting', async () => {
    const port = await freePort()
    const { access, tunnels } = await fixture({ defaultPort: port })
    const [first, second] = await Promise.all([access.enable(), access.enable()])
    expect(first.enabled && second.enabled).toBe(true)
    expect(tunnels).toHaveLength(1)
  })
})

/** A phone-access edge double that records every claim and release. */
const edgeDouble = (origin: string | undefined) => {
  const calls: string[] = []
  const edge: EdgeLink = {
    find: async () => {
      calls.push('find')
      return origin === undefined ? undefined : { origin }
    },
    claim: async port => void calls.push(`claim ${String(port > 0)}`),
    release: async () => void calls.push('release'),
  }
  return { edge, calls }
}

describe('phone access on Phone access QR’s origin (shared) or its own tunnel (own)', () => {
  it('reuses phone-access’s origin: claims its routes, starts no tunnel, and only releases its claim when off', async () => {
    const busyDefault = await occupied()
    const { edge, calls } = edgeDouble('https://machine.example.ts.net')
    const { access, tunnels, saved } = await fixture({ defaultPort: busyDefault, edge })
    const status = await access.enable()
    expect(status).toMatchObject({ enabled: true, origin: 'https://machine.example.ts.net', mode: 'shared' })
    expect(status.port).not.toBe(busyDefault)
    expect(access.offer()).toMatchObject({ state: 'ready', origin: 'https://machine.example.ts.net' })
    expect(tunnels).toEqual([])
    await access.disable()
    expect(calls).toEqual(['find', 'claim true', 'release'])
    expect(tunnels).toEqual([])
    expect(saved.at(-1)).toMatchObject({ enabled: false })
  })

  it('runs its own tunnel only when phone-access has no origin', async () => {
    const { edge, calls } = edgeDouble(undefined)
    const { access, tunnels } = await fixture({ defaultPort: await freePort(), edge })
    const status = await access.enable()
    expect(status).toMatchObject({ enabled: true, mode: 'own' })
    expect(tunnels).toHaveLength(1)
    await access.disable()
    expect(calls).toEqual(['find'])
  })

  it('keeps a manual origin on its own gateway without asking phone-access', async () => {
    const { edge, calls } = edgeDouble('https://machine.example.ts.net')
    const { access, tunnels } = await fixture({
      defaultPort: await freePort(),
      edge,
      settings: { enabled: false, provider: 'manual', origin: 'https://mine.example' },
    })
    expect(await access.enable()).toMatchObject({ enabled: true, origin: 'https://mine.example', mode: 'own' })
    expect(tunnels).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('manual origin', () => {
  it('refuses a plain-http origin the phone cookie cannot live on, before any gateway or code exists', async () => {
    const port = await freePort()
    const { access, closed, tunnels } = await fixture({
      defaultPort: port,
      settings: { enabled: false, provider: 'manual', origin: 'http://phone.lan:8080' },
    })
    const status = await access.enable()
    expect(status).toMatchObject({ enabled: false, problem: { reason: 'insecure-origin' } })
    expect(status.failure).toMatch(/https:\/\//u)
    expect(access.offer()).toEqual({ state: 'off' })
    expect(closed).toEqual([])
    expect(tunnels).toEqual([])
  })

  it('accepts loopback http for a desktop check', async () => {
    const { access } = await fixture({
      defaultPort: await freePort(),
      settings: { enabled: false, provider: 'manual', origin: 'http://127.0.0.1:3443' },
    })
    expect(await access.enable()).toMatchObject({ enabled: true, origin: 'http://127.0.0.1:3443', mode: 'own' })
  })
})

describe('busy port inspection', () => {
  it('names this DSH, another program or nobody from lsof output', () => {
    expect(holderOf('p42\ncnode\n', 42)).toEqual({ holder: 'this DSH', holderSelf: true })
    expect(holderOf('p7\ncControl Center\n', 42)).toEqual({ holder: 'Control Center (pid 7)', holderSelf: false })
    expect(holderOf('', 42)).toEqual({ holderSelf: false })
  })

  it('records one busy-port span and suggests a free port next to it', async () => {
    const port = await occupied()
    using recorder = recordSpans()
    const busy = await Effect.runPromise(inspectBusyPort(port).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, tracerLayer))))
    // The test process itself holds the port, as phone-access's proxy holds 3443 inside the live DSH (needs lsof).
    if (busy.holder !== undefined) expect(busy.holderSelf).toBe(true)
    expect(busy.suggestedPort).toBeGreaterThan(port)
    expect(recorder.named('phone pairing busy port')).toHaveLength(1)
    expect(JSON.stringify(recorder.spans.map(span => span.attributes))).not.toContain(String(port))
  })
})

describe('pending offers', () => {
  it('replaces the oldest pending offer instead of refusing a new one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phone-offers-'))
    cleanups.push(() => rm(directory, { recursive: true, force: true }))
    const store = await createPairingStore({ path: join(directory, 'devices.json'), maxOffers: 3 })
    const offers = Array.from({ length: 5 }, () => store.beginOffer())
    expect(store.pendingOffers()).toBe(3)
    expect(await store.redeem({ code: offers[0]?.code ?? '' })).toBeUndefined()
    expect(await store.redeem({ code: offers[4]?.code ?? '' })).toBeDefined()
  })
})
