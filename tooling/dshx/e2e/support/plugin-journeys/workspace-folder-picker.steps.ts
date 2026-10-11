import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const folderPickerDialog = (page: Page) => page.getByRole('dialog', { name: 'Add workspace' })

When('the header workspace Add workspace action is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
  await page.getByRole('menuitem', { name: /Add workspace/ }).click()
})

When('the sidebar Add workspace action is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
})

Then('the picker starts in folder browsing mode without project actions', async ({ page }: { page: Page }) => {
  const dialog = folderPickerDialog(page)
  await recordAssertion(page, 'add-workspace-picker-opens', () => expect(dialog).toBeVisible())
  await recordAssertion(page, 'folder-path-input-is-selected-mode', () => expect(dialog.getByRole('textbox', { name: 'Enter a folder path' })).toBeVisible())
  await recordAssertion(page, 'folder-list-is-rendered', () => expect(dialog.getByRole('listbox', { name: 'Folders' })).toBeVisible())
  await recordAssertion(page, 'host-home-directory-is-listed', () => expect(dialog.locator('p').filter({ hasText: /^\// })).toBeVisible())
  await recordAssertion(page, 'native-chooser-is-not-offered', () => expect(dialog.getByRole('button', { name: 'Browse…' })).toHaveCount(0))
  await recordAssertion(page, 'project-actions-are-not-offered', async () => {
    await expect(dialog.getByText('Register project', { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('listbox', { name: 'Projects and recent folders' })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('a new folder can be created and registered as a workspace', async ({ page }: { page: Page }) => {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'dsh-folder-picker-e2e-'))
  const workspaceName = 'registered-workspace'
  const workspacePath = join(scratchRoot, workspaceName)
  const dialog = folderPickerDialog(page)
  try {
    const pathInput = dialog.getByRole('textbox', { name: 'Enter a folder path' })
    await pathInput.fill(scratchRoot)
    await pathInput.press('Enter')
    await recordAssertion(page, 'scratch-parent-is-opened', () => expect(dialog.locator('p').filter({ hasText: scratchRoot }).first()).toBeVisible())
    await dialog.getByRole('textbox', { name: 'New folder name' }).fill(workspaceName)
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click()
    await recordAssertion(page, 'new-folder-is-created-and-opened', () => expect(dialog.locator('p').filter({ hasText: workspacePath }).first()).toBeVisible())
    await dialog.getByRole('button', { name: 'Select this folder', exact: true }).click()
    await recordAssertion(page, 'folder-picker-closes-after-selection', () => expect(dialog).toBeHidden())
    await recordAssertion(page, 'created-folder-is-registered-as-workspace', () =>
      expect(page.getByRole('treeitem').filter({ hasText: workspaceName })).toBeVisible(),
    )
    await finishJourneyAssertions(page)
  } finally {
    await rm(scratchRoot, { recursive: true, force: true })
  }
})
