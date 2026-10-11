import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const reasoningEffort = (page: Page) => page.getByRole('region', { name: 'Reasoning effort', exact: true })

When('the composer model picker is searched for an unavailable model', async ({ page }: { page: Page }) => {
  const trigger = page.locator('[data-model-picker-text]')
  await expect(trigger).toBeVisible()
  await trigger.click()

  const search = page.getByRole('textbox', { name: 'Search models and providers', exact: true })
  await expect(search).toBeVisible()
  await search.fill('zz-no-provider-model-83914')
  await expect(page.getByText('No matching models.', { exact: true })).toBeVisible()
})

Then('the picker shows an empty result and asks for a model before reasoning can change', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'model-picker-empty-search-keeps-reasoning-unavailable', async () => {
    const effort = reasoningEffort(page)
    await expect(effort.getByText('Select a model to see its reasoning controls.', { exact: true })).toBeVisible()
    await expect(effort.getByRole('slider', { name: 'Reasoning effort', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
