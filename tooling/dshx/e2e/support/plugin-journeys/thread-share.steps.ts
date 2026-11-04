import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'

const ANSWER = 'Answered for the share link'

const links = new WeakMap<Page, string>()

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })

const openThreadSharing = async (page: Page) => {
  await openSettingsDialog(page)
  const dialog = settingsDialog(page)
  await dialog.getByRole('button', { name: 'Thread sharing', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Thread sharing', exact: true })).toBeVisible()
  return dialog
}

const linkOf = (page: Page): string => {
  const link = links.get(page)
  if (link === undefined) throw new Error('No share link was created in this scenario.')
  return link
}

When('a live share link for that thread is created in the Thread sharing settings', async ({ page }: { page: Page }) => {
  const dialog = await openThreadSharing(page)
  await dialog.getByRole('combobox', { name: /^Thread/ }).click()
  // The newest thread is listed first: the one this scenario just ran.
  await page.getByRole('option').first().click()
  await dialog.getByRole('button', { name: 'Create share link', exact: true }).click()
  const code = dialog.locator('code', { hasText: '/thread-share/s/dshs_' }).first()
  await expect(code).toBeVisible({ timeout: 30_000 })
  const link = await code.textContent()
  if (link === null) throw new Error('The settings did not show the new share link.')
  links.set(page, link)
  await recordAssertion(page, 'thread-share-link-shown-once', async () => {
    await expect(dialog.getByText('Copy the link now: DSH keeps only its hash and cannot show it again.')).toBeVisible()
    await expect(dialog.getByRole('table')).toContainText('Anyone with link')
  })
})

Then('a client without the DSH cookie reads only that thread on the share link', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-share-page-without-cookie', async () => {
    const response = await fetch(linkOf(page))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    const html = await response.text()
    expect(html).toContain(ANSWER)
    expect(html).not.toMatch(/<script/i)
    const guessed = await fetch(linkOf(page).replace(/dshs_[\w-]+$/, `dshs_${'A'.repeat(43)}`))
    expect(guessed.status).toBe(404)
  })
})

When('the share is revoked in the Thread sharing settings', async ({ page }: { page: Page }) => {
  const dialog = settingsDialog(page)
  await dialog
    .getByRole('button', { name: /^Revoke share of / })
    .first()
    .click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke share', exact: true }).click()
  await expect(dialog.getByText('No active shares. Create one above.')).toBeVisible({ timeout: 30_000 })
})

Then('the share link no longer opens', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-share-revoked-link-404', async () => {
    const response = await fetch(linkOf(page))
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain(ANSWER)
  })
  await finishJourneyAssertions(page)
})
