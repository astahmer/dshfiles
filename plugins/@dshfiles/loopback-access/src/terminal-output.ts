import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { auditStartupEntries } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-web-app'
import type {} from './access.js'
import { LaunchAddressesModel, type LaunchAddress } from './launch-addresses.js'

export const name = 'dshfiles-network-terminal-output'

// Activate synchronously, then schedule settlement just like the native printer.
// Neither a Loader-await injection nor a returned settlement promise may hold
// this entry pending while the Loader is waiting for this same entry to settle.
export const inject = ['connection', 'webServer', 'webApp']

const ADDRESS_LABELS: Record<LaunchAddress['kind'], string> = { local: '  Local', lan: '  LAN', advertised: '  Advertised' }

/** Authenticate only at the terminal boundary; never add tokens to status data. */
export function launchAddressLines(addresses: readonly LaunchAddress[], authenticatedUrl: HostConnectionHandle['authenticatedUrl']): string[] {
  const lines = addresses.map((address, index) => {
    const label = index === 0 ? 'dsh web' : ADDRESS_LABELS[address.kind]
    return `${label}: ${authenticatedUrl(address.url)}`
  })
  if (addresses.some(address => address.kind === 'local' && address.url.startsWith('https:') && new URL(address.url).hostname === 'localhost')) {
    lines.push('  HTTPS localhost requires a trusted certificate covering localhost.')
  }
  return lines
}

export function apply(ctx: Context): void {
  let active = true
  ctx.effect(() => () => {
    active = false
  })
  // Like the native printer, let the authoritative boot own fatal diagnostics.
  // No URL is announced after required-entry failure or after this entry unloads.
  const settled = ctx.get('loader')?.await() ?? Promise.resolve()
  void settled
    .then(() => auditStartupEntries(ctx.root, 'dsh web', () => {}))
    .then(() => {
      if (!active) return
      const server = ctx.get('webServer')
      const connection = ctx.get('connection')
      const app = ctx.get('webApp')
      if (server === undefined || connection === undefined || app === undefined) return
      const status = ctx.get('dshfilesLoopbackAccess')?.status()
      const addresses = LaunchAddressesModel.addresses(server, status, app.getAdvertisedUrl())
      const lines = launchAddressLines(addresses, url => connection.authenticatedUrl(url))
      if (active && lines.length > 0) console.log(lines.join('\n'))
    })
    .catch(() => {})
}
