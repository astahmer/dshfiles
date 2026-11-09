import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPairingGateway, mintNativeCookie } from '../src/gateway.ts'
import { createPairingStore } from '../src/store.ts'

const origin = process.env.PAIRING_E2E_ORIGIN
const token = process.env.PAIRING_E2E_TOKEN
const enabled = origin !== undefined && token !== undefined

const nativeCookie = () => mintNativeCookie(`${origin}/?token=${token ?? ''}`)

const freePort = async (): Promise<number> =>
  new Promise(resolve => {
    const server = http.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address === null || !('port' in address) ? 0 : address.port
      server.close(() => resolve(port))
    })
  })

describe('gateway against a real native listener', () => {
  it.skipIf(!enabled)('pairs by code and proxies the authenticated app', async () => {
    const upstream = new URL(origin ?? 'http://127.0.0.1:1').port
    const directory = await mkdtemp(join(tmpdir(), 'pairing-e2e-'))
    const port = await freePort()
    const store = await createPairingStore({ path: join(directory, 'devices.json') })
    const gateway = createPairingGateway({ upstream: Number(upstream), port, store, publicOrigin: `http://127.0.0.1:${port}`, nativeCookie })
    try {
      await gateway.listen()
      const offer = store.beginOffer()
      const redeem = await fetch(`http://127.0.0.1:${port}/pair/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: offer.code }),
        redirect: 'manual',
      })
      expect(redeem.status).toBe(303)
      const cookie = redeem.headers.get('set-cookie')?.split(';')[0] ?? ''
      expect(cookie).toMatch(/^__Host-dsh_phone=/)
      const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie } })
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('__DSH_BOOT__')
      const unpaired = await fetch(`http://127.0.0.1:${port}/`)
      expect(unpaired.status).toBe(401)
    } finally {
      gateway.closeAll()
      await new Promise(resolve => gateway.server.close(resolve))
      await rm(directory, { recursive: true, force: true })
    }
  })
})
