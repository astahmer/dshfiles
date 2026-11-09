import { describe, expect, it } from 'vitest'
import { renderTerminalQr } from '../src/qr.ts'

describe('renderTerminalQr', () => {
  it('renders a scannable square matrix', () => {
    const lines = renderTerminalQr('https://phone.example/?token=secret').split('\n')
    expect(lines.length).toBeGreaterThan(10)
    expect(new Set(lines.map(line => line.length)).size).toBe(1)
    expect(lines.join('')).toMatch(/[█▀▄]/)
  })

  it('grows with longer payloads and honours the quiet zone', () => {
    const small = renderTerminalQr('https://a.example').split('\n')
    const large = renderTerminalQr(`https://a.example/?token=${'x'.repeat(120)}`).split('\n')
    expect(large.length).toBeGreaterThan(small.length)
    expect(renderTerminalQr('https://a.example', { quietZone: 0 }).split('\n')[0]).toContain('█')
  })
})
