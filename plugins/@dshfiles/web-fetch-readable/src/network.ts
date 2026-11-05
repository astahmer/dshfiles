/**
 * Public-network resolution and address-pinned transport.
 *
 * Ported from `@deepseek-ai/dsh-web-fetch-http@0.2.1-rc.2` (`lib/types/network.js`, MIT) without behaviour
 * changes: one DNS answer set is validated (every address public, NAT64 translations included) and the
 * connection is pinned to it, so a hostname cannot re-resolve to a private address between the check and
 * the connect. The provider calls this once per redirect hop, which is what makes following a
 * cross-origin redirect safe.
 */
import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import type { LookupFunction } from 'node:net'
import { isIP } from 'node:net'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { WebError } from '@deepseek-ai/dsh-web'
import ipaddr from 'ipaddr.js'
import type { Dispatcher, Response } from 'undici'

export interface PinnedAddress {
  readonly address: string
  readonly family: 4 | 6
}

export interface HopResponse {
  readonly response: Response
  readonly close: () => Promise<void>
}

export type Resolver = (hostname: string, options: { all: true; order: 'verbatim' }) => Promise<readonly LookupAddress[]>

/** The transport the provider composes; tests replace it whole. */
export interface FetchNetwork {
  /** Resolve once and refuse the answer set when any destination is not public. */
  readonly resolve: (hostname: string, signal: AbortSignal) => Promise<readonly PinnedAddress[]>
  /** The proxy dispatcher this URL must go through, or `undefined` for a direct, pinned connection. */
  readonly proxyFor: (url: URL) => Dispatcher | undefined
  readonly request: (url: URL, addresses: readonly PinnedAddress[], headers: Record<string, string>, signal: AbortSignal) => Promise<HopResponse>
  readonly requestVia: (dispatcher: Dispatcher, url: URL, headers: Record<string, string>, signal: AbortSignal) => Promise<HopResponse>
}

const RFC6052_PREFIX_LENGTHS = [32, 40, 48, 56, 64, 96] as const
const IPV4ONLY_DISCOVERY_HOST = 'ipv4only.arpa'
const IPV4ONLY_SENTINELS = new Set(['192.0.0.170', '192.0.0.171'])

interface Nat64Prefix {
  readonly bytes: readonly number[]
  readonly length: number
}

const stripIpv6Brackets = (hostname: string): string => (hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname)

export class PublicNetwork {
  /** Globally reachable unicast only; IPv4-mapped IPv6 is classified by its embedded IPv4 address. */
  static isPublicIpAddress(input: string): boolean {
    let parsed: ipaddr.IPv4 | ipaddr.IPv6
    try {
      parsed = ipaddr.parse(stripIpv6Brackets(input))
    } catch {
      return false
    }
    if (parsed instanceof ipaddr.IPv4) return parsed.range() === 'unicast'
    if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().range() === 'unicast'
    return parsed.range() === 'unicast'
  }

  /** An IP literal no request may be sent to, even through a proxy. */
  static isNonPublicIpLiteral(hostname: string): boolean {
    const unbracketed = stripIpv6Brackets(hostname)
    return isIP(unbracketed) !== 0 && !PublicNetwork.isPublicIpAddress(unbracketed)
  }

  static async resolvePublicAddresses(hostname: string, signal: AbortSignal, resolver: Resolver = lookup): Promise<readonly PinnedAddress[]> {
    const unbracketed = stripIpv6Brackets(hostname)
    const literalFamily = isIP(unbracketed)
    const resolved: readonly LookupAddress[] =
      literalFamily === 0
        ? await PublicNetwork.raceWithSignal(resolver(unbracketed, { all: true, order: 'verbatim' }), signal)
        : [{ address: unbracketed, family: literalFamily }]
    if (resolved.length === 0) throw new WebError(`hostname "${hostname}" resolved to no addresses`, 'WEB_PROVIDER_ERROR')
    const nat64Prefixes = resolved.some(entry => entry.family === 6 && isIP(entry.address) === 6)
      ? await PublicNetwork.discoverNat64Prefixes(signal, resolver)
      : []
    const addresses: PinnedAddress[] = []
    for (const entry of resolved) {
      if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family)
        throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, 'WEB_PROVIDER_ERROR')
      if (!PublicNetwork.isPublicIpAddress(entry.address))
        throw new WebError(`URL hostname "${hostname}" resolves to a non-public IP address`, 'WEB_BLOCKED_URL')
      const translated = PublicNetwork.translatedIpv4Address(entry.address, nat64Prefixes)
      if (translated !== undefined && !PublicNetwork.isPublicIpAddress(translated))
        throw new WebError(`URL hostname "${hostname}" resolves through NAT64 to a non-public IPv4 address`, 'WEB_BLOCKED_URL')
      addresses.push({ address: entry.address, family: entry.family })
    }
    return addresses
  }

  private static async discoverNat64Prefixes(signal: AbortSignal, resolver: Resolver): Promise<readonly Nat64Prefix[]> {
    const discovered = await PublicNetwork.raceWithSignal(resolver(IPV4ONLY_DISCOVERY_HOST, { all: true, order: 'verbatim' }), signal)
    const prefixes: Nat64Prefix[] = []
    const seen = new Set<string>()
    for (const entry of discovered) {
      if (entry.family !== 6 || isIP(entry.address) !== 6) continue
      const bytes = ipaddr.parse(entry.address).toByteArray()
      for (const length of RFC6052_PREFIX_LENGTHS) {
        const embedded = PublicNetwork.embeddedIpv4Address(bytes, length)
        if (embedded === undefined || !IPV4ONLY_SENTINELS.has(embedded)) continue
        const prefixBytes = bytes.slice(0, length / 8)
        const key = `${String(length)}:${prefixBytes.join('.')}`
        if (seen.has(key)) continue
        seen.add(key)
        prefixes.push({ bytes: prefixBytes, length })
      }
    }
    return prefixes
  }

  private static translatedIpv4Address(input: string, prefixes: readonly Nat64Prefix[]): string | undefined {
    if (isIP(input) !== 6) return undefined
    const bytes = ipaddr.parse(input).toByteArray()
    for (const prefix of prefixes) {
      if (!prefix.bytes.every((byte, index) => bytes[index] === byte)) continue
      const embedded = PublicNetwork.embeddedIpv4Address(bytes, prefix.length)
      if (embedded !== undefined) return embedded
    }
    return undefined
  }

  private static embeddedIpv4Address(bytes: readonly number[], prefixLength: number): string | undefined {
    if (prefixLength === 96) return bytes.slice(12, 16).join('.')
    if (bytes[8] !== 0) return undefined
    const prefixBytes = prefixLength / 8
    const beforeReservedOctet = 8 - prefixBytes
    return [...bytes.slice(prefixBytes, prefixBytes + beforeReservedOctet), ...bytes.slice(9, 13 - beforeReservedOctet)].join('.')
  }

  /** A connector lookup that only ever answers with the validated set. */
  static pinnedLookup(addresses: readonly PinnedAddress[]): LookupFunction {
    return (hostname, options, callback) => {
      const family = typeof options.family === 'number' ? options.family : options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : 0
      const eligible = family === 0 ? addresses : addresses.filter(address => address.family === family)
      const selected = eligible[0]
      if (selected === undefined) {
        const error = Object.assign(new Error(`no validated address for ${hostname} in family ${String(family)}`), { code: 'ENOTFOUND', hostname })
        callback(error, '', family)
        return
      }
      if (options.all === true) {
        callback(
          null,
          eligible.map(address => ({ ...address })),
        )
        return
      }
      callback(null, selected.address, selected.family)
    }
  }

  private static raceWithSignal<A>(promise: Promise<A>, signal: AbortSignal): Promise<A> {
    const abortError = (): Error => new Error('web fetch aborted during hostname resolution', { cause: signal.reason })
    if (signal.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const abort = (): void => reject(abortError())
      signal.addEventListener('abort', abort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  /** The production transport. */
  static readonly live: FetchNetwork = {
    resolve: (hostname, signal) => PublicNetwork.resolvePublicAddresses(hostname, signal),
    proxyFor: url => {
      const route = proxyRouteFor(url)
      return route.proxied ? route.dispatcher : undefined
    },
    request: async (url, addresses, headers, signal) => {
      const { Agent, fetch } = await import('undici')
      const dispatcher = new Agent({ autoSelectFamily: true, connect: { lookup: PublicNetwork.pinnedLookup(addresses) } })
      try {
        const response = await fetch(url, { method: 'GET', redirect: 'manual', headers, signal, dispatcher })
        return { response, close: () => dispatcher.close() }
      } catch (error) {
        await dispatcher.close()
        throw error
      }
    },
    requestVia: async (dispatcher, url, headers, signal) => {
      const { fetch } = await import('undici')
      const response = await fetch(url, { method: 'GET', redirect: 'manual', headers, signal, dispatcher })
      return { response, close: () => Promise.resolve() }
    },
  }
}
