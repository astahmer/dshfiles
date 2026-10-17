import type { Locator, Page } from '@playwright/test'

/**
 * DSH 0.2.1 renamed this dialog and replaced its "Configure later" button with "Close". Both generations still mean
 * "this scratch Host has no provider", so both names and both dismissal buttons stay accepted.
 */
const PROVIDER_SETUP_DIALOG = /^(Add an API key to get started|Get started)$/
const PROVIDER_SETUP_DISMISS_BUTTONS = ['Configure later', 'Close'] as const
const PREVIEW_NOTICE_DIALOG = 'Preview Notice'

const providerSetupDialog = (page: Page): Locator => page.getByRole('dialog', { name: PROVIDER_SETUP_DIALOG })

/** Clicks whichever dismissal the visible dialog generation offers; the button may vanish under the locator handler. */
const dismissProviderSetupDialog = async (dialog: Locator, timeoutMs: number): Promise<void> => {
  for (const name of PROVIDER_SETUP_DISMISS_BUTTONS) {
    const button = dialog.getByRole('button', { name, exact: true })
    if (!(await button.isVisible().catch(() => false))) continue
    await button.click({ timeout: timeoutMs }).catch(() => undefined)
    return
  }
}

const previewNoticeDialog = (page: Page): Locator => page.getByRole('dialog', { name: PREVIEW_NOTICE_DIALOG, exact: true })

const appears = (dialog: Locator, timeoutMs: number): Promise<boolean> =>
  dialog.waitFor({ state: 'visible', timeout: timeoutMs }).then(
    () => true,
    (error: unknown) => {
      if (error instanceof Error && error.name === 'TimeoutError') return false
      throw error
    },
  )

/** Dismiss the provider-setup dialog whenever it covers an element this page acts on. */
export const registerProviderSetupDismissal = (page: Page): Promise<void> => {
  // A dialog opened over it (a palette) blocks the click; the blocked action then fails on its own instead of the
  // handler rejecting after the page has closed and crashing the process.
  return page.addLocatorHandler(providerSetupDialog(page), async dialog => {
    await dismissProviderSetupDialog(dialog, 5_000)
  })
}

/**
 * The dialog returns on the first New thread screen of a fresh page, possibly after a key press is already on its way;
 * a step that types or presses keys checks for it first, since only locator actions trigger the registered handler.
 */
export const dismissProviderSetupIfShown = async (page: Page): Promise<void> => {
  const providerSetup = providerSetupDialog(page)
  if (!(await providerSetup.isVisible())) return
  // While it animates in or out the button may refuse a click; the locator handler covers what remains.
  await dismissProviderSetupDialog(providerSetup, 2_000)
}

/**
 * A scratch DSH has no provider, so it opens the provider-setup dialog at startup; its dismissal button is the user's
 * own way past it. The handler keeps dismissing it if it comes back later in the same page.
 */
export const dismissProviderSetupDuringStartup = async (page: Page, timeoutMs = 5_000): Promise<boolean> => {
  const appeared = await appears(providerSetupDialog(page), timeoutMs)
  if (appeared) {
    const providerSetup = providerSetupDialog(page)
    await dismissProviderSetupDialog(providerSetup, timeoutMs)
    await providerSetup.waitFor({ state: 'hidden', timeout: timeoutMs })
  }
  await registerProviderSetupDismissal(page)
  return appeared
}

/**
 * A reload is a fresh page, so the provider-setup dialog opens again a moment after the app renders. The registered
 * handler dismisses it only once it blocks an action, and that dismissal also closes any menu the action had opened,
 * so the reload waits it out before the next interaction.
 */
export const reloadPastProviderSetup = async (page: Page, timeoutMs = 5_000): Promise<void> => {
  await page.reload()
  if (!(await appears(providerSetupDialog(page), timeoutMs))) return
  const providerSetup = providerSetupDialog(page)
  // The registered handler may dismiss it first, leaving this click no button; either way it must end hidden.
  await dismissProviderSetupDialog(providerSetup, timeoutMs)
  await providerSetup.waitFor({ state: 'hidden', timeout: timeoutMs })
}

/** Isolated profiles without the web profile's settings show DSH's "Preview Notice" once per browser profile. */
const dismissPreviewNotice = async (page: Page, timeoutMs = 5_000): Promise<boolean> => {
  if (!(await appears(previewNoticeDialog(page), timeoutMs))) return false
  const previewNotice = previewNoticeDialog(page)
  await previewNotice.getByRole('button', { name: 'Continue', exact: true }).click()
  await previewNotice.waitFor({ state: 'hidden', timeout: timeoutMs })
  return true
}

export class StartupDialogs {
  static readonly registerProviderSetupDismissal = registerProviderSetupDismissal
  static readonly dismissProviderSetupIfShown = dismissProviderSetupIfShown
  static readonly dismissProviderSetupDuringStartup = dismissProviderSetupDuringStartup
  static readonly reloadPastProviderSetup = reloadPastProviderSetup
  static readonly dismissPreviewNotice = dismissPreviewNotice
}
