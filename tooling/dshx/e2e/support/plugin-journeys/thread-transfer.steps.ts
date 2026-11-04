import { expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

const bundles = new WeakMap<Page, { readonly path: string }>()
const imports = new WeakMap<Page, { readonly title: string; readonly before: number }>()

const runPaletteAction = async (page: Page, query: string, option: RegExp): Promise<void> => {
  await page.keyboard.press('Meta+Shift+P')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill(query)
  await palette.getByRole('option', { name: option }).click()
}

const transferDialog = (page: Page) => page.locator('[data-thread-transfer="dialog"]')

When('the thread is exported from the command palette', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('status').filter({ hasText: /^Completed$/ })).toHaveCount(1, { timeout: 30_000 })
  const download = page.waitForEvent('download', { timeout: 30_000 })
  await runPaletteAction(page, 'export thread', /^Export this thread/u)
  const file = await download
  const path = join(await createScratchDirectory('dshx-thread-transfer-e2e-'), file.suggestedFilename())
  await file.saveAs(path)
  bundles.set(page, { path })
})

Then("a .dshthread bundle downloads with the thread's messages", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'thread-transfer-export-downloads-a-bundle', async () => {
    expect(bundles.get(page)?.path).toMatch(/\.dshthread$/u)
    await expect(transferDialog(page).locator('[data-thread-transfer="exported"]')).toContainText(/Saved .+\.dshthread/u)
    await expect(transferDialog(page).locator('[data-thread-transfer="stats"]')).toContainText(/[1-9]\d* messages/u)
  })
  await transferDialog(page).getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(transferDialog(page)).toBeHidden()
})

When('the bundle is imported from the command palette into the home folder', async ({ page }: { page: Page }) => {
  const bundle = bundles.get(page)
  if (bundle === undefined) throw new Error('No bundle was exported in this scenario.')
  await runPaletteAction(page, 'import thread', /^Import thread/u)
  await transferDialog(page).locator('[data-thread-transfer="file-input"]').setInputFiles(bundle.path)
  const preview = transferDialog(page).locator('[data-thread-transfer="preview"]')
  await expect(preview).toContainText(/messages/u, { timeout: 30_000 })
  // The import adds one more thread row with the bundle's title, whichever sidebar the composition renders.
  const title = (await preview.locator('span').first().textContent())?.trim() ?? ''
  const shown = await page.getByText(title, { exact: true }).count()
  const inDialog = await transferDialog(page).getByText(title, { exact: true }).count()
  imports.set(page, { title, before: shown - inDialog })
  await transferDialog(page).locator('[data-thread-transfer="destination"]').click()
  await page.getByRole('option', { name: 'Home folder', exact: true }).click()
  await transferDialog(page).locator('[data-thread-transfer="import"]').click()
})

Then('a new thread opens with {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'thread-transfer-import-opens-a-new-thread', async () => {
    await expect(transferDialog(page)).toBeHidden({ timeout: 30_000 })
    const imported = imports.get(page)
    if (imported === undefined || imported.title === '') throw new Error('The import preview showed no title.')
    await expect.poll(() => page.getByText(imported.title, { exact: true }).count(), { timeout: 30_000 }).toBeGreaterThan(imported.before)
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

Then('the export journey is complete', async ({ page }: { page: Page }) => {
  await finishJourneyAssertions(page)
})
