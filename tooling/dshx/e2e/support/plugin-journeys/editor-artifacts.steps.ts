import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { Before, When, Then } from '../bdd.js'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { finishJourneyAssertions, recordAssertion, restartScratchProfileInBrowser } from '../steps.js'
import { registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const title = 'Journey artifact'
const threadTitle = 'Journey artifact thread'
const initialContent = 'Artifact from the agent'
const editedContent = 'Artifact edited in the workbench'
const composerName = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/

// The artifact journey boots twice (one Host restart) and edits two Monaco buffers, so it exceeds the default budget.
Before({ tags: '@scenario:editor.thread-artifacts' }, () => test.setTimeout(330_000))

const openArtifacts = async (page: Page): Promise<void> => {
  const pane = page.locator('[data-workbench-region="main"]').first()
  const existing = pane.getByRole('tab', { name: 'Artifacts', exact: true })
  if ((await existing.count()) === 0) {
    await pane.getByRole('button', { name: 'New tab', exact: true }).first().click()
    const chooser = pane.getByRole('region', { name: 'Choose a view', exact: true }).filter({ visible: true })
    await chooser.getByRole('button', { name: 'Artifacts', exact: true }).click()
  }
  await pane.getByRole('tab', { name: 'Artifacts', exact: true }).first().click()
}

When('the fake model creates a thread artifact', async ({ page }: { page: Page }) => {
  await registerWorkspaceFolder(page, join(DSHFILES_ROOT, 'plugins/@dshfiles/editor'))
  await startThreadWithModel(page, { project: 'editor', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: composerName })
  await composer.fill(`[[title ${threadTitle}]] [[call artifact_create ${JSON.stringify({ title, mimeType: 'text/markdown', content: initialContent })}]]`)
  await composer.press('Enter')
  await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/^Completed in /).last()).toBeVisible()
})

Then('the artifact can be opened and edited in the workbench', async ({ page }: { page: Page }) => {
  await openArtifacts(page)
  await page.getByRole('button', { name: title, exact: true }).click()
  const content = page.getByLabel('Artifact content', { exact: true })
  await expect(content.locator('.view-lines')).toContainText(initialContent)
  await content.locator('.view-lines').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(editedContent)
  await expect(content.locator('.view-lines')).toContainText(editedContent)
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toBeDisabled({ timeout: 15_000 })
  // Read the stored document back through Reload so a Host restart is not what proves the save landed.
  // b:ysaj: Reload and Delete are in the editor's ⋯.
  await page.getByRole('button', { name: 'More artifact actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reload', exact: true }).click()
  const confirmReload = page.getByRole('alertdialog', { name: 'Reload artifact?', exact: true })
  await confirmReload.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(content.locator('.view-lines')).toContainText(editedContent)
})

Then('the saved artifact can be reopened after a Host restart', async ({ page }: { page: Page }) => {
  await restartScratchProfileInBrowser(page)
  const threadRow = page
    .getByRole('treeitem', { name: new RegExp(threadTitle, 'u') })
    .or(page.getByRole('button', { name: new RegExp(threadTitle, 'u') }))
    .first()
  await expect(threadRow).toBeVisible({ timeout: 30_000 })
  await threadRow.click()
  await openArtifacts(page)
  await recordAssertion(page, 'artifact-edit-survives-host-restart', async () => {
    await page.getByRole('button', { name: title, exact: true }).click()
    await expect(page.getByLabel('Artifact content', { exact: true }).locator('.view-lines')).toContainText(editedContent)
  })
})

Then('the artifact can be deleted from the thread', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'More artifact actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog', { name: 'Delete artifact?', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click()
  await recordAssertion(page, 'artifact-deletion-survives-reload', async () => {
    await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0)
    await page.reload()
    await openArtifacts(page)
    await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0)
  })
})

Then('a new Markdown artifact can be created and saved in the workbench', async ({ page }: { page: Page }) => {
  // b:ysaj: one New ▾ with the kinds in a menu.
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Artifact title', exact: true }).fill('Created in workbench.md')
  await page.getByLabel('Artifact content', { exact: true }).locator('.view-lines').click()
  await page.keyboard.type('Created in the UI')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.reload()
  await openArtifacts(page)
  await recordAssertion(page, 'artifact-created-in-workbench-survives-reload', async () => {
    await page.getByRole('button', { name: 'Created in workbench.md', exact: true }).click()
    await expect(page.getByLabel('Artifact content', { exact: true }).locator('.view-lines')).toContainText('Created in the UI')
  })
  await finishJourneyAssertions(page)
})
