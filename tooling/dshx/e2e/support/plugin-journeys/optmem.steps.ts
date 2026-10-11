import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

When('the OptMem Memory settings section is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Memory (OptMem)', exact: true })).toBeVisible()
})

Then('summarization can be paused and resumed from the settings panel', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'optmem-settings-panel-pause-resume', async () => {
    const pause = page.getByRole('button', { name: 'Pause summaries', exact: true })
    await expect(pause).toBeEnabled()
    await pause.click()
    const resume = page.getByRole('button', { name: 'Resume summaries', exact: true })
    await expect(resume).toBeVisible()
    await resume.click()
    await expect(pause).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
