import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { openMemoryStore } from '../../../../../plugins/@dshfiles/memory/src/store.ts'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { sendMessage, startThreadWithModel } from '../threads.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'

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

When('a thread on the fake model cites memory {string}', async ({ page }: { page: Page }, id: string) => {
  // A provider-less profile ends the first turn immediately, and the client then drops the conversation for the New
  // thread screen — taking the citation, and with it this journey's subject, out of the DOM. Run a real turn on the
  // local fake provider and wait for it to settle, so the citation outlives the step that reads it.
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, `memory: ${id}`)
})

Then('the inline memory preview shows {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-reference-inline-preview', async () => {
    const reference = page.locator('[data-dshfiles-memory-reference="n:1"]')
    await expect(reference).toBeVisible()
    const preview = page.locator('[data-dshfiles-memory-preview]')
    // A scroll closes the card by design, and the conversation can still settle right after the turn lands, so ask
    // again rather than reading a card the page itself just took away.
    await expect(async () => {
      if ((await preview.count()) === 0) await reference.click()
      await expect(preview).toContainText(text, { timeout: 1_500 })
    }).toPass({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

Then('the note {string} is listed in the Notes tab', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-panel-lists-note', async () => {
    await expect(page.locator('main.dshx-root:visible').getByText(text, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Decision', { exact: true }).first()).toBeVisible()
  })
})

Then('editing it to {string} keeps the old text in its history', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-panel-edit-supersedes-note', async () => {
    await page.getByText('Deploys need the ops approval label.', { exact: true }).click()
    await expect(page.getByLabel('Source and evidence')).toContainText('agent note')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('textbox', { name: 'Note text' }).fill(text)
    await page.getByRole('combobox', { name: 'Edit note type' }).click()
    await page.getByRole('option', { name: 'Correction', exact: true }).click()
    await page.getByRole('button', { name: 'Save note', exact: true }).click()
    await expect(page.locator('main.dshx-root:visible').getByText(text, { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: 'n:2', exact: true }).click()
    const history = page.getByRole('list', { name: 'Note history' })
    await expect(history).toContainText('Deploys need the ops approval label.')
    await expect(history).toContainText('edited in this panel')
  })
})

Then('forgetting it with a reason removes it from the list', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'memory-panel-forget-note', async () => {
    const detail = page.getByRole('complementary', { name: 'Note detail' })
    await detail.getByRole('button', { name: 'Forget', exact: true }).click()
    await page.getByRole('textbox', { name: 'Reason' }).fill('obsolete after the pipeline change')
    await page.getByRole('button', { name: 'Forget note', exact: true }).click()
    await expect(page.locator('main.dshx-root:visible').getByText('No notes yet.', { exact: false })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('selection mode is on', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Select notes', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Select all visible notes', exact: true })).toBeVisible()
})

When('two visible notes are selected', async ({ page }: { page: Page }) => {
  await page.getByRole('checkbox', { name: 'Select n:1', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Select n:2', exact: true }).check()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
})

Then('forgetting the selection after confirmation empties the list', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'memory-panel-batch-forget-notes', async () => {
    await page.getByRole('button', { name: 'Forget selected', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Forget 2 selected notes?')
    await dialog.getByRole('textbox', { name: 'Reason for forgetting', exact: true }).fill('obsolete after the pipeline change')
    await dialog.getByRole('button', { name: 'Forget 2 notes', exact: true }).click()
    await expect(page.locator('main.dshx-root:visible').getByText('No notes yet.', { exact: false })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the Analytics tab shows the memory counters and the activity charts', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'memory-panel-analytics', async () => {
    await page.getByRole('tab', { name: 'Analytics', exact: true }).click()
    // DSH keeps an inactive main-panel copy mounted; scope every assertion to the visible page and its active tab.
    const view = page.locator('main.dshx-root:visible [data-slot="tabs-content"][data-state="active"]')
    await expect(view).toContainText('Digest calls')
    await expect(view).toContainText('Digest activity')
    await expect(view).toContainText('Recall')
    await expect(view).toContainText('Recent events')
  })
  await finishJourneyAssertions(page)
})
