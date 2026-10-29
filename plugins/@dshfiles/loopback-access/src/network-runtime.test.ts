import { once } from 'node:events'
import { createServer, Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { ConfigEditor } from '@deepseek-ai/dsh-config-editor'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import hostDefinition from './host.js'
import { NetworkController } from './network-controller.js'
import { NETWORK_SETTINGS_NAMESPACE } from './network-preferences.js'
import * as startup from './startup.js'
import { socketClosed } from './socket-closed.test-support.js'

const lanHost = Object.values(networkInterfaces())
  .flat()
  .find(address => address?.family === 'IPv4' && !address.internal)?.address

async function mountRuntime(bindAddress: string, localhostEnabled: boolean, freshDefaults = false) {
  const host = await createTestHost()
  const reservations: ReturnType<typeof createServer>[] = []
  const releaseReservations = () => Promise.all(reservations.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  try {
    let port = 0
    if (bindAddress !== '127.0.0.1') {
      // Hold both loopback families while the native LAN listener takes the same port.
      const ipv4 = createServer()
      reservations.push(ipv4)
      const listening = once(ipv4, 'listening', { signal: AbortSignal.timeout(2_000) })
      ipv4.listen({ host: '127.0.0.1', port: 0, exclusive: true })
      await listening
      port = z.object({ port: z.number().int().min(1).max(65535) }).parse(ipv4.address()).port
      const ipv6 = createServer()
      reservations.push(ipv6)
      try {
        const listeningIPv6 = once(ipv6, 'listening', { signal: AbortSignal.timeout(2_000) })
        ipv6.listen({ host: '::1', port, ipv6Only: true, exclusive: true })
        await listeningIPv6
      } catch (error) {
        if (!z.object({ code: z.enum(['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT']) }).safeParse(error).success) throw error
      }
    }
    await host.ctx.plugin(Loader, { baseUrl: import.meta.url })
    host.ctx.provide('profileContext', {
      name: 'required-localhost-test',
      dir: '/__dsh_required_localhost_test__',
      patchPath: '/__dsh_required_localhost_test__/cordis.patch.yml',
      installAnchor: '/__dsh_required_localhost_test__/package.json',
      cwd: '/__dsh_required_localhost_test__',
      home: '/__dsh_required_localhost_test__',
      startedBundles: [],
      overlays: [],
      telemetryDisabledEnv: undefined,
    })
    // A fresh-defaults test overrides only the port to avoid touching a live listener.
    host.ctx.provide('webStartup', freshDefaults ? { port: 0 } : {})
    const loader = host.ctx.loader
    const editor = new ConfigEditor(host.ctx)
    const settings = new SettingsForms(host.ctx)
    // Only substitute profile storage; Config, Settings, Loader and sockets are native.
    vi.spyOn(editor, 'entries').mockImplementation(() => [...loader.entries()])
    vi.spyOn(editor, 'configuration').mockImplementation(() =>
      [...loader.entries()].map(entry => ({ entry, inherited: {}, override: entry.options.config ?? {} })),
    )
    vi.spyOn(editor, 'edit').mockImplementation(async (entry, change) => {
      await loader.update(entry.id, { config: change(structuredClone(entry.options.config ?? {}), {}) })
      await loader.await()
    })
    loader.builtins['required-localhost-startup'] = startup
    await loader.root.update([
      {
        id: NETWORK_SETTINGS_NAMESPACE,
        name: 'cordis:required-localhost-startup',
        config: freshDefaults
          ? {}
          : { lanEnabled: bindAddress !== '127.0.0.1', bindAddress: bindAddress === '127.0.0.1' ? null : bindAddress, port, localhostEnabled },
      },
    ])
    await loader.await()
    await loader.root.update([
      ...loader.root.data,
      {
        id: 'webserver',
        name: '@deepseek-ai/dsh-host-webserver',
        inject: ['webStartup', 'dshfilesNetworkStartup'],
        config: {
          host: { __jsExpr: 'ctx.webStartup.host ?? ctx.dshfilesNetworkStartup.host ?? "127.0.0.1"' },
          port: { __jsExpr: 'ctx.webStartup.port ?? ctx.dshfilesNetworkStartup.port ?? 3080' },
        },
      },
    ])
    await loader.await()
    expect(host.ctx.get('dshfilesNetworkStartup')).toBeDefined()
    expect(host.ctx.get('webServer')).toBeDefined()
    await releaseReservations()
    const plugin = await host.mount(hostDefinition, { packageId: '@dshfiles/loopback-access' })
    const controller = new NetworkController(host.ctx, host.ctx.dshfilesLoopbackAccess, host.ctx.dshfilesNetworkStartup)
    return { host, plugin, controller, settings, entry: loader.resolve(NETWORK_SETTINGS_NAMESPACE) }
  } catch (error) {
    await host.dispose()
    throw error
  } finally {
    await releaseReservations()
  }
}

describe('required localhost native Host lifecycle', () => {
  it('keeps a fresh profile localhost-only with LAN off and no localhost-disable preference', async () => {
    const runtime = await mountRuntime('127.0.0.1', false, true)
    const client = new Socket()
    client.on('error', () => undefined)
    try {
      const snapshot = runtime.controller.snapshot()
      expect(runtime.host.ctx.dshfilesNetworkStartup.preferences).toEqual({ lanEnabled: null, bindAddress: null, port: null })
      expect(runtime.settings.describe().find(item => item.ns === NETWORK_SETTINGS_NAMESPACE)?.value).not.toHaveProperty('localhostEnabled')
      expect(snapshot).toMatchObject({
        saved: { lanEnabled: false, localhostEnabled: true, bindAddress: null },
        active: { host: '127.0.0.1', localhostEnabled: true },
        pendingRestart: false,
      })
      expect(runtime.host.ctx.dshfilesLoopbackAccess.status()).toMatchObject({ state: 'native-loopback', listeners: [] })
      const connected = once(client, 'connect', { signal: AbortSignal.timeout(2_000) })
      client.connect({ host: '127.0.0.1', port: snapshot.active.port })
      await connected
    } finally {
      client.destroy()
      await runtime.host.dispose()
    }
  })

  it('opens loopback despite legacy false and releases adjunct sockets without disposing LAN', async ({ skip }) => {
    if (lanHost === undefined) return skip()
    const runtime = await mountRuntime(lanHost, false)
    const client = new Socket()
    client.on('error', () => undefined)
    try {
      const snapshot = runtime.controller.snapshot()
      const port = snapshot.active.port
      expect(snapshot).toMatchObject({
        saved: { localhostEnabled: true, lanEnabled: true, bindAddress: lanHost },
        active: { localhostEnabled: true },
        pendingRestart: false,
      })
      expect(runtime.host.ctx.dshfilesLoopbackAccess.status().state).toBe('forwarding')
      expect(runtime.host.ctx.dshfilesNetworkStartup).not.toHaveProperty('localhostEnabled')
      expect(runtime.settings.describe().find(item => item.ns === NETWORK_SETTINGS_NAMESPACE)?.value).toEqual({
        lanEnabled: true,
        bindAddress: lanHost,
        port,
      })
      const connected = once(client, 'connect', { signal: AbortSignal.timeout(2_000) })
      client.connect({ host: '127.0.0.1', port })
      await connected
      const closed = socketClosed(client)
      await runtime.plugin.dispose()
      await closed
      expect(runtime.host.ctx.webServer.port).toBe(port)
      const lanClient = new Socket()
      lanClient.on('error', () => undefined)
      try {
        const lanConnected = once(lanClient, 'connect', { signal: AbortSignal.timeout(2_000) })
        lanClient.connect({ host: lanHost, port })
        await lanConnected
      } finally {
        lanClient.destroy()
      }
      expect(runtime.controller.snapshot()).toMatchObject({ active: { localhostEnabled: false }, pendingRestart: false })
      const replacement = createServer()
      try {
        const listening = once(replacement, 'listening', { signal: AbortSignal.timeout(2_000) })
        replacement.listen({ host: '127.0.0.1', port, exclusive: true })
        await listening
      } finally {
        await new Promise<void>(resolve => replacement.close(() => resolve()))
      }
    } finally {
      client.destroy()
      await runtime.host.dispose()
    }
  })

  it.each([false, true])('native Settings and controller saves strip legacy %s without changing the boot listener', async localhostEnabled => {
    const runtime = await mountRuntime('127.0.0.1', localhostEnabled)
    try {
      const before = runtime.controller.snapshot()
      const boot = runtime.host.ctx.dshfilesNetworkStartup
      const fiber = runtime.entry.fiber
      const signal = new AbortController().signal
      expect(before.pendingRestart).toBe(false)
      const refused = await runtime.host.connection.requestApi({
        packageId: '@dshfiles/loopback-access',
        apiId: 'loopback-access',
        method: 'saveNetwork',
        version: 1,
        input: { ...before.saved, localhostEnabled: false, expectedRevision: before.revision },
      })
      expect(await refused.json()).toMatchObject({ result: { ok: false, error: { code: 'contract' } } })
      expect(runtime.controller.snapshot()).toEqual(before)
      const after = await runtime.controller.save({ ...before.saved, expectedRevision: before.revision, localhostEnabled: true }, signal)
      expect(runtime.entry.options.config).toEqual({ lanEnabled: false, bindAddress: null, port: 0 })
      expect(after).toMatchObject({ saved: { localhostEnabled: true }, active: before.active, pendingRestart: false })
      expect(runtime.entry.fiber).toBe(fiber)
      expect(runtime.host.ctx.dshfilesNetworkStartup).toBe(boot)
      const changed = await runtime.controller.save(
        { ...after.saved, port: after.active.port === 65535 ? 65534 : after.active.port + 1, expectedRevision: after.revision },
        signal,
      )
      expect(changed.pendingRestart).toBe(true)
      expect(changed.active).toEqual(before.active)
      expect(runtime.host.ctx.dshfilesNetworkStartup).toBe(boot)
    } finally {
      await runtime.host.dispose()
    }
  })
})
