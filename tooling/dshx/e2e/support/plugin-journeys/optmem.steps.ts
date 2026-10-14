import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

When('the OptMem Memory settings section is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Memory (OptMem)', exact: true })).toBeVisible()
})

When('the OptMem Workbench Explorer is opened', async ({ page }: { page: Page }) => {
  const marker = 'dshx-optmem-workbench-e2e-marker'
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions' })
  await composer.fill(marker)
  await composer.press('Enter')
  await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'OptMem', exact: true }).click()
  await expect(page.getByRole('tablist', { name: 'OptMem views' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Explore', exact: true })).toBeVisible()
})

Then('Explore, Context Preview and Pipeline remain separate read-only tabs', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'optmem-explorer-read-only-tabs', async () => {
    const marker = 'dshx-optmem-workbench-e2e-marker'
    const search = page.getByRole('textbox', { name: 'Search project memories' })
    await search.fill(marker)
    const result = page.getByRole('button').filter({ hasText: marker })
    // The message is indexed in the background; under a full serial run that took longer than 30s.
    await expect(result).toBeVisible({ timeout: 60_000 })
    await result.click()
    await expect(page.getByText(marker, { exact: true }).last()).toBeVisible()
    await page.getByRole('tab', { name: 'Context preview', exact: true }).click()
    await expect(page.getByText('Simulated · read-only', { exact: true })).toBeVisible()
    await expect(page.locator('pre').filter({ hasText: marker })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('tab', { name: 'Pipeline', exact: true }).click()
    await expect(page.getByText('Read-only diagnostics · refreshes every 5 seconds', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Explore', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Search project memories' })).toBeVisible()
  })
  await finishJourneyAssertions(page)
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
