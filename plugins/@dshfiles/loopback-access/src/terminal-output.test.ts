import { describe, expect, it } from 'vitest'
import { launchAddressLines } from './terminal-output.js'

const authenticate = (url: string): string => {
  const launch = new URL(url)
  launch.searchParams.set('token', 'synthetic-launch-token')
  return launch.href
}

describe('startup terminal addresses', () => {
  it('prints the native-compatible localhost line first and LAN as an additional address', () => {
    const addresses = [
      { kind: 'local' as const, url: 'http://localhost:34567/' },
      { kind: 'lan' as const, url: 'http://192.0.2.10:34567/' },
    ]
    expect(launchAddressLines(addresses, authenticate)).toEqual([
      'dsh web: http://localhost:34567/?token=synthetic-launch-token',
      '  LAN: http://192.0.2.10:34567/?token=synthetic-launch-token',
    ])
    // Generating terminal links must not mutate token-free status/formatter data.
    expect(addresses.every(address => !address.url.includes('token'))).toBe(true)
  })

  it('preserves advertised proxy paths separately from actual listener addresses', () => {
    expect(
      launchAddressLines(
        [
          { kind: 'local', url: 'http://localhost:34567/' },
          { kind: 'advertised', url: 'https://example.invalid/dsh/' },
        ],
        authenticate,
      ),
    ).toEqual(['dsh web: http://localhost:34567/?token=synthetic-launch-token', '  Advertised: https://example.invalid/dsh/?token=synthetic-launch-token'])
  })

  it('does not downgrade HTTPS or promise a valid localhost certificate', () => {
    expect(launchAddressLines([{ kind: 'local', url: 'https://localhost:34567/' }], authenticate)).toEqual([
      'dsh web: https://localhost:34567/?token=synthetic-launch-token',
      '  HTTPS localhost requires a trusted certificate covering localhost.',
    ])
  })

  it('qualifies localhost TLS at its default port without mentioning an unlisted hostname', () => {
    expect(launchAddressLines([{ kind: 'local', url: 'https://localhost/' }], authenticate)).toHaveLength(2)
    expect(launchAddressLines([{ kind: 'local', url: 'https://127.0.0.2/' }], authenticate)).toHaveLength(1)
  })

  it('retains a native LAN-only fallback without inventing localhost', () => {
    expect(launchAddressLines([{ kind: 'lan', url: 'http://192.0.2.10:34567/' }], authenticate)).toEqual([
      'dsh web: http://192.0.2.10:34567/?token=synthetic-launch-token',
    ])
  })

  it('does not request a tokenized URL when there are no available addresses', () => {
    expect(
      launchAddressLines([], () => {
        throw new Error('must not authenticate a missing address')
      }),
    ).toEqual([])
  })
})
