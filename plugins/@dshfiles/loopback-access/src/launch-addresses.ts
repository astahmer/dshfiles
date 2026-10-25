import { isLoopbackHost, isWildcardHost, type WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { LoopbackAccessStatus } from './api.js'

type LaunchServer = Pick<WebServer, 'host' | 'port' | 'protocol' | 'getOrigin'>
export type LaunchAddress = { kind: 'local' | 'lan' | 'advertised'; url: string }

const localhostBinds = new Set(['127.0.0.1', '::1', 'localhost'])

function initializedPort(port: number | undefined): port is number {
  return port !== undefined && Number.isInteger(port) && port >= 1 && port <= 65_535
}

function cleanUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/** Format only owned listener facts and the separately advertised application root. */
export class LaunchAddressesModel {
  static addresses(server: LaunchServer, status: LoopbackAccessStatus | undefined, advertisedUrl: string): readonly LaunchAddress[] {
    const addresses: LaunchAddress[] = []
    const seen = new Set<string>()
    const add = (kind: LaunchAddress['kind'], value: string) => {
      const url = cleanUrl(value)
      if (url === undefined || seen.has(url)) return
      seen.add(url)
      addresses.push({ kind, url })
    }

    if (initializedPort(server.port) && !isWildcardHost(server.host)) {
      const nativeLocalhost = localhostBinds.has(server.host)
      const forwardedLocalhost =
        status?.state === 'forwarding' && status.listeners.some(listener => localhostBinds.has(listener.host) && listener.port === server.port)
      if (nativeLocalhost || forwardedLocalhost) add('local', `${server.protocol}//localhost:${String(server.port)}`)

      try {
        add(nativeLocalhost || isLoopbackHost(server.host) ? 'local' : 'lan', server.getOrigin())
      } catch {
        // A scoped native IPv6 bind may have no URL form; its advertised root can still be valid.
      }
    }
    add('advertised', advertisedUrl)
    return addresses
  }
}
