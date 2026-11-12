import { describe, expect, it } from 'vitest'
import { RemoteReach } from './remote-reach.js'

const local = { hostname: '127.0.0.1', protocol: 'http:' }
const tailnet = { hostname: 'laptop.example-tailnet.ts.net', protocol: 'https:' }
const port = (address: string, number = 5173) => ({ address, port: number, url: `http://localhost:${String(number)}/` })

describe('RemoteReach', () => {
  it('leaves every URL alone when the GUI itself is on loopback', () => {
    expect(RemoteReach.port(port('127.0.0.1'), local)).toEqual({ kind: 'open', url: 'http://localhost:5173/', newTab: false })
    expect(RemoteReach.port(port('0.0.0.0'), { hostname: 'localhost', protocol: 'http:' })).toEqual({
      kind: 'open',
      url: 'http://localhost:5173/',
      newTab: false,
    })
  })

  it('opens a server listening on every interface on the Host name the phone reached DSH on, in a tab', () => {
    for (const address of ['0.0.0.0', '::', '*'])
      expect(RemoteReach.port(port(address), tailnet)).toEqual({ kind: 'open', url: 'http://laptop.example-tailnet.ts.net:5173/', newTab: true })
    expect(RemoteReach.port(port('::'), { hostname: '192.168.1.20', protocol: 'http:' })).toEqual({
      kind: 'open',
      url: 'http://192.168.1.20:5173/',
      newTab: false,
    })
  })

  it('explains a loopback-only server with the exact fix instead of opening a dead page', () => {
    const reach = RemoteReach.port(port('127.0.0.1', 3000), tailnet)
    expect(reach.kind).toBe('loopback-only')
    if (reach.kind !== 'loopback-only') return
    expect(reach.message).toContain('Port 3000 only listens on 127.0.0.1')
    expect(reach.message).toContain('vite --host 0.0.0.0')
    expect(reach.fix).toContain('tailscale serve --bg --https=3000 http://127.0.0.1:3000')
    const lan = RemoteReach.port(port('127.0.0.1', 3000), { hostname: '192.168.1.4', protocol: 'http:' })
    expect(lan.kind === 'loopback-only' && lan.fix.includes('tailscale')).toBe(false)
    expect(RemoteReach.port(port('::1'), tailnet).kind).toBe('loopback-only')
  })

  it('keeps a server bound to one concrete address on that address', () => {
    const reach = RemoteReach.port({ address: '100.64.0.7', port: 8080, url: 'http://100.64.0.7:8080/' }, tailnet)
    expect(reach).toEqual({ kind: 'open', url: 'http://100.64.0.7:8080/', newTab: true })
  })

  it('rewrites a preview page URL by its port, keeping the path, and refuses a loopback-only one', () => {
    expect(RemoteReach.url('http://localhost:5173/app?x=1', [port('0.0.0.0')], tailnet)).toEqual({
      kind: 'open',
      url: 'http://laptop.example-tailnet.ts.net:5173/app?x=1',
      newTab: true,
    })
    expect(RemoteReach.url('http://127.0.0.1:5173/', [port('127.0.0.1')], tailnet).kind).toBe('loopback-only')
    expect(RemoteReach.url('https://example.com/', [], tailnet)).toEqual({ kind: 'open', url: 'https://example.com/', newTab: false })
  })
})
