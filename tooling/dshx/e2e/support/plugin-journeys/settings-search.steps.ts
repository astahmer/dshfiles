import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const settingsPageSearch = (page: Page) => page.getByRole('main').getByRole('searchbox', { name: 'Search settings' })
const maxResultsEditor = (page: Page) => page.getByRole('main').getByLabel('Current value')

When('the Settings Search section is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(settingsPageSearch(page)).toBeVisible()
})

When('Settings are searched for {string}', async ({ page }: { page: Page }, settingName: string) => {
  await settingsPageSearch(page).fill(settingName)
})

When('the maxResults setting is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: /maxResults/ }).first().click()
})

Then('the settings index shows the maxResults setting', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-index-shows-max-results', () =>
    expect(page.getByRole('button', { name: /maxResults/ }).first()).toBeVisible(),
  )
  await finishJourneyAssertions(page)
})

Then('a valid numeric value can be saved and its inherited value restored', async ({ page }: { page: Page }) => {
  const editor = maxResultsEditor(page)
  await recordAssertion(page, 'max-results-editor-starts-with-inherited-default', async () => {
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue('30')
    await expect(page.getByText('Inherited value')).toBeVisible()
  })

  await editor.fill('37')
  await page.getByRole('button', { name: 'Save setting', exact: true }).click()
  await recordAssertion(page, 'max-results-valid-number-is-saved', async () => {
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible()
    await expect(editor).toHaveValue('37')
    await expect(page.getByText('Custom value')).toBeVisible()
  })

  await page.getByRole('button', { name: 'Restore inherited value', exact: true }).click()
  await recordAssertion(page, 'max-results-inherited-default-is-restored', async () => {
    await expect(page.getByRole('status').filter({ hasText: 'Restored the inherited value.' })).toBeVisible()
    await expect(editor).toHaveValue('30')
    await expect(page.getByText('Inherited value')).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
