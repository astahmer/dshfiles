import type { Page } from '@playwright/test'

const PROVIDER_SETUP_DIALOG = 'Add an API key to get started'
const PREVIEW_NOTICE_DIALOG = 'Preview Notice'

const appears = (page: Page, dialogName: string, timeoutMs: number): Promise<boolean> =>
  page
    .getByRole('dialog', { name: dialogName, exact: true })
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(
      () => true,
      (error: unknown) => {
        if (error instanceof Error && error.name === 'TimeoutError') return false
        throw error
      },
    )

/** Dismiss the "Add an API key" dialog whenever it covers an element this page acts on. */
export const registerProviderSetupDismissal = (page: Page): Promise<void> => {
  const providerSetup = page.getByRole('dialog', { name: PROVIDER_SETUP_DIALOG, exact: true })
  return page.addLocatorHandler(providerSetup, async dialog => {
    await dialog.getByRole('button', { name: 'Configure later', exact: true }).click()
  })
}

/**
 * A scratch DSH has no provider, so it opens "Add an API key" at startup; "Configure later" is the user's own way past
 * it. The handler keeps dismissing it if it comes back later in the same page.
 */
export const dismissProviderSetupDuringStartup = async (page: Page, timeoutMs = 5_000): Promise<boolean> => {
  const appeared = await appears(page, PROVIDER_SETUP_DIALOG, timeoutMs)
  if (appeared) {
    const providerSetup = page.getByRole('dialog', { name: PROVIDER_SETUP_DIALOG, exact: true })
    await providerSetup.getByRole('button', { name: 'Configure later', exact: true }).click()
    await providerSetup.waitFor({ state: 'hidden', timeout: timeoutMs })
  }
  await registerProviderSetupDismissal(page)
  return appeared
}

/** Isolated profiles without the web profile's settings show DSH's "Preview Notice" once per browser profile. */
export const dismissPreviewNotice = async (page: Page, timeoutMs = 5_000): Promise<boolean> => {
  if (!(await appears(page, PREVIEW_NOTICE_DIALOG, timeoutMs))) return false
  const previewNotice = page.getByRole('dialog', { name: PREVIEW_NOTICE_DIALOG, exact: true })
  await previewNotice.getByRole('button', { name: 'Continue', exact: true }).click()
  await previewNotice.waitFor({ state: 'hidden', timeout: timeoutMs })
  return true
}
