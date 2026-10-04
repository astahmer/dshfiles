import type { Page } from '@playwright/test'

export interface BrowserBootOptions {
  readonly url: string
  readonly timeoutMs: number
}

export interface BrowserBootOutcome {
  /** True when the Web UI mounted without a plugin failure card. */
  readonly ok: boolean
  /** Boot card text, empty when the UI mounted cleanly. */
  readonly text: string
}

/**
 * Read the boot card from a page the caller already opened.
 *
 * The card is the only stable surface for this: the client boot writes each
 * entry's outcome there, and nothing internal is required to stay put. A clean
 * boot replaces the card with the application, so "Failed to load plugins" never
 * appearing is the pass condition.
 *
 * The page is passed in rather than opened here so this module stays a pure
 * reader: the caller owns the browser and the Host, which is also what lets the
 * E2E scenarios share one launch across every assertion.
 */
export const readClientBootOutcome = async (page: Page, options: BrowserBootOptions): Promise<BrowserBootOutcome> => {
  const card = page.locator('[data-dsh-boot]')
  const failure = page.getByText('Failed to load plugins')
  const deadline = Date.now() + options.timeoutMs
  while (Date.now() < deadline) {
    if ((await failure.count()) > 0) return { ok: false, text: await card.innerText() }
    // A clean boot replaces the card with the application, so its absence is the pass.
    if ((await card.count()) === 0) return { ok: true, text: '' }
    await page.waitForTimeout(250)
  }
  return { ok: false, text: await card.innerText().catch(() => '') }
}
