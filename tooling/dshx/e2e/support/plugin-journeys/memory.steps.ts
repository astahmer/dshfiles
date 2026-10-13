import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { openMemoryStore } from '../../../../../plugins/@dshfiles/memory/src/store.ts'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'

Given('memory holds the project note {string}', async ({ page }: { page: Page }, text: string) => {
  // The Host has the same SQLite file open in WAL mode; a second connection writes the note the way memory_note would.
  const store = openMemoryStore({ path: join(profileFor(page).homeRoot, 'plugins', 'memory', 'memory.db') })
  try {
    store.addNote({
      project: '/work/e2e-project',
      text,
      category: 'project',
      scope: 'repo',
      confidence: 'stated',
      sourceThread: null,
      sourceSeq: null,
      origin: 'agent',
    })
  } finally {
    store.close()
  }
})

When('the Memory panel is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(page.getByRole('tablist', { name: 'Memory views' })).toBeVisible()
})

Then('the note {string} is listed under Project', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-panel-lists-note-by-type', async () => {
    await expect(page.getByRole('heading', { name: /^Project/ })).toBeVisible()
    await expect(page.getByText(text, { exact: true })).toBeVisible()
  })
})

Then('editing it to {string} keeps the old text in its history', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-panel-edit-supersedes-note', async () => {
    await expect(page.locator('dl[aria-label="Source of n:1"]')).toContainText('agent note')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('textbox', { name: 'Note text' }).fill(text)
    await page.getByRole('combobox', { name: 'Edit note type' }).selectOption('feedback')
    await page.getByRole('button', { name: 'Save note', exact: true }).click()
    await expect(page.getByRole('heading', { name: /^Feedback/ })).toBeVisible()
    await page.getByRole('button', { name: 'n:2', exact: true }).click()
    const history = page.getByRole('list', { name: 'Note history' })
    await expect(history).toContainText('Deploys need the ops approval label.')
    await expect(history).toContainText('edited in this panel')
  })
})

Then('forgetting it with a reason removes it from the list', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'memory-panel-forget-note', async () => {
    await page.getByRole('complementary', { name: 'Note detail' }).getByRole('button', { name: 'Forget', exact: true }).click()
    await page.getByRole('textbox', { name: 'Reason' }).fill('obsolete after the pipeline change')
    await page.getByRole('button', { name: 'Forget note', exact: true }).click()
    await expect(page.getByText('No notes yet.', { exact: false })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the Usage tab shows the memory counters and the usage per day', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'memory-panel-usage-counters', async () => {
    await page.getByRole('tab', { name: 'Usage', exact: true }).click()
    await expect(page.getByText('Start blocks served', { exact: true })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Memory usage per day' })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
