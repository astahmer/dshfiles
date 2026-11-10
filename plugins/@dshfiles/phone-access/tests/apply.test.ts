import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

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
})
