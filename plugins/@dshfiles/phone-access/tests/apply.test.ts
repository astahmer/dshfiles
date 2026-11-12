import http from 'node:http'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { apply, claimer } from '../src/host.ts'

const context = (authenticatedUrl: (url: string) => string) => {
  const output: string[] = []
  const ctx = {
    effect: () => {},
    get: (name: string) => (name === 'loader' ? { await: () => Promise.resolve() } : { authenticatedUrl }),
  }
  return { ctx, output }
}

describe('apply', () => {
  it('prints one QR per secure origin and ignores unsafe ones', async () => {
    const lines: string[] = []
    const log = console.log
    console.log = (...args: unknown[]) => void lines.push(args.join(' '))
    try {
      const { ctx } = context(origin => `${origin}/?token=fixture-token`)
      apply(ctx as never, {
        origins: ['https://phone.example', 'http://plain.example', 'https://user:pass@phone.example', 'https://phone.example/?x=1'],
      })
      await new Promise(resolve => setImmediate(resolve))
    } finally {
      console.log = log
    }
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('https://phone.example')
    expect(lines[0]).toMatch(/[█▀▄]/)
    expect(lines[0]).not.toContain('fixture-token')
  })

  it('prints nothing without configured origins', () => {
    const lines: string[] = []
    const log = console.log
    console.log = (...args: unknown[]) => void lines.push(args.join(' '))
    try {
      const { ctx } = context(origin => origin)
      apply(ctx as never, { origins: [] })
    } finally {
      console.log = log
    }
    expect(lines).toEqual([])
  })

  it('keeps one route claim per package and reports it until it is released', async () => {
    const log = console.log
    console.log = () => {}
    try {
      const { ctx } = context(origin => origin)
      const edge = apply(ctx as never, { origins: ['https://phone.example'] })
      await edge.ready()
      expect(edge.status()).toMatchObject({ origins: ['https://phone.example'], claims: [] })
      edge.claim('@dshfiles/phone-pairing', { port: 4100, pathPrefixes: ['/pair'], cookie: '__Host-dsh_phone' })
      edge.claim('@dshfiles/phone-pairing', { port: 4101, pathPrefixes: ['/pair'] })
      expect(edge.status().claims).toEqual(['@dshfiles/phone-pairing'])
      expect(edge.release('@dshfiles/phone-pairing')).toBe(true)
      expect(edge.release('@dshfiles/phone-pairing')).toBe(false)
      expect(edge.status().claims).toEqual([])
    } finally {
      console.log = log
    }
  })

  it('lets only a Host plugin claim phone routes', () => {
    expect(claimer({ kind: 'plugin', packageId: '@dshfiles/phone-pairing' })).toBe('@dshfiles/phone-pairing')
    expect(() => claimer({ kind: 'client' })).toThrow(/Host plugin/u)
    expect(() => claimer({ kind: 'agent' })).toThrow(/Host plugin/u)
  })

  it('keeps a route claim across a re-apply, so phone pairing keeps answering on the shared origin', async () => {
    const listen = async (server: http.Server): Promise<number> => {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (address === null || !('port' in address)) throw new Error('no port')
      return address.port
    }
    const native = http.createServer((_request, response) => response.end('native'))
    const pairing = http.createServer((_request, response) => response.end('pairing'))
    const nativePort = await listen(native)
    const pairingPort = await listen(pairing)
    const reservation = http.createServer()
    const proxyPort = await listen(reservation)
    await new Promise(resolve => reservation.close(resolve))
    const get = (path: string) =>
      new Promise<string>((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port: proxyPort, path, agent: false }, response => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', chunk => (body += chunk))
          response.on('end', () => resolve(body))
        })
        request.on('error', reject)
        request.end()
      })
    /** One Cordis activation: its effects' disposers run when it unloads, as on a config change. */
    const activation = () => {
      const disposers: (() => void)[] = []
      const ctx = {
        effect: (effect: () => () => void) => void disposers.push(effect()),
        get: (name: string) => (name === 'webServer' ? { port: nativePort } : name === 'loader' ? { await: () => Promise.resolve() } : {}),
      }
      return { ctx, dispose: () => disposers.forEach(dispose => dispose()) }
    }
    const log = console.log
    console.log = () => {}
    const first = activation()
    let second: ReturnType<typeof activation> | undefined
    try {
      const edge = apply(first.ctx as never, { origins: ['https://phone.example'], proxyPort })
      await edge.ready()
      edge.claim('@dshfiles/phone-pairing', { port: pairingPort, pathPrefixes: ['/pair'] })
      expect(await get('/pair')).toBe('pairing')

      first.dispose()
      second = activation()
      const reapplied = apply(second.ctx as never, { origins: ['https://phone.example'], proxyPort })
      await reapplied.ready()
      expect(reapplied.status().claims).toEqual(['@dshfiles/phone-pairing'])
      expect(await get('/pair')).toBe('pairing')
      expect(reapplied.release('@dshfiles/phone-pairing')).toBe(true)
      expect(await get('/pair')).toBe('native')
    } finally {
      console.log = log
      second?.dispose()
      await new Promise(resolve => native.close(resolve))
      await new Promise(resolve => pairing.close(resolve))
    }
  })
})
