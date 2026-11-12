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
})
