// @vitest-environment jsdom
import http from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPairingGateway } from '../src/gateway.ts'
import { landingScript, pairPage, refusalMessage } from '../src/landing.ts'
import { createPairingStore } from '../src/store.ts'

/** Raw HTTP (not jsdom's fetch): the gateway's exact status, headers and body. */
const call = (port: number, path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) =>
  new Promise<{ status: number; type: string; body: string; cookie: string | undefined; location: string | undefined }>((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers ?? {} }, response => {
      let body = ''
      response.on('data', chunk => (body += String(chunk)))
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          type: String(response.headers['content-type'] ?? ''),
          body,
          cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
          location: response.headers.location,
        }),
      )
    })
    request.on('error', reject)
    request.end(init.body)
  })

/** A gateway answer body, decoded through the repository JSON parser. */
const bodyOf = (text: string) => decodeJson(jsonValueSchema, text)

/** What the page posts to /pair/redeem; `nonsense` stands for any body the gateway must refuse. */
interface RedeemBody {
  readonly id?: string
  readonly secret?: string
  readonly code?: string
  readonly nonsense?: boolean
}

const redeem = (port: number, body: RedeemBody, cookie?: string) => {
  const json = { 'content-type': 'application/json' }
  const headers = cookie === undefined ? json : { ...json, cookie }
  return call(port, '/pair/redeem', { method: 'POST', body: JSON.stringify(body), headers })
}

const gatewayFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pairing-landing-'))
  const upstream = http.createServer((_request, response) => response.end('native app'))
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address()
  if (address === null || typeof address === 'string') throw new Error('the upstream fixture did not bind a TCP port')
  const upstreamPort = address.port
  let time = 1_000
  const store = await createPairingStore({ path: join(directory, 'devices.json'), now: () => time, offerTtlMs: 60_000 })
  const gateway = createPairingGateway({
    upstream: upstreamPort,
    port: 0,
    store,
    publicOrigin: 'https://phone.example',
    nativeCookie: async () => ({ value: 'dsh-auth=fixture', expiresAt: Number.POSITIVE_INFINITY }),
  })
  await gateway.listen()
  return {
    store,
    port: gateway.port() ?? 0,
    advance: (ms: number) => (time += ms),
    close: async () => {
      gateway.closeAll()
      await new Promise(resolve => gateway.server.close(resolve))
      await new Promise(resolve => upstream.close(resolve))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

describe('phone pairing page', () => {
  it('answers a redeem with JSON and the device cookie, not a redirect the page fetch rejects', async () => {
    const fixture = await gatewayFixture()
    try {
      const offer = fixture.store.beginOffer()
      const paired = await redeem(fixture.port, { id: offer.id, secret: offer.secret })
      // Before this fix: 303 to `/`; the page's fetch (redirect: 'error') rejected it and showed "Pairing failed".
      expect(paired.status).toBe(200)
      expect(paired.location).toBeUndefined()
      expect(paired.type).toContain('application/json')
      expect(bodyOf(paired.body)).toMatchObject({ paired: true })
      expect(paired.cookie).toMatch(/^__Host-dsh_phone=/)
      expect((await call(fixture.port, '/', { headers: { cookie: paired.cookie ?? '' } })).body).toBe('native app')
    } finally {
      await fixture.close()
    }
  })

  it('tells a phone that already paired so, without spending another code', async () => {
    const fixture = await gatewayFixture()
    try {
      const offer = fixture.store.beginOffer()
      const { cookie } = await redeem(fixture.port, { id: offer.id, secret: offer.secret })
      // The user's sequence: the QR link paired the phone, then the same code was typed at /pair.
      const retyped = await redeem(fixture.port, { code: offer.code }, cookie)
      expect(retyped.status).toBe(200)
      expect(bodyOf(retyped.body)).toMatchObject({ paired: true, already: true })
      const unused = fixture.store.beginOffer()
      expect((await redeem(fixture.port, { code: unused.code }, cookie)).cookie).toBeUndefined()
      expect(fixture.store.listDevices()).toHaveLength(1)
      expect(fixture.store.pendingOffers()).toBe(1)
      const page = await call(fixture.port, '/pair', { headers: { cookie: cookie ?? '' } })
      expect(page.body).toContain('This phone is already paired')
      expect(page.body).toContain('href="/">Open DSH</a>')
    } finally {
      await fixture.close()
    }
  })

  it('says why a code is refused: used on another device, expired, replaced or wrong', async () => {
    const fixture = await gatewayFixture()
    try {
      const used = fixture.store.beginOffer()
      await redeem(fixture.port, { code: used.code })
      const again = await redeem(fixture.port, { code: used.code })
      expect(again.status).toBe(403)
      expect(bodyOf(again.body)).toEqual({ paired: false, reason: 'used', message: refusalMessage.used })
      const expired = fixture.store.beginOffer()
      fixture.advance(61_000)
      expect(bodyOf((await redeem(fixture.port, { code: expired.code })).body)).toMatchObject({ reason: 'expired' })
      const wrongCode = expired.code === '123456' ? '654321' : '123456'
      expect(bodyOf((await redeem(fixture.port, { code: wrongCode })).body)).toMatchObject({ reason: 'wrong' })
      expect(bodyOf((await redeem(fixture.port, { nonsense: true })).body)).toMatchObject({ reason: 'invalid' })
    } finally {
      await fixture.close()
    }
  })

  it('shows a recovery page, not a bare 401, when a page load carries a device cookie DSH no longer accepts', async () => {
    const fixture = await gatewayFixture()
    try {
      const stale = `__Host-dsh_phone=${'A'.repeat(43)}`
      const page = await call(fixture.port, '/', { headers: { cookie: stale, accept: 'text/html', 'sec-fetch-dest': 'document' } })
      expect(page.status).toBe(401)
      expect(page.type).toContain('text/html')
      expect(page.body).toContain('Pair this phone again')
      expect(page.body).toContain('href="/pair"')
      const script = await call(fixture.port, '/assets/app.js', { headers: { cookie: stale, 'sec-fetch-dest': 'script' } })
      expect(script.status).toBe(401)
      expect(script.type).toContain('text/plain')
    } finally {
      await fixture.close()
    }
  })

  it('names where the code is: Pair a phone on the computer, not the terminal', () => {
    expect(pairPage).toContain('Enter the 6-digit code shown in Pair a phone on your computer.')
    expect(pairPage).not.toContain('DSH terminal')
  })
})

describe('landing script', () => {
  afterEach(() => vi.unstubAllGlobals())

  const run = async (answer: { status: number; body: object }, hash = '') => {
    document.body.innerHTML = /<main>([\s\S]*)<\/main>/u.exec(pairPage)?.[1] ?? ''
    window.history.replaceState(null, '', `/pair${hash}`)
    /** Every request the page made, as `[url, init]`. */
    const requests: Parameters<typeof globalThis.fetch>[] = []
    const fetch: typeof globalThis.fetch = async (...args) => {
      requests.push(args)
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
    }
    vi.stubGlobal('fetch', fetch)
    new Function(landingScript)()
    if (hash === '') {
      const input = document.querySelector<HTMLInputElement>('#code')
      if (input === null) throw new Error('no code input')
      input.value = '123456'
      document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
    }
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).not.toBe('Pairing…'))
    return { requests, status: document.querySelector('#status') }
  }

  it('redeems the QR link without following a redirect and opens DSH', async () => {
    const { requests, status } = await run({ status: 200, body: { paired: true, message: 'Paired. Opening DSH…' } }, '#id=a&secret=b')
    expect(requests).toEqual([['/pair/redeem', expect.not.objectContaining({ redirect: 'error' })]])
    expect(status?.textContent).toBe('Paired. Opening DSH…')
    expect(document.querySelector<HTMLAnchorElement>('#open')?.hidden).toBe(false)
  })

  it('shows the reason a typed code was refused and keeps the form', async () => {
    const { status } = await run({ status: 403, body: { paired: false, reason: 'used', message: refusalMessage.used } })
    expect(status?.textContent).toBe(refusalMessage.used)
    expect(status?.getAttribute('data-reason')).toBe('used')
    expect(document.querySelector<HTMLFormElement>('#form')?.hidden).toBe(false)
  })
})

describe('pairing page styles', () => {
  it('keeps hidden actions hidden: the button style never overrides [hidden]', () => {
    expect(pairPage).toMatch(/\[hidden\]\{display:none!important\}/u)
  })
})
