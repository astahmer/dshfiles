/**
 * Opt-in public phone access: a persisted setting decides whether DSH exposes a
 * pairing gateway at all, and nothing is published until the user enables it.
 * @module @dshfiles/phone-pairing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createPairingGateway } from './gateway.ts'
import { detectProviders } from './providers.ts'
import { renderTerminalQr } from './qr.ts'
import { PhoneAccessSettings } from './settings.ts'
import { createPairingStore } from './store.ts'
import { startTunnel } from './tunnel.ts'

export const name = 'phone-pairing'

export const inject = ['connection']

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
  let gateway: ReturnType<typeof createPairingGateway> | undefined
  let stopTunnel: (() => Promise<void>) | undefined

  ctx.effect(() => () => {
    gateway?.closeAll()
    gateway?.server.close()
    void stopTunnel?.()
  })

  const nativeCookie = async (): Promise<string | undefined> => {
    // SAFETY: the plugin declares `connection` in `inject`, so it is the native connection service.
    const connection = ctx.get('connection') as NativeConnection | undefined
    // SAFETY: `webServer`, when present, is the native listener service exposing its port.
    const server = ctx.get('webServer') as { port?: number } | undefined
    if (connection?.authenticatedUrl === undefined || server?.port === undefined) return undefined
    try {
      const launch = connection.authenticatedUrl(`http://127.0.0.1:${server.port}`)
      const response = await fetch(launch, { redirect: 'manual' })
      return response.headers.get('set-cookie')?.split(';')[0]
    } catch {
      return undefined
    }
  }

  void (async () => {
    const { settings } = await PhoneAccessSettings.load(`${directory}/settings.json`)
    if (!settings.enabled) {
      const options = await detectProviders()
      const summary = options.map(option => `${option.provider}${option.available ? '' : ` (install: ${option.install ?? 'manual'})`}`).join(', ')
      console.log(
        `phone-pairing: phone access is off. Enable it by writing {"enabled":true,"provider":"<provider>"} to ${directory}/settings.json and restarting, then DSH prints a one-time QR. Providers: ${summary}`,
      )
      return
    }
    try {
      const store = await createPairingStore({
        path: `${directory}/devices.json`,
        deviceTtlMs: (config.deviceTtlDays ?? 365) * 24 * 3_600_000,
        offerTtlMs: (config.offerTtlSeconds ?? 300) * 1_000,
      })
      const tunnel = settings.origin === undefined ? await startTunnel(gatewayPort, settings.provider) : undefined
      const publicOrigin = settings.origin ?? tunnel?.origin
      if (publicOrigin === undefined) {
        console.error(
          `phone-pairing: no tunnel for provider ${settings.provider}; set "origin" in ${directory}/settings.json to a public HTTPS origin that reaches port ${gatewayPort}`,
        )
        return
      }
      stopTunnel = tunnel?.stop
      const serverPort = () => {
        // SAFETY: `webServer`, when present, is the native listener service exposing its port.
        const server = ctx.get('webServer') as { port?: number } | undefined
        return server?.port ?? 3080
      }
      gateway = createPairingGateway({ upstream: serverPort(), port: gatewayPort, store, publicOrigin, nativeCookie })
      await gateway.listen()
      const offer = store.beginOffer()
      console.log(
        [
          `phone pairing (${settings.provider}) — scan, or open ${publicOrigin}/pair and type ${offer.code}:`,
          renderTerminalQr(`${publicOrigin}/pair#id=${offer.id}&secret=${offer.secret}`),
          '',
        ].join('\n'),
      )
    } catch (error) {
      console.error(`phone-pairing: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
}
