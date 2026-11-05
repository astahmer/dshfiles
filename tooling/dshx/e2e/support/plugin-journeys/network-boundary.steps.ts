import { expect, type Page } from '@playwright/test'
import * as Schema from 'effect/Schema'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'

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

/** The refresh outcome: the catalog status, or the API failure the refused request surfaced as. */
const hostRefreshes = new WeakMap<Page, { readonly lastError: string | null } | { readonly failed: string }>()

const pricingStatusSchema = Schema.Struct({ lastError: Schema.NullOr(Schema.String) })

When('the scratch Host is asked to refresh the models.dev price catalog', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const call = await connectDshxApi({ url: profile.url, packageId: '@dshfiles/ai-accounts', apiId: 'ai-accounts', version: 1 })
  try {
    hostRefreshes.set(page, Schema.decodeUnknownSync(pricingStatusSchema)(await call('refreshPricing')))
  } catch (error) {
    // A refused request may surface as a failed API call rather than a status with lastError; both mean it did not land.
    hostRefreshes.set(page, { failed: error instanceof Error ? error.message : String(error) })
  }
})

Then('the Host egress guard refused the request and nothing left the machine', async ({ page }: { page: Page }) => {
  const refresh = hostRefreshes.get(page)
  await recordAssertion(page, 'host-egress-guard-refuses-external-requests', () => {
    expect(refresh, 'The refresh step did not run.').toBeDefined()
    if (refresh !== undefined && 'lastError' in refresh)
      expect(refresh.lastError, 'The Host refreshed models.dev, so it reached the network past the E2E egress guard.').not.toBeNull()
    expect(profileFor(page).egressAttempts()).toContain('models.dev:443')
  })
  await finishJourneyAssertions(page)
})
