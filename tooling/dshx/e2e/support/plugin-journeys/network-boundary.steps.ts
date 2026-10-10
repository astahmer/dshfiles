import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, recordAssertion } from '../steps.js'

const rejectedNetworkRequests = new WeakMap<Page, readonly boolean[]>()

When('the browser fetches unapproved external and loopback origins', async ({ page }: { page: Page }) => {
  const rejected = await page.evaluate(async () => {
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
  rejectedNetworkRequests.set(page, rejected)
})

Then('the E2E browser network boundary rejects both fetches', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'browser-network-boundary-blocks-unapproved-origins', () => {
    expect(rejectedNetworkRequests.get(page)).toEqual([true, true])
    expect(browserDiagnosticsFor(page).filter(message => message === 'blocked outbound browser request: fetch')).toHaveLength(2)
  })
  await finishJourneyAssertions(page)
})
