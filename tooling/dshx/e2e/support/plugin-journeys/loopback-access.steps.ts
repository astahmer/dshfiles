import { expect, test, type Page } from '@playwright/test'
import { Agent, request as httpRequest } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { Given, Then } from '../bdd.js'
import { bootComposedPluginProfile } from '../boot.js'
import {
  allowLoopbackBrowserOrigin,
  finishJourneyAssertions,
  profileFor,
  recordAssertion,
  restartScratchProfileInBrowser,
  visitIsolatedPluginProfile,
} from '../steps.js'
import { createDshxApiCaller } from '../../../packages/dshx/src/platform/dshx-api.js'
import { ApiProtocolModel } from '../../../packages/dshx/src/api/common.js'
import { loopbackAccessStatusSchema } from '../../../../../plugins/@dshfiles/loopback-access/src/api.js'
import { networkSnapshotSchema } from '../../../../../plugins/@dshfiles/loopback-access/src/network-api.js'

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
    // A saved value from the retired switch must not remove localhost at boot.
    cordisPatch: `- id: dshfiles-network-startup
  config:
    localhostEnabled: false
- id: webserver
  config:
    host: ${JSON.stringify(lan)}
    port: !!js ctx.webStartup.port ?? 0
- id: web-runtime
  inject: [webStartup]
  config:
    openBrowser: false
    printUrl: false
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

  await recordAssertion(page, 'loopback-access-localhost-first-terminal', async () => {
    const output = profile.output()
    const lines = output.split('\n')
    const primary = lines.filter(line => /^dsh web: https?:\/\//u.test(line))
    expect(primary).toHaveLength(1)
    expect(primary[0]?.startsWith(`dsh web: http://localhost:${String(profile.port)}/`)).toBe(true)
    const localIndex = lines.findIndex(line => line === primary[0])
    const lanIndex = lines.findIndex(line => line.startsWith(`  LAN: ${lanUrl.origin}/`))
    expect(lanIndex > localIndex).toBe(true)
    expect(output.includes('token=')).toBe(false)
  })

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

Given('the isolated managed Network access profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/loopback-access', '@dshfiles/settings-shell', '@dshfiles/command-palette'],
    profileLabel: 'network-access-settings',
    cordisPatch: `- id: dshfiles-network-startup
  config:
    localhostEnabled: false
- id: web-runtime
  inject: [webStartup]
  config:
    openBrowser: false
    printUrl: false
    surfaceContext: true
    publicUrl: !!js ${JSON.stringify("'http://127.0.0.1:' + (ctx.webStartup.port ?? 3080) + '/'")}
`,
  })
  await visitIsolatedPluginProfile(page, profile)
})

const openNetworkSettings = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Network access', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Network access', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'LAN access', exact: true })).toBeEnabled()
}

Then('network choices are staged safely and loaded at the next isolated startup', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const cookie = (await page.context().cookies(profile.url)).map(item => `${item.name}=${item.value}`).join('; ')
  const origin = new URL(profile.url).origin
  const call = createDshxApiCaller({ origin, cookie, packageId, apiId: 'loopback-access', version: 1 })
  const read = async () => networkSnapshotSchema.parse(await call('network', undefined, AbortSignal.timeout(10_000)))
  const before = await read()
  expect(before.integration).toBe('managed')
  expect(before.writable).toBe(true)
  expect(before.active.host).toBe('127.0.0.1')
  expect(before.cliOverrides).toEqual({ host: null, port: profile.port })
  const address = before.addresses[0]
  if (address === undefined) throw new Error('This journey requires a non-loopback interface address.')
  await openNetworkSettings(page)

  await recordAssertion(page, 'network-access-save-preserves-live-listener-and-connection', async () => {
    await expect(page.getByRole('switch', { name: 'Localhost access', exact: true })).toHaveCount(0)
    await page.getByRole('switch', { name: 'LAN access', exact: true }).click()
    await expect(page.getByRole('switch', { name: 'Localhost access', exact: true })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'LAN address', exact: true }).click()
    await page.getByRole('option').filter({ hasText: address.address }).click()
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    const requestIndex = () =>
      new Promise<Socket>((resolve, reject) => {
        const request = httpRequest(origin, { agent, headers: { cookie }, signal: AbortSignal.timeout(10_000) }, response => {
          const socket = response.socket
          if (response.statusCode !== 200) {
            response.resume()
            reject(new Error('The authenticated native index request did not succeed.'))
            return
          }
          response.resume()
          response.once('end', () => resolve(socket))
        })
        request.once('error', reject)
        request.end()
      })
    try {
      const connection = await requestIndex()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Preferences saved. The current connection has not changed.', { exact: true })).toBeVisible()
      await expect(page.getByText('Restart DSH to load the saved preferences.', { exact: true })).toBeVisible()
      const after = await read()
      expect(after.saved).toMatchObject({ lanEnabled: true, bindAddress: address.address, localhostEnabled: true })
      expect(after.revision).toBeGreaterThan(before.revision)
      expect(after.pendingRestart).toBe(true)
      expect(after.active).toEqual(before.active)
      expect(await requestIndex()).toBe(connection)
    } finally {
      agent.destroy()
    }
  })

  await recordAssertion(page, 'network-access-refuses-invalid-and-concurrent-writes', async () => {
    const saved = await read()
    const patchPath = join(profile.homeRoot, 'profiles', profile.profile, 'cordis.patch.yml')
    const persisted = await readFile(patchPath, 'utf8')
    expect(persisted.includes('localhostEnabled')).toBe(false)
    await expect(call('saveNetwork', { ...saved.saved, expectedRevision: before.revision }, AbortSignal.timeout(10_000))).rejects.toThrow()
    await expect(
      call('saveNetwork', { ...saved.saved, bindAddress: '0.0.0.0', expectedRevision: saved.revision }, AbortSignal.timeout(10_000)),
    ).rejects.toThrow()
    for (const lanEnabled of [true, false]) {
      await expect(
        call('saveNetwork', { ...saved.saved, lanEnabled, localhostEnabled: false, expectedRevision: saved.revision }, AbortSignal.timeout(10_000)),
      ).rejects.toThrow()
    }
    const settings = createDshxApiCaller({ origin, cookie, packageId: '@dshfiles/settings-shell', apiId: 'settings-shell', version: 1 })
    await expect(
      settings('set', { namespace: 'dshfiles-network-startup', patch: { lanEnabled: true, bindAddress: null } }, AbortSignal.timeout(10_000)),
    ).rejects.toThrow()
    expect(await readFile(patchPath, 'utf8')).toBe(persisted)
    expect((await read()).revision).toBe(saved.revision)
  })

  await recordAssertion(page, 'network-access-next-startup-authenticated', async () => {
    await restartScratchProfileInBrowser(page)
    const nextCookie = (await page.context().cookies(profile.url)).map(item => `${item.name}=${item.value}`).join('; ')
    const nextCall = createDshxApiCaller({ origin, cookie: nextCookie, packageId, apiId: 'loopback-access', version: 1 })
    const after = networkSnapshotSchema.parse(await nextCall('network', undefined, AbortSignal.timeout(10_000)))
    expect(after.pendingRestart).toBe(false)
    expect(after.active.host).toBe(address.address)
    expect(after.active.localhostEnabled).toBe(true)
    expect(after.active.urls).toContain(`http://localhost:${String(profile.port)}`)
    for (const url of after.active.urls) {
      expect((await fetch(url, { signal: AbortSignal.timeout(10_000) })).status).toBe(401)
    }
    await openNetworkSettings(page)
    await expect(page.getByRole('switch', { name: 'LAN access', exact: true })).toBeChecked()
    await expect(page.getByText('Saved preferences are loaded for this launch.', { exact: true })).toBeVisible()
  })

  await recordAssertion(page, 'network-access-settings-fit-narrow-panes', async () => {
    for (const width of [360, 480, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      const section = page.getByRole('heading', { name: 'Network access', exact: true }).locator('..').locator('..')
      await expect(section).toBeVisible()
      expect(await section.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await expect(page.getByRole('switch', { name: 'LAN access', exact: true })).toBeVisible()
      if (width === 360) {
        const sections = page.getByRole('combobox', { name: 'Sections', exact: true })
        await expect(sections).toBeVisible()
        await sections.click()
        await page.getByRole('option', { name: 'General', exact: true }).click()
        await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0)
        await expect(page.getByRole('switch', { name: 'Show coding view', exact: true })).toBeVisible()
        await page.screenshot({ path: test.info().outputPath('settings-shell-port-compact.png') })
        await sections.click()
        await page.getByRole('option', { name: 'Network access', exact: true }).click()
        await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0)
        await expect(page.getByRole('switch', { name: 'LAN access', exact: true })).toBeVisible()
        expect(await page.getByRole('searchbox', { name: 'Search settings', exact: true }).evaluate(element => element.clientWidth)).toBeGreaterThan(60)
      }
      await page.screenshot({ path: test.info().outputPath(`network-access-settings-${String(width)}.png`) })
    }
    await page.screenshot({ path: test.info().outputPath('network-access-settings.png') })
  })
  await finishJourneyAssertions(page)
})
