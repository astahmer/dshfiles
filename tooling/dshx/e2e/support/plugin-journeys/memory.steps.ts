import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { openMemoryStore } from '../../../../../plugins/@dshfiles/memory/src/store.ts'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { sendMessage, startThreadWithModel } from '../threads.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'

const addMemoryNote = (options: { readonly page: Page; readonly text: string; readonly category: 'project' | 'feedback' }): void => {
  // The Host has the same SQLite file open in WAL mode; a second connection writes the note the way memory_note would.
  const store = openMemoryStore({ path: join(profileFor(options.page).homeRoot, 'plugins', 'memory', 'memory.db') })
  try {
    store.addNote({
      project: '/work/e2e-project',
      text: options.text,
      category: options.category,
      scope: 'repo',
      confidence: 'stated',
      sourceThread: null,
      sourceSeq: null,
      origin: 'agent',
    })
  } finally {
    store.close()
  }
}

Given('memory holds the project note {string}', async ({ page }: { page: Page }, text: string) => {
  addMemoryNote({ page, text, category: 'project' })
})

Given('memory holds the feedback note {string}', async ({ page }: { page: Page }, text: string) => {
  addMemoryNote({ page, text, category: 'feedback' })
})

When('the Memory panel is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(page.getByRole('tablist', { name: 'Memory views' })).toBeVisible()
})

When('the Add memory dialog is given the project path {string} and the note {string}', async ({ page }: { page: Page }, project: string, text: string) => {
  await page.getByRole('button', { name: 'Add memory', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a memory', exact: true })
  // A profile memory has no project for yet has no list to choose from: the path is typed instead.
  await dialog.getByRole('textbox', { name: 'New note project path', exact: true }).fill(project)
  await dialog.getByRole('textbox', { name: 'New note text', exact: true }).fill(text)
  await dialog.getByRole('button', { name: 'Add memory', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('a thread on the fake model cites memory {string}', async ({ page }: { page: Page }, id: string) => {
  // A provider-less profile ends the first turn immediately, and the client then drops the conversation for the New
  // thread screen — taking the citation, and with it this journey's subject, out of the DOM. Run a real turn on the
  // local fake provider and wait for it to settle, so the citation outlives the step that reads it.
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, `memory: ${id}`)
})

Given(
  'memory holds a digest of thread {string} titled {string} saying {string}',
  async ({ page }: { page: Page }, id: string, title: string, digest: string) => {
    const store = openMemoryStore({ path: join(profileFor(page).homeRoot, 'plugins', 'memory', 'memory.db') })
    try {
      store.putThread({
        id,
        project: '/work/e2e-project',
        parent: null,
        title,
        decision: 'Ship the release notes with the canary switch on.',
        digest,
        source: 'trail',
        lastSeq: 8,
        updatedAt: Date.now(),
      })
    } finally {
      store.close()
    }
  },
)

const openReference = async (page: Page, id: string, range?: string): Promise<void> => {
  const name = `Preview memory ${id}${range === undefined ? '' : ` #${range}`}`
  const reference = page.getByRole('link', { name, exact: true }).last()
  await expect(reference).toBeVisible()
  const preview = page.locator('[data-dshfiles-memory-preview]')
  await expect(async () => {
    if ((await preview.count()) === 0) await reference.click()
    await expect(preview).toBeVisible({ timeout: 1_500 })
  }).toPass({ timeout: 30_000 })
}

Then('the inline digest preview shows {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-reference-digest-preview', async () => {
    await openReference(page, 't:session-e2e-digest')
    const preview = page.locator('[data-dshfiles-memory-preview]')
    await expect(preview.getByText('Thread digest', { exact: true })).toBeVisible()
    await expect(preview.locator('[data-dshfiles-memory-title]')).toHaveText('Ship the release notes')
    await expect(preview.getByText(text, { exact: true })).toBeVisible()
    await expect(preview.getByText('Source & evidence', { exact: true })).toBeVisible()
    await expect(preview.getByRole('button', { name: 'Open thread', exact: true })).toBeVisible()
    await expect(preview.locator('code').first()).toHaveText('t:session-e2e-digest')
  })
})

Then('the inline excerpt preview shows {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-reference-excerpt-preview', async () => {
    await openReference(page, 't:session-e2e-digest', '1')
    const preview = page.locator('[data-dshfiles-memory-preview]')
    await expect(preview.getByText('Thread excerpt', { exact: true })).toBeVisible()
    const excerpt = preview.locator('[data-dshfiles-memory-body]')
    await expect(excerpt).toContainText(text)
    const previewSize = await preview.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height }
    })
    expect(previewSize.width).toBeLessThanOrEqual(560)
    expect(previewSize.height).toBeLessThanOrEqual(480)
    // The excerpt keeps raw log lines as a bounded monospace block, not prose.
    const fontFamily = await excerpt.evaluate(element => getComputedStyle(element).fontFamily)
    expect(fontFamily.toLowerCase()).toContain('mono')
    await expect(preview.locator('code').first()).toHaveText('t:session-e2e-digest #1')
  })
  await finishJourneyAssertions(page)
})

Then('the inline memory preview shows {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-reference-inline-preview', async () => {
    await page.setViewportSize({ width: 1986, height: 736 })
    const reference = page.locator('[data-dshfiles-memory-reference="n:1"]')
    await expect(reference).toBeVisible()
    const preview = page.locator('[data-dshfiles-memory-preview]')
    // A scroll closes the card by design, and the conversation can still settle right after the turn lands, so ask
    // again rather than reading a card the page itself just took away.
    await expect(async () => {
      if ((await preview.count()) === 0) await reference.click()
      await expect(preview).toContainText(text, { timeout: 1_500 })
    }).toPass({ timeout: 30_000 })
    // The card mirrors the panel's note detail: tone and status badges, the note as its title, sections.
    await expect(preview.getByText('Correction', { exact: true }).first()).toBeVisible()
    await expect(preview.getByText('This is a correction', { exact: true })).toHaveCount(0)
    await expect(preview.getByText('Active', { exact: true }).first()).toBeVisible()
    const previewHeaderHeight = await preview.locator('[data-dshfiles-memory-preview-header]').evaluate(element => element.getBoundingClientRect().height)
    expect(previewHeaderHeight).toBeLessThanOrEqual(48)
    await expect(preview.getByText('Source & evidence', { exact: true })).toBeVisible()
    await expect(preview.getByText('Metadata', { exact: true })).toBeVisible()
    await expect(preview.getByText('repo', { exact: true }).first()).toBeVisible()
    await expect(preview.locator('code').first()).toHaveText('n:1')
    const previewTitle = preview.locator('[data-dshfiles-memory-title]').first()
    await expect(previewTitle).toHaveText(text)
    const fontSize = await previewTitle.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(15)
    const previewWidth = await preview.evaluate(element => element.getBoundingClientRect().width)
    const previewHeight = await preview.evaluate(element => element.getBoundingClientRect().height)
    expect(previewWidth).toBeLessThanOrEqual(432)
    expect(previewHeight).toBeLessThanOrEqual(480)
    for (const viewportWidth of [360, 480, 768, 1024]) {
      await page.setViewportSize({ width: viewportWidth, height: 736 })
      const responsivePreviewSize = await preview.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return { width: bounds.width, height: bounds.height }
      })
      expect(responsivePreviewSize.width).toBeLessThanOrEqual(Math.min(416, viewportWidth - 16))
      expect(responsivePreviewSize.height).toBeLessThanOrEqual(480)
      const responsiveHeaderHeight = await preview.locator('[data-dshfiles-memory-preview-header]').evaluate(element => element.getBoundingClientRect().height)
      expect(responsiveHeaderHeight).toBeLessThanOrEqual(48)
    }
    await page.setViewportSize({ width: 1986, height: 736 })
    await expect(preview.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled()
    await expect(preview.getByRole('tab', { name: 'Related', exact: true })).toBeVisible()
  })
})

Then('opening the preview in Memory focuses {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'memory-reference-open-in-memory', async () => {
    const preview = page.locator('[data-dshfiles-memory-preview]')
    await preview.getByRole('button', { name: 'Open in Memory', exact: true }).click()
    const memoryPanel = page.locator('main.dshx-root:visible')
    await expect(memoryPanel.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible()
    await expect(memoryPanel.getByText(text, { exact: true }).first()).toBeVisible()
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
