import { expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const warning = (page: Page) => page.locator('[data-ai-accounts-idle-cache]')

When('the fake model answers in a fresh workspace whose prompt cache lasts one minute', async ({ page }: { page: Page }) => {
  const settings = await connectDshxApi({ url: profileFor(page).url, packageId: '@dshfiles/settings-shell', apiId: 'settings-shell', version: 1 })
  await settings('set', { namespace: 'ai-accounts', patch: { idleCacheWarning: true, promptCacheMinutes: { 'commandcode_work/*': 1 }, idleCacheMinTokens: 0 } })
  const root = await createScratchDirectory('dshx-ai-accounts-idle-cache-')
  const workspace = join(root, 'idle-cache')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'idle-cache', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill('Summarize the pricing module')
  await composer.press('Enter')
  await expect(page.getByText(/^Completed in /)).toBeVisible({ timeout: 60_000 })
  await expect(warning(page)).toHaveCount(0)
})

Then('once the thread sat idle past that minute the meter line warns that the next send re-sends the prompt uncached', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-idle-cache-warning-visible', async () => {
    await expect(warning(page)).toHaveText(/^cache expired · /, { timeout: 120_000 })
    await warning(page).click()
    const popover = page.getByRole('dialog').filter({ hasText: "past the prompt cache's 1 min, from settings" })
    await expect(popover).toBeVisible()
    for (const name of ['Compact first', 'New thread with a reference', 'Send anyway'])
      await expect(popover.getByRole('button', { name, exact: true })).toBeVisible()
  })
})

Then('Send anyway hides the warning until the next request', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Send anyway', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-idle-cache-send-anyway', async () => {
    await expect(warning(page)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
