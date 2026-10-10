import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, recordAssertion } from '../steps.js'

const rejectedNetworkRequests = new WeakMap<Page, { readonly fetches: readonly boolean[]; readonly websocket: boolean }>()

When('the browser tries unapproved HTTP and WebSocket origins', async ({ page }: { page: Page }) => {
  const fetches = await page.evaluate(async () => {
    const urls = ['https://blocked.invalid/', 'http://127.0.0.1:9/']
    return Promise.all(
      urls.map(async url => {
        try {
          await fetch(url)
          return false
        } catch {
          return true
        }
      }),
    )
  })
  const websocket = await page.evaluate(
    () =>
      new Promise<boolean>(resolve => {
        const socket = new WebSocket('wss://blocked.invalid/')
        const timeout = window.setTimeout(() => {
          socket.close()
          resolve(false)
        }, 2_000)
        const finish = (rejected: boolean): void => {
          window.clearTimeout(timeout)
          resolve(rejected)
        }
        socket.addEventListener('error', () => finish(true), { once: true })
        socket.addEventListener('close', event => finish(event.code === 1008), { once: true })
      }),
  )
  rejectedNetworkRequests.set(page, { fetches, websocket })
})

Then('the E2E browser network boundary rejects both transports', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'browser-network-boundary-blocks-unapproved-origins', () => {
    expect(rejectedNetworkRequests.get(page)).toEqual({ fetches: [true, true], websocket: true })
    expect(browserDiagnosticsFor(page).filter(message => message === 'blocked outbound browser request: fetch')).toHaveLength(2)
    expect(browserDiagnosticsFor(page)).toContain('blocked outbound browser websocket')
  })
  await finishJourneyAssertions(page)
})
