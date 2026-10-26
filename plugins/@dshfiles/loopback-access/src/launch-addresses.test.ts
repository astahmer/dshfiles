import { describe, expect, it } from 'vitest'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { LoopbackAccessStatus } from './api.js'
import { LaunchAddressesModel } from './launch-addresses.js'

type Server = Pick<WebServer, 'host' | 'port' | 'protocol' | 'getOrigin'>

// Documentation-only addresses: these fixtures never bind sockets or probe a network.
function server(host = '192.0.2.10', port: number | undefined = 3198, protocol: Server['protocol'] = 'http:'): Server {
  return {
    host,
    port,
    protocol,
    getOrigin: () => `${protocol}//${host.includes(':') ? `[${host}]` : host}:${String(port)}`,
  }
}

function status(
  state: LoopbackAccessStatus['state'] = 'forwarding',
  listeners: LoopbackAccessStatus['listeners'] = [{ host: '127.0.0.1', port: 3198 }],
): LoopbackAccessStatus {
  return {
    state,
    listeners,
    upstreamOrigin: 'http://192.0.2.10:3198',
    localhostOrigin: 'http://localhost:3198',
  }
}

const local = (url: string) => ({ kind: 'local', url })
const lan = (url: string) => ({ kind: 'lan', url })
const advertised = (url: string) => ({ kind: 'advertised', url })

describe('clean launch addresses', () => {
  it('puts an actual forwarded localhost address before the native LAN binding', () => {
    expect(LaunchAddressesModel.addresses(server(), status(), 'http://192.0.2.10:3198')).toEqual([
      local('http://localhost:3198/'),
      lan('http://192.0.2.10:3198/'),
    ])
  })

  it('accepts an actually owned IPv6 loopback listener without inventing an IPv4 listener', () => {
    expect(LaunchAddressesModel.addresses(server(), status('forwarding', [{ host: '::1', port: 3198 }]), 'http://192.0.2.10:3198')).toEqual([
      local('http://localhost:3198/'),
      lan('http://192.0.2.10:3198/'),
    ])
  })

  it('does not duplicate localhost when both forwarded families are present', () => {
    expect(
      LaunchAddressesModel.addresses(
        server(),
        status('forwarding', [
          { host: '127.0.0.1', port: 3198 },
          { host: '::1', port: 3198 },
        ]),
        'http://localhost:3198/',
      ),
    ).toEqual([local('http://localhost:3198/'), lan('http://192.0.2.10:3198/')])
  })

  it.each(['starting', 'stopped', 'failed', 'native-loopback'] as const)('ignores stale forwarded listeners in state %s', state => {
    expect(LaunchAddressesModel.addresses(server(), status(state), 'http://192.0.2.10:3198')).toEqual([lan('http://192.0.2.10:3198/')])
  })

  it('falls back to native LAN when the optional adjunct is absent', () => {
    expect(LaunchAddressesModel.addresses(server(), undefined, 'http://192.0.2.10:3198')).toEqual([lan('http://192.0.2.10:3198/')])
  })

  it('does not trust a derived localhostOrigin without actual listeners', () => {
    expect(LaunchAddressesModel.addresses(server(), status('forwarding', []), 'http://192.0.2.10:3198')).toEqual([lan('http://192.0.2.10:3198/')])
  })

  it('ignores listener facts belonging to a different native port', () => {
    expect(LaunchAddressesModel.addresses(server(), status('forwarding', [{ host: '127.0.0.1', port: 3199 }]), 'http://192.0.2.10:3198')).toEqual([
      lan('http://192.0.2.10:3198/'),
    ])
  })

  it.each(['127.0.0.1', '::1', 'localhost'])('recognizes a native localhost bind without an adjunct: %s', host => {
    const native = server(host)
    const expected = host === 'localhost' ? [local('http://localhost:3198/')] : [local('http://localhost:3198/'), local(native.getOrigin() + '/')]
    expect(LaunchAddressesModel.addresses(native, undefined, native.getOrigin())).toEqual(expected)
    expect(LaunchAddressesModel.addresses(native, status('failed'), native.getOrigin())).toEqual(expected)
  })

  it.each(['127.0.0.2', '127.23.4.5', '::ffff:127.0.0.1', '::0.0.0.1'])('does not replace another loopback literal with localhost: %s', host => {
    const native = server(host)
    expect(LaunchAddressesModel.addresses(native, undefined, native.getOrigin())).toEqual([local(new URL(native.getOrigin()).href)])
  })

  it.each(['0.0.0.0', '::', '::ffff:0.0.0.0'])('does not turn an invalid wildcard bind into a usable direct address: %s', host => {
    expect(LaunchAddressesModel.addresses(server(host), status(), 'https://proxy.example.invalid/ui/')).toEqual([
      advertised('https://proxy.example.invalid/ui/'),
    ])
  })

  it('preserves native HTTPS for both forwarded localhost and direct LAN', () => {
    expect(LaunchAddressesModel.addresses(server('192.0.2.10', 3198, 'https:'), status(), 'https://192.0.2.10:3198/')).toEqual([
      local('https://localhost:3198/'),
      lan('https://192.0.2.10:3198/'),
    ])
  })

  it('retains the external proxy scheme and mount as a separate advertised URL', () => {
    expect(LaunchAddressesModel.addresses(server(), status(), 'https://PROXY.example.invalid/ui/')).toEqual([
      local('http://localhost:3198/'),
      lan('http://192.0.2.10:3198/'),
      advertised('https://proxy.example.invalid/ui/'),
    ])
  })

  it('normalizes default ports and root slashes before deduplicating', () => {
    const native = server('192.0.2.10', 80)
    expect(LaunchAddressesModel.addresses(native, undefined, 'http://192.0.2.10/')).toEqual([lan('http://192.0.2.10/')])
  })

  it('keeps a different advertised path on the same authority', () => {
    expect(LaunchAddressesModel.addresses(server(), undefined, 'http://192.0.2.10:3198/ui/')).toEqual([
      lan('http://192.0.2.10:3198/'),
      advertised('http://192.0.2.10:3198/ui/'),
    ])
  })

  it('formats the actual IPv6 LAN origin without enumerating other addresses', () => {
    expect(LaunchAddressesModel.addresses(server('2001:db8::10'), undefined, 'http://[2001:db8::10]:3198/')).toEqual([lan('http://[2001:db8::10]:3198/')])
  })

  it('keeps a valid advertised root when a scoped IPv6 origin cannot be expressed', () => {
    const native = {
      ...server('fe80::10%test'),
      getOrigin: () => {
        throw new Error('Scoped origin is unavailable.')
      },
    }
    expect(LaunchAddressesModel.addresses(native, undefined, 'https://proxy.example.invalid/ui/')).toEqual([advertised('https://proxy.example.invalid/ui/')])
  })

  it.each([undefined, 0, -1, 65_536, Number.NaN, 3198.5])('does not invent a direct URL with an uninitialized or invalid port: %s', port => {
    const native = {
      ...server('127.0.0.1'),
      port,
      getOrigin: () => {
        throw new Error('Must not read an uninitialized origin.')
      },
    }
    expect(LaunchAddressesModel.addresses(native, status(), 'https://proxy.example.invalid/ui/')).toEqual([advertised('https://proxy.example.invalid/ui/')])
  })

  it('uses the actual OS-assigned port rather than a startup-config default', () => {
    expect(
      LaunchAddressesModel.addresses(server('192.0.2.10', 49152), status('forwarding', [{ host: '127.0.0.1', port: 49152 }]), 'http://192.0.2.10:49152'),
    ).toEqual([local('http://localhost:49152/'), lan('http://192.0.2.10:49152/')])
  })

  it.each([
    'not a URL',
    'ftp://proxy.example.invalid/',
    'https://user:password@proxy.example.invalid/',
    'https://proxy.example.invalid/?token=fixture',
    'https://proxy.example.invalid/#fragment',
  ])('omits non-clean or non-HTTP advertised values: %s', value => {
    expect(LaunchAddressesModel.addresses(server(), undefined, value)).toEqual([lan('http://192.0.2.10:3198/')])
  })
})
