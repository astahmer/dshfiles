import type { Page } from '@playwright/test'

export interface BrowserBootOptions {
  readonly url: string
  readonly timeoutMs: number
}

/** A Slot that threw while rendering, as the renderer marked it in the DOM. */
export interface SlotRenderFailure {
  readonly slot: string
}

export interface BrowserBootOutcome {
  /** True when the Web UI mounted without a plugin failure card. */
  readonly ok: boolean
  /** Boot card text, empty when the UI mounted cleanly. */
  readonly text: string
  /**
   * Slots that mounted an error boundary instead of their entry. An entry that
   * throws while rendering never reaches the boot audit, because the fiber itself
   * activated fine — only the boundary caught it.
   */
  readonly slotFailures: readonly SlotRenderFailure[]
}

const SLOT_ERROR = '[data-slot-error]'

/**
 * Read the boot card and any Slot that fell to its error boundary.
 *
 * The card is the only stable surface for activation: the client boot writes each
 * entry's outcome there, and nothing internal is required to stay put. A clean
 * boot replaces the card with the application, so "Failed to load plugins" never
 * appearing is the pass condition.
 *
 * The error boundaries matter as much as the card, and for a different reason. A
 * plugin whose apply throws never reaches active and lands in the audit, but one
 * that reads a service it never declared throws while rendering, after it has
 * already activated. The fiber is fine, the audit is clean, and the only trace is
 * a marker element where a panel should be. Checking one without the other misses
 * a whole class: the audit catches activation, the boundary catches render.
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
    if ((await failure.count()) > 0) return { ok: false, text: await card.innerText(), slotFailures: await slotFailures(page) }
    // A clean boot replaces the card with the application, so its absence is the pass.
    if ((await card.count()) === 0) return { ok: true, text: '', slotFailures: await slotFailures(page) }
    await page.waitForTimeout(250)
  }
  return { ok: false, text: await card.innerText().catch(() => ''), slotFailures: await slotFailures(page) }
}

/**
 * Turn the Slot names a page's boundary markers carry into failures.
 *
 * Separated from the evaluate call so the mapping is testable without a browser:
 * the callback runs in the page, so a stub could never exercise it directly.
 */
export const slotRenderFailures = (slotNames: readonly (string | null)[]): readonly SlotRenderFailure[] =>
  slotNames.filter((slot): slot is string => slot !== null && slot !== '').map(slot => ({ slot }))

/** Every Slot currently rendering its error boundary. */
const slotFailures = async (page: Page): Promise<readonly SlotRenderFailure[]> => {
  const slotNames = await page.evaluate(selector => {
    return [...document.querySelectorAll(selector)].map(element => element.getAttribute('data-slot-error'))
  }, SLOT_ERROR)
  return slotRenderFailures(slotNames)
}
