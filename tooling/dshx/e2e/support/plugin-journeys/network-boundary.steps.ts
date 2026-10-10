import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, recordAssertion } from '../steps.js'

const rejectedExternalFetches = new WeakMap<Page, boolean>()

When('the browser fetches a reserved external URL', async ({ page }: { page: Page }) => {
  const rejected = await page.evaluate(async () => {
    try {
      await fetch('https://blocked.invalid/')
      return false
    } catch {
      return true
    }
  })
  rejectedExternalFetches.set(page, rejected)
})

Then('the E2E browser network boundary rejects that fetch', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'browser-network-boundary-blocks-external-fetch', () => {
    expect(rejectedExternalFetches.get(page)).toBe(true)
    expect(browserDiagnosticsFor(page)).toContain('blocked outbound browser request: fetch')
  })
  await finishJourneyAssertions(page)
})
