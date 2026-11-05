import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const PACKAGE_ID = '@dshfiles/web-fetch-readable'

When('the readable web fetch plugin is opened in the Plugins panel', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Plugins')
  await page.getByRole('button', { name: `View ${PACKAGE_ID}`, exact: true }).click()
})

Then('its fetch provider component is running', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'web-fetch-readable-component-running', async () => {
    const component = page.getByRole('listitem').filter({ hasText: 'dshfiles-web-fetch-readable' })
    await expect(component).toContainText('Running')
    await expect(component.getByRole('switch', { name: `Enable component ${PACKAGE_ID}`, exact: true })).toBeChecked()
  })
  await finishJourneyAssertions(page)
})
