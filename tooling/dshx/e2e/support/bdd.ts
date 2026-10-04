import { test as bddTest, type Page } from 'playwright-bdd'
import { createBdd } from 'playwright-bdd'

/**
 * createBdd() returns the Given/When/Then constructors this suite defines steps
 * with. The feature and step globs live in playwright.e2e.config.ts, which
 * generates one spec per feature; this module supplies the step vocabulary and
 * the one shared reader every boot step needs.
 *
 * The base test must be playwright-bdd's own, not @playwright/test's, because the
 * BDD fixtures are attached to it.
 */
export const { Given, When, Then } = createBdd(bddTest)

/** Read the boot card, waiting for either the failure card or a mounted application. */
export const readBootOutcome = async (page: Page, timeoutMs: number): Promise<string> => {
  const card = page.locator('[data-dsh-boot]')
  const failure = page.getByText('Failed to load plugins')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await failure.count()) > 0) return card.innerText()
    // A clean boot replaces the card with the application, so its absence is the pass.
    if ((await card.count()) === 0) return ''
    await page.waitForTimeout(250)
  }
  return card.innerText().catch(() => '')
}
