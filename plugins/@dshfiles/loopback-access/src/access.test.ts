import { describe, expect, it } from 'vitest'
import { LoopbackAccess } from './access.js'

const server = (host: string, port: number | undefined) => ({
  host,
  port,
  protocol: 'http:' as const,
  getOrigin: () => `http://${host.includes(':') ? `[${host}]` : host}:${String(port)}`,
})

describe('native listener policy', () => {
  it.each(['127.0.0.1', '127.0.0.2', '127.23.4.5', '::1', '::ffff:127.0.0.1'])('leaves a native loopback bind unchanged: %s', async host => {
    const access = new LoopbackAccess(server(host, 3198))
    await access.start()
    expect(access.status()).toMatchObject({ state: 'native-loopback', localhostOrigin: null, listeners: [] })
    await access.close()
    expect(access.status().state).toBe('stopped')
  })

  it('does not guess a port before the native listener is ready', async () => {
    const access = new LoopbackAccess(server('192.0.2.1', undefined))
    await expect(access.start()).rejects.toThrow('initialized Web server port')
    expect(access.status()).toMatchObject({ state: 'failed', upstreamOrigin: null, localhostOrigin: null, listeners: [] })
    await access.close()
  })

  it('reports no upstream URL for a scoped IPv6 bind the native URL getter cannot express', async () => {
    const access = new LoopbackAccess({
      ...server('fe80::1%interface', 3198),
      getOrigin: () => {
        throw new Error('A scoped IPv6 address has no URL form.')
      },
    })
    expect(access.status()).toMatchObject({ upstreamOrigin: null, localhostOrigin: null, listeners: [] })
    await access.close()
  })

  it('does not start after disposal and tolerates repeated disposal', async () => {
    const access = new LoopbackAccess(server('192.0.2.1', 3198))
    await access.close()
    await access.start()
    await access.close()
    expect(access.status()).toMatchObject({ state: 'stopped', listeners: [] })
  })
})
