import { expect, type Page } from '@playwright/test'
import { request as httpRequest } from 'node:http'
import { networkInterfaces } from 'node:os'
import { Given, Then } from '../bdd.js'
import { bootComposedPluginProfile } from '../boot.js'
import { allowLoopbackBrowserOrigin, finishJourneyAssertions, profileFor, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { createDshxApiCaller } from '../../../packages/dshx/src/platform/dshx-api.js'
import { ApiProtocolModel } from '../../../packages/dshx/src/api/common.js'
import { loopbackAccessStatusSchema } from '../../../../../plugins/@dshfiles/loopback-access/src/api.js'

const lanAddresses = new WeakMap<Page, string>()
const packageId = '@dshfiles/loopback-access'

Given('the isolated LAN-bound localhost-access profile is booted', async ({ page }: { page: Page }) => {
  const lan = Object.values(networkInterfaces())
    .flatMap(entries => entries ?? [])
    .find(entry => !entry.internal && entry.family === 'IPv4')?.address
  if (lan === undefined) throw new Error('This networking journey requires a concrete local non-loopback IPv4 interface.')
  lanAddresses.set(page, lan)
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/loopback-access'],
    profileLabel: 'loopback-access-lan',
    cordisPatch: `- id: webserver
  config:
    host: ${JSON.stringify(lan)}
    port: !!js ctx.webStartup.port ?? 0
- id: web-runtime
  inject: [webStartup]
  config:
    openBrowser: false
    printUrl: true
    surfaceContext: true
    publicUrl: !!js ${JSON.stringify("'http://127.0.0.1:' + (ctx.webStartup.port ?? 3080) + '/'")}
`,
  })
  await visitIsolatedPluginProfile(page, profile)
})

const bootstrap = async (url: URL): Promise<string> => {
  const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
  expect(exchange.status).toBe(303)
  expect(exchange.headers.get('location')).toBe('./')
  const cookies = exchange.headers.getSetCookie()
  // Assert attributes without passing opaque credential values to assertion output.
  expect(cookies.every(value => value.includes('; HttpOnly') && value.includes('; SameSite=Strict'))).toBe(true)
  const cookie = cookies
    .map(value => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ')
  if (cookie.length === 0) throw new Error('The stock Host did not issue its native authority-bound cookie.')
  return cookie
}

Then('LAN and localhost retain native authentication and browser-origin fencing', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const lan = lanAddresses.get(page)
  if (lan === undefined) throw new Error('The isolated LAN address was not recorded.')
  const localUrl = new URL(profile.url)
  localUrl.hostname = 'localhost'
  const lanUrl = new URL(profile.url)
  lanUrl.hostname = lan

  await recordAssertion(page, 'loopback-access-native-auth-on-both-origins', async () => {
    for (const url of [localUrl, lanUrl]) {
      const unauthenticated = await fetch(url.origin, { signal: AbortSignal.timeout(10_000) })
      expect(unauthenticated.status).toBe(401)
      const api = `${url.origin}/api${ApiProtocolModel.apiChannel(packageId, 'loopback-access')}/status`
      expect((await fetch(api, { signal: AbortSignal.timeout(10_000) })).status).toBe(401)
      const cookie = await bootstrap(url)
      const index = await fetch(url.origin, { headers: { cookie }, signal: AbortSignal.timeout(10_000) })
      expect(index.status).toBe(200)
      expect(await index.text()).toContain('__DSH_BOOT__')
      const call = createDshxApiCaller({ origin: url.origin, cookie, packageId, apiId: 'loopback-access', version: 1 })
      const status = loopbackAccessStatusSchema.parse(await call('status', undefined, AbortSignal.timeout(10_000)))
      expect(status.state).toBe('forwarding')
      expect(status.upstreamOrigin).toBe(lanUrl.origin)
      expect(status.localhostOrigin).toBe(localUrl.origin)
      expect(status.listeners).toContainEqual({ host: '127.0.0.1', port: profile.port })
      for (const listener of status.listeners) {
        const origin = `http://${listener.host === '::1' ? '[::1]' : listener.host}:${String(listener.port)}`
        expect((await fetch(origin, { signal: AbortSignal.timeout(10_000) })).status).toBe(401)
      }
    }
  })

  await recordAssertion(page, 'loopback-access-retains-host-origin-and-cookie-fences', async () => {
    for (const [url, otherUrl] of [
      [localUrl, lanUrl],
      [lanUrl, localUrl],
    ] as const) {
      const cookie = await bootstrap(url)
      const api = `${url.origin}/api${ApiProtocolModel.apiChannel(packageId, 'loopback-access')}/status`
      for (const headers of [
        { host: 'attacker.invalid', cookie },
        { origin: 'http://attacker.invalid', cookie },
        { 'sec-fetch-site': 'cross-site', cookie },
      ]) {
        // node:http preserves an explicit hostile Host header; fetch may normalize it.
        const status = await new Promise<number>((resolve, reject) => {
          const request = httpRequest(api, { headers, signal: AbortSignal.timeout(10_000) }, response => {
            response.resume()
            response.once('end', () => resolve(response.statusCode ?? 0))
          })
          request.once('error', reject)
          request.end()
        })
        expect(status).toBe(403)
      }
      const replay = await fetch(otherUrl.origin, { headers: { cookie }, signal: AbortSignal.timeout(10_000) })
      expect(replay.status).toBe(401)
    }
  })

  await recordAssertion(page, 'loopback-access-browser-secure-context-and-websocket', async () => {
    allowLoopbackBrowserOrigin(page, localUrl.origin)
    const localPage = await page.context().newPage()
    try {
      // The fixture boots at 127.0.0.1; prove the real localhost authority too.
      await localPage.goto(localUrl.href).catch(() => {
        throw new Error('The isolated localhost browser bootstrap failed; its private launch URL is omitted.')
      })
      expect(localPage.url() === `${localUrl.origin}/`).toBe(true)
      const browserFacts = await localPage.evaluate(async () => {
        const websocketOpened = await new Promise<boolean>(resolve => {
          const socket = new WebSocket(`${location.origin.replace('http:', 'ws:')}/api/remote.mux`)
          const timer = setTimeout(() => {
            socket.close()
            resolve(false)
          }, 10_000)
          socket.onopen = () => {
            clearTimeout(timer)
            socket.close()
            resolve(true)
          }
          socket.onerror = () => {
            clearTimeout(timer)
            socket.close()
            resolve(false)
          }
        })
        return { secure: isSecureContext, randomUUID: crypto.randomUUID(), websocketOpened }
      })
      expect(browserFacts).toMatchObject({ secure: true, websocketOpened: true })
      expect(browserFacts.randomUUID).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u)
    } finally {
      await localPage.close()
    }
  })
  await finishJourneyAssertions(page)
})
