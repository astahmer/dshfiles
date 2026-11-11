/**
 * Opt-in public phone access: the persisted setting decides whether DSH exposes a
 * pairing gateway, and the agent tools let the user turn it on, print a new pairing
 * code, list devices and revoke them without editing files. The same offer is served
 * to the sidebar's QR popover, so a code no longer needs the terminal.
 * @module @dshfiles/phone-pairing
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import z from '@deepseek-ai/schemastery'
import { definePlugin } from '@dshfiles/dshx/host'
import type { Effect } from 'effect'
import { phonePairingApi, type PairingOffer } from './api.ts'
import { createPairingGateway } from './gateway.ts'
import type { NativeCookie } from './native-cookie.ts'
import { decodeEnableArgs } from './enable-args.ts'
import { providers, type Provider } from './providers.ts'
import { renderTerminalQr } from './qr.ts'
import { phoneRuntime } from './runtime-promise.ts'
import type { PhoneSettings } from './settings.ts'
import { createPairingStore } from './store.ts'

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

// SAFETY: schemastery implements Standard Schema with an `unknown` output, while an object schema always decodes a
// record; the Loader keeps validating the row config with this same schemastery schema.
const pluginConfig = Config as unknown as StandardSchemaV1<unknown, Readonly<Record<string, unknown>>>

interface NativeConnection {
  readonly authenticatedUrl?: (url: string) => string
}

export default definePlugin({
  id: 'dshfiles-phone-pairing',
  inject: ['connection', 'webServer', 'subprocess'],
  uses: ['tools', 'rpc'],
  Config: pluginConfig,
  setup(api) {
    const ctx: Context = api.raw.ctx
    const config: Config = api.config as Config
    const gatewayPort = config.gatewayPort ?? 3443
    const home = process.env.DSH_HOME?.trim() || `${process.env.HOME ?? '.'}/.dsh`
    const directory = `${home}/plugins/phone-pairing`
    const settingsPath = `${directory}/settings.json`
    /** The persisted choice, once read at startup. */
    let settings: PhoneSettings | undefined
    let gateway: ReturnType<typeof createPairingGateway> | undefined
    let pairing: Awaited<ReturnType<typeof createPairingStore>> | undefined
    let stopTunnel: Effect.Effect<void> | undefined
    let publicOrigin: string | undefined
    const phone = phoneRuntime(ctx)

    ctx.effect(() => () => {
      gateway?.closeAll()
      gateway?.server.close()
      void (async () => {
        if (stopTunnel !== undefined) await phone.stopTunnel(stopTunnel)
        await phone.dispose()
      })()
    })

    const nativeCookie = async (): Promise<NativeCookie | undefined> => {
      // SAFETY: the plugin declares `connection` in `inject`, so it is the native connection service.
      const connection = ctx.get('connection') as NativeConnection | undefined
      const port = serverPort()
      if (connection?.authenticatedUrl === undefined || port === undefined) return undefined
      try {
        return await phone.mintNativeCookie(connection.authenticatedUrl(`http://127.0.0.1:${port}`))
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

    /** `state: 'off'` rather than an error: the popover explains how to enable phone access. */
    const nextOffer = (): PairingOffer => {
      if (gateway === undefined || pairing === undefined || publicOrigin === undefined) return { state: 'off' }
      const offer = pairing.beginOffer()
      return {
        state: 'ready',
        payload: `${publicOrigin}/pair#id=${offer.id}&secret=${offer.secret}`,
        code: offer.code,
        expiresAt: offer.expiresAt,
        origin: publicOrigin,
      }
    }
    api.rpc.register(phonePairingApi.host({ offer: () => nextOffer() }))

    /** Persists only once the stored choice was read, so an early tool call never overwrites it. */
    const save = async (next: PhoneSettings): Promise<void> => {
      if (settings === undefined) return
      await phone.saveSettings(settingsPath, next)
      settings = next
    }

    const start = async (requested?: Provider): Promise<{ provider: string; origin: string }> => {
      if (gateway !== undefined && publicOrigin !== undefined) return { provider: 'running', origin: publicOrigin }
      // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot required: a tool call may save new settings across the awaits below.
      const current = settings
      pairing ??= await createPairingStore({
        path: `${directory}/devices.json`,
        deviceTtlMs: (config.deviceTtlDays ?? 365) * 24 * 3_600_000,
        offerTtlMs: (config.offerTtlSeconds ?? 300) * 1_000,
      })
      const { provider } = await phone.resolveProvider(requested ?? current?.provider)
      const tunnel = current?.origin === undefined ? await phone.startTunnel(gatewayPort, provider) : undefined
      const origin = current?.origin ?? tunnel?.origin
      const upstream = serverPort()
      if (origin === undefined) throw new Error(`no tunnel for provider ${provider}; set "origin" in ${settingsPath}`)
      if (upstream === undefined) throw new Error('the native listener is unavailable')
      stopTunnel = tunnel?.stop
      publicOrigin = origin
      gateway = createPairingGateway({ upstream, port: gatewayPort, store: pairing, publicOrigin: origin, nativeCookie })
      await gateway.listen()
      await save(current?.origin === undefined ? { enabled: true, provider } : { enabled: true, provider, origin: current.origin })
      printOffer()
      return { provider, origin }
    }

    const stop = async (): Promise<void> => {
      gateway?.closeAll()
      gateway?.server.close()
      gateway = undefined
      if (stopTunnel !== undefined) await phone.stopTunnel(stopTunnel)
      stopTunnel = undefined
      publicOrigin = undefined
      await save({ enabled: false })
    }

    const tools = {
      status: defineTool({
        name: 'phone_pairing_status',
        description: 'Report whether phone access is enabled, the provider it would use, and the paired devices (no secrets).',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: async () => {
          const { provider, availability } = await phone.resolveProvider(settings?.provider)
          const devices = (pairing?.listDevices() ?? []).map(device => `${device.id} last used ${new Date(device.lastUsedAt).toISOString()}`)
          return JSON.stringify({ enabled: settings?.enabled ?? false, provider, available: availability, devices })
        },
      }),
      enable: defineTool({
        name: 'phone_pairing_enable',
        description:
          'Enable phone access: starts the gateway and the tunnel, prints a QR, and persists the choice. Call only when the user asked to enable phone access.',
        parameters: {
          provider: { type: 'string', enum: [...providers], description: 'Optional; omitted keeps the saved choice or picks the best available.' },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: async args => {
          const started = await start(decodeEnableArgs(args).provider)
          return `phone access is on via ${started.provider}; the pairing QR is in the sidebar footer and the DSH terminal`
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
        description:
          'Print a fresh one-time pairing QR and code in the DSH terminal, and make the sidebar QR popover offer one. Call only when the user asked for a new pairing code.',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: async () => {
          if (gateway === undefined) throw new Error('phone access is off; enable it first')
          printOffer()
          return 'a new one-time pairing code is in the DSH terminal and the sidebar QR button'
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

    for (const tool of Object.values(tools)) api.tools.register(tool)

    void (async () => {
      const loaded = await phone.loadSettings(settingsPath)
      settings = loaded
      if (!loaded.enabled) {
        const { provider, availability } = await phone.resolveProvider(loaded.provider)
        console.log(
          `phone-pairing: phone access is off. Ask the agent to enable it, or write {"enabled":true} to ${settingsPath}. Would use ${provider}; providers: ${availability
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
  },
})
