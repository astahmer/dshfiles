import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const workspaceMenuTrigger = (page: Page) => page.getByRole('button').filter({ hasText: 'dshfiles' }).first()
const folderPickerDialog = (page: Page) => page.getByRole('dialog', { name: 'Add workspace' })

When('the workspace Add workspace action is opened', async ({ page }: { page: Page }) => {
  await workspaceMenuTrigger(page).click()
  await page.getByText(/Add workspace/).click()
})

Then('the picker starts in folder browsing mode without project actions', async ({ page }: { page: Page }) => {
  const dialog = folderPickerDialog(page)
  await recordAssertion(page, 'add-workspace-picker-opens', () => expect(dialog).toBeVisible())
  await recordAssertion(page, 'folder-path-input-is-selected-mode', () => expect(dialog.getByRole('textbox', { name: 'Enter a folder path' })).toBeVisible())
  await recordAssertion(page, 'folder-list-is-rendered', () => expect(dialog.getByRole('listbox', { name: 'Folders' })).toBeVisible())
  await recordAssertion(page, 'project-actions-are-not-offered', async () => {
    await expect(dialog.getByText('Register project', { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('listbox', { name: 'Projects and recent folders' })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})
