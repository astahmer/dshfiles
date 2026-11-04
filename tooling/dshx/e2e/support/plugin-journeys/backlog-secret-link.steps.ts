import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

/** The fake secret CLI seeds GITHUB_TOKEN globally with this synthetic value (secret-catalog.steps.ts). */
const syntheticValues: Readonly<Record<string, string>> = { GITHUB_TOKEN: 'gh-e2e-global-value' }

const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })
const secretRow = (page: Page, alias: string) =>
  peek(page)
    .getByRole('listitem')
    .filter({ hasText: `secret:${alias}` })
const valueOf = (alias: string): string => {
  const value = syntheticValues[alias]
  if (value === undefined) throw new Error(`No synthetic value is seeded for ${alias}.`)
  return value
}

Then('the secret link {string} stays masked until revealed', async ({ page }: { page: Page }, alias: string) => {
  await recordAssertion(page, 'backlog-secret-link-masked', async () => {
    await expect(secretRow(page, alias).getByRole('button', { name: `Reveal ${alias}`, exact: true })).toBeVisible()
    await expect(peek(page)).not.toContainText(valueOf(alias))
  })
})

When('the secret link {string} is revealed', async ({ page }: { page: Page }, alias: string) => {
  await secretRow(page, alias)
    .getByRole('button', { name: `Reveal ${alias}`, exact: true })
    .click()
})

Then('the item detail shows the value of {string}', async ({ page }: { page: Page }, alias: string) => {
  await recordAssertion(page, 'backlog-secret-link-revealed', async () => {
    await expect(secretRow(page, alias).getByRole('status', { name: `Value of ${alias}` })).toHaveText(valueOf(alias))
  })
})

When('the revealed secret {string} is hidden', async ({ page }: { page: Page }, alias: string) => {
  await secretRow(page, alias)
    .getByRole('button', { name: `Hide ${alias}`, exact: true })
    .click()
})

Then('the item detail no longer shows the value of {string}', async ({ page }: { page: Page }, alias: string) => {
  await recordAssertion(page, 'backlog-secret-link-hidden', async () => {
    await expect(peek(page)).not.toContainText(valueOf(alias))
    await expect(secretRow(page, alias).getByRole('button', { name: `Reveal ${alias}`, exact: true })).toBeVisible()
  })
})

Then('the secret link {string} offers the Secret Catalog instead of a value', async ({ page }: { page: Page }, alias: string) => {
  await recordAssertion(page, 'backlog-secret-link-missing', async () => {
    const row = secretRow(page, alias)
    await expect(row.getByTestId('secret-link-reveal-missing')).toBeVisible()
    await expect(row.getByRole('button', { name: `Reveal ${alias}`, exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
