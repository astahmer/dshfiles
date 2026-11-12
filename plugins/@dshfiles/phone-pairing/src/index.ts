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
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { createHostApiClient, definePlugin } from '@dshfiles/dshx/host'
import { phoneEdgeApi } from '@dshfiles/phone-access/edge-api'
import { createAccess, type EdgeLink } from './access.ts'
import { phonePairingApi } from './api.ts'
import { createPairingGateway, pairingCookieName } from './gateway.ts'
import type { NativeCookie } from './native-cookie.ts'
import { decodeEnableArgs } from './enable-args.ts'
import { providers, type Provider } from './providers.ts'
import { renderTerminalQr } from './qr.ts'
import { phoneRuntime } from './runtime-promise.ts'
import type { PhoneSettings } from './settings.ts'
import { createPairingStore } from './store.ts'
import { setupHint } from './tunnel.ts'

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
    const phone = phoneRuntime(ctx)

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

    /** phone-access's proxy: pairing reuses its origin instead of repointing that origin's Tailscale route. */
    const edgeClient = createHostApiClient(ctx, phoneEdgeApi, '@dshfiles/phone-pairing')
    const edge: EdgeLink = {
      find: async () => {
        try {
          const current = await edgeClient.status({})
          const [origin] = current.origins
          return current.listening && origin !== undefined ? { origin } : undefined
        } catch (error) {
          if (error instanceof Error && isApiOwnerMissing(error)) return undefined
          throw error
        }
      },
      claim: async port => {
        await edgeClient.claimRoutes({ port, pathPrefixes: ['/pair'], cookie: pairingCookieName, signIn: { path: '/pair', label: 'Pair this phone' } })
      },
      release: async () => {
        await edgeClient.releaseRoutes({})
      },
    }

    const access = createAccess({
      edge,
      defaultPort: gatewayPort,
      settingsPath,
      openStore: () =>
        createPairingStore({
          path: `${directory}/devices.json`,
          deviceTtlMs: (config.deviceTtlDays ?? 365) * 24 * 3_600_000,
          offerTtlMs: (config.offerTtlSeconds ?? 300) * 1_000,
        }),
      settings: () => settings,
      /** Persists only once the stored choice was read, so an early tool call never overwrites it. */
      saveSettings: async next => {
        if (settings === undefined) return
        await phone.saveSettings(settingsPath, next)
        settings = next
      },
      resolveProvider: async preferred => (await phone.resolveProvider(preferred)).provider,
      startTunnel: async (port, provider) => {
        const tunnel = await phone.startTunnel(port, provider)
        return tunnel === undefined ? undefined : { origin: tunnel.origin, stop: () => phone.stopTunnel(tunnel.stop) }
      },
      serverPort,
      createGateway: input => {
        const gateway = createPairingGateway({ upstream: input.upstream, port: input.port, store: input.store, publicOrigin: input.origin, nativeCookie })
        return {
          listen: () => gateway.listen(),
          port: () => gateway.port(),
          close: () => {
            gateway.closeAll()
            gateway.server.close()
          },
          closeUnauthorised: () => gateway.closeUnauthorised(),
        }
      },
      inspectBusyPort: port => phone.inspectBusyPort(port),
      tunnelHint: () => setupHint().slice(1).join(' '),
    })

    ctx.effect(() => () => {
      void (async () => {
        await access.dispose()
        await phone.dispose()
      })()
    })

    const printOffer = (): void => {
      const offer = access.offer()
      if (offer.state !== 'ready') return
      console.log(
        [`phone pairing (${offer.origin}) — scan, or open ${offer.origin}/pair and type ${offer.code}:`, renderTerminalQr(offer.payload), ''].join('\n'),
      )
    }

    const enable = async (input: { readonly provider?: Provider; readonly port?: number } = {}) => {
      const wasOn = access.running() !== undefined
      const next = await access.enable(input)
      if (!wasOn && next.enabled) printOffer()
      return next
    }

    api.rpc.register(phonePairingApi.host({ offer: () => access.offer() }))

    const tools = {
      status: defineTool({
        name: 'phone_pairing_status',
        description:
          'Report whether phone access is enabled, its origin and gateway port, why the last attempt to turn it on failed (with the free port to use when the gateway port is busy), the provider it would use, and the paired devices (no secrets).',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: async () => {
          const { provider, availability } = await phone.resolveProvider(settings?.provider)
          const devices = (access.store()?.listDevices() ?? []).map(device => `${device.id} last used ${new Date(device.lastUsedAt).toISOString()}`)
          const current = access.status()
          // JSON drops the fields a working or never-tried phone access leaves undefined.
          return JSON.stringify({ ...current, provider, available: availability, devices })
        },
      }),
      enable: defineTool({
        name: 'phone_pairing_enable',
        description:
          'Enable phone access: starts the gateway and the tunnel, prints a QR, and persists the choice. Call only when the user asked to enable phone access.',
        parameters: {
          provider: { type: 'string', enum: [...providers], description: 'Optional; omitted keeps the saved choice or picks the best available.' },
          // The tool DSL rejects `minimum`/`maximum` at registration; decodeEnableArgs bounds it to 1..65535.
          port: { type: 'integer', description: 'Optional gateway port (1-65535), for when the configured one is busy (status names a free one); remembered.' },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: async args => {
          const started = await enable(decodeEnableArgs(args))
          if (!started.enabled) throw new Error(started.failure ?? 'phone access did not turn on')
          return `phone access is on at ${started.origin ?? 'its origin'} (gateway port ${String(started.port)}); the pairing QR is in the sidebar footer and the DSH terminal`
        },
      }),
      disable: defineTool({
        name: 'phone_pairing_disable',
        description: 'Turn phone access off and stop the tunnel. Paired devices stay in the list. Call only when the user asked to disable phone access.',
        parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: async () => {
          await access.disable()
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
          if (access.running() === undefined) throw new Error(`phone access is off; enable it first (${access.status().failure ?? 'phone_pairing_enable'})`)
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
          const revoked = await access.store()?.revoke(String(args.deviceId))
          access.running()?.gateway.closeUnauthorised?.()
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
      // Every Loader row active first, so phone-access's edge API answers and pairing reuses its origin.
      // SAFETY: `loader`, when present, is the Cordis Loader service whose `await` settles activation.
      const loader = ctx.get('loader') as { await?: () => Promise<void> } | undefined
      await Promise.resolve(loader?.await?.call(loader)).catch(() => undefined)
      const started = await enable()
      if (!started.enabled) console.error(`phone-pairing: ${started.failure ?? 'phone access did not turn on'}`)
    })()
  },
})
