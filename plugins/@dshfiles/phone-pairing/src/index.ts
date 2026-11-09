/**
 * Opt-in public phone access: the persisted setting decides whether DSH exposes a
 * pairing gateway, and the agent tools let the user turn it on, print a new pairing
 * code, list devices and revoke them without editing files.
 * @module @dshfiles/phone-pairing
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { createPairingGateway, mintNativeCookie, type NativeCookie } from './gateway.ts'
import { resolveProvider } from './providers.ts'
import { renderTerminalQr } from './qr.ts'
import { PhoneAccessSettings } from './settings.ts'
import { createPairingStore } from './store.ts'
import { startTunnel } from './tunnel.ts'

export const name = 'phone-pairing'

export const inject = ['connection', 'tools']

export interface Config {
  gatewayPort?: number
  deviceTtlDays?: number
  offerTtlSeconds?: number
}

export const Config: z<Config> = z.object({
  gatewayPort: z.natural().min(1).max(65_535).default(3443),
  deviceTtlDays: z.natural().min(1).default(365),
  offerTtlSeconds: z.natural().min(30).max(3_600).default(300),
})

interface NativeConnection {
  readonly authenticatedUrl?: (url: string) => string
}

export const apply = (ctx: Context, config: Config): void => {
  const gatewayPort = config.gatewayPort ?? 3443
  const home = process.env.DSH_HOME?.trim() || `${process.env.HOME ?? '.'}/.dsh`
  const directory = `${home}/plugins/phone-pairing`
  let settingStore: PhoneAccessSettings | undefined
  let gateway: ReturnType<typeof createPairingGateway> | undefined
  let pairing: Awaited<ReturnType<typeof createPairingStore>> | undefined
  let stopTunnel: (() => Promise<void>) | undefined
  let publicOrigin: string | undefined

  ctx.effect(() => () => {
    gateway?.closeAll()
    gateway?.server.close()
    void stopTunnel?.()
  })

  const nativeCookie = async (): Promise<NativeCookie | undefined> => {
    // SAFETY: the plugin declares `connection` in `inject`, so it is the native connection service.
    const connection = ctx.get('connection') as NativeConnection | undefined
    const port = serverPort()
    if (connection?.authenticatedUrl === undefined || port === undefined) return undefined
    try {
      return await mintNativeCookie(connection.authenticatedUrl(`http://127.0.0.1:${port}`))
    } catch {
      return undefined
    }
  }

  const serverPort = (): number | undefined => {
    // SAFETY: `webServer`, when present, is the native listener service exposing its port.
    const server = ctx.get('webServer') as { port?: number } | undefined
    return server?.port
  }

  const printOffer = (): void => {
    if (pairing === undefined || publicOrigin === undefined) return
    const offer = pairing.beginOffer()
    console.log(
      [
        `phone pairing (${publicOrigin}) — scan, or open ${publicOrigin}/pair and type ${offer.code}:`,
        renderTerminalQr(`${publicOrigin}/pair#id=${offer.id}&secret=${offer.secret}`),
        '',
      ].join('\n'),
    )
  }

  const start = async (): Promise<{ provider: string; origin: string }> => {
    if (gateway !== undefined && publicOrigin !== undefined) return { provider: 'running', origin: publicOrigin }
    const settings = settingStore?.current
    pairing ??= await createPairingStore({
      path: `${directory}/devices.json`,
      deviceTtlMs: (config.deviceTtlDays ?? 365) * 24 * 3_600_000,
      offerTtlMs: (config.offerTtlSeconds ?? 300) * 1_000,
    })
    const { provider } = await resolveProvider(settings?.provider)
    const tunnel = settings?.origin === undefined ? await startTunnel(gatewayPort, provider) : undefined
    const origin = settings?.origin ?? tunnel?.origin
    const upstream = serverPort()
    if (origin === undefined) throw new Error(`no tunnel for provider ${provider}; set "origin" in ${directory}/settings.json`)
    if (upstream === undefined) throw new Error('the native listener is unavailable')
    stopTunnel = tunnel?.stop
    publicOrigin = origin
    gateway = createPairingGateway({ upstream, port: gatewayPort, store: pairing, publicOrigin: origin, nativeCookie })
    await gateway.listen()
    await settingStore?.save({ enabled: true, provider: provider as never, ...(settings?.origin === undefined ? {} : { origin: settings.origin }) })
    printOffer()
    return { provider, origin }
  }

  const stop = async (): Promise<void> => {
    gateway?.closeAll()
    gateway?.server.close()
    gateway = undefined
    await stopTunnel?.()
    stopTunnel = undefined
    publicOrigin = undefined
    await settingStore?.save({ enabled: false })
  }

  const tools = {
    status: defineTool({
      name: 'phone_pairing_status',
      description: 'Report whether phone access is enabled, the provider it would use, and the paired devices (no secrets).',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => {
        const { provider, availability } = await resolveProvider(settingStore?.current.provider)
        const devices = (pairing?.listDevices() ?? []).map(device => `${device.id} last used ${new Date(device.lastUsedAt).toISOString()}`)
        return JSON.stringify({ enabled: settingStore?.current.enabled ?? false, provider, available: availability, devices })
      },
    }),
    enable: defineTool({
      name: 'phone_pairing_enable',
      description:
        'Enable phone access: starts the gateway and the tunnel, prints a QR, and persists the choice. Call only when the user asked to enable phone access.',
      parameters: { provider: { type: 'string', description: 'Optional: tailscale-serve, tailscale-funnel, cloudflared or manual' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async args => {
        const started = await start()
        return `phone access is on via ${started.provider}; the pairing QR is in the DSH terminal`
      },
    }),
    disable: defineTool({
      name: 'phone_pairing_disable',
      description: 'Turn phone access off and stop the tunnel. Paired devices stay in the list. Call only when the user asked to disable phone access.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => {
        await stop()
        return 'phone access is off'
      },
    }),
    pair: defineTool({
      name: 'phone_pairing_code',
      description: 'Print a fresh one-time pairing QR and code in the DSH terminal. Call only when the user asked for a new pairing code.',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => {
        if (gateway === undefined) throw new Error('phone access is off; enable it first')
        printOffer()
        return 'a new one-time pairing code is in the DSH terminal'
      },
    }),
    revoke: defineTool({
      name: 'phone_pairing_revoke',
      description: 'Revoke one paired device. Its cookie stops working immediately. Call only when the user asked to revoke that device.',
      parameters: { deviceId: { type: 'string' }, confirm: { type: 'boolean', description: 'Must be true.' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async args => {
        if (args.confirm !== true) throw new Error('pass confirm: true')
        const revoked = await pairing?.revoke(String(args.deviceId))
        gateway?.closeUnauthorised()
        return revoked ? 'device revoked' : 'no such device'
      },
    }),
  }

  for (const tool of Object.values(tools)) ctx.tools.register(tool)

  void (async () => {
    const loaded = await PhoneAccessSettings.load(`${directory}/settings.json`)
    settingStore = loaded.store
    if (!loaded.settings.enabled) {
      const { provider, availability } = await resolveProvider(loaded.settings.provider)
      console.log(
        `phone-pairing: phone access is off. Ask the agent to enable it, or write {"enabled":true} to ${directory}/settings.json. Would use ${provider}; providers: ${availability
          .map(option => `${option.provider}${option.available ? '' : ` (install: ${option.install ?? 'manual'})`}`)
          .join(', ')}`,
      )
      return
    }
    try {
      await start()
    } catch (error) {
      console.error(`phone-pairing: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
}
