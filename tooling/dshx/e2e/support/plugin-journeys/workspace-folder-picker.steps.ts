import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
    await expect(dialog.getByRole('listbox', { name: 'Projects', exact: true })).toHaveCount(0)
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

Then('a unique typed folder path opens without pressing Enter', async ({ page }: { page: Page }) => {
  const dialog = folderPickerDialog(page)
  const homePath = await dialog.locator('p').filter({ hasText: /^\// }).first().textContent()
  if (homePath === null) throw new Error('The Host home directory is not visible.')
  const normalizedHomePath = homePath.trim()
  const pathInput = dialog.getByRole('textbox', { name: 'Enter a folder path' })

  await pathInput.fill('~/s')
  await recordAssertion(page, 'ambiguous-folder-prefix-stays-in-home', async () => {
    await expect(dialog.locator('p').filter({ hasText: normalizedHomePath }).first()).toBeVisible()
    await expect(dialog.getByRole('option', { name: /sessions/ })).toBeVisible()
    await expect(dialog.getByRole('option', { name: /storages/ })).toBeVisible()
  })
  await pathInput.fill('~/pr')
  await recordAssertion(page, 'unique-folder-prefix-auto-browses-without-enter', () =>
    expect(
      dialog
        .locator('p')
        .filter({ hasText: join(normalizedHomePath, 'profiles') })
        .first(),
    ).toBeVisible(),
  )
  await finishJourneyAssertions(page)
})

Then('a typed absolute folder path can be registered without browsing', async ({ page }: { page: Page }) => {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'dsh-folder-picker-e2e-'))
  const workspaceName = 'typed-path-workspace'
  const workspacePath = join(scratchRoot, workspaceName)
  const dialog = folderPickerDialog(page)
  try {
    await mkdir(workspacePath)
    const pathInput = dialog.getByRole('textbox', { name: 'Enter a folder path' })
    await pathInput.fill(workspacePath)
    await recordAssertion(page, 'typed-absolute-path-has-direct-action', () =>
      expect(dialog.getByRole('button', { name: 'Use this folder', exact: true })).toBeVisible(),
    )
    await recordAssertion(page, 'stale-folder-actions-are-hidden', () =>
      expect(dialog.getByRole('button', { name: 'Select this folder', exact: true })).toHaveCount(0),
    )
    await dialog.getByRole('button', { name: 'Use this folder', exact: true }).click()
    await recordAssertion(page, 'direct-path-is-registered-as-workspace', () =>
      expect(page.getByRole('treeitem').filter({ hasText: workspaceName })).toBeVisible(),
    )
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
    await page.getByRole('menuitem', { name: /Add workspace/ }).click()
    await recordAssertion(page, 'add-workspace-flow-can-reopen', () => expect(dialog).toBeVisible())
    await finishJourneyAssertions(page)
  } finally {
    await rm(scratchRoot, { recursive: true, force: true })
  }
})

Then('a local repository can be cloned and registered as a workspace', async ({ page }: { page: Page }) => {
  const scratchRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-folder-picker-clone-')))
  const origin = join(scratchRoot, 'origin')
  const dialog = folderPickerDialog(page)
  try {
    await mkdir(origin)
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', origin])
    await writeFile(join(origin, 'README.md'), '# origin\n')
    execFileSync('git', ['-C', origin, 'add', 'README.md'])
    execFileSync('git', ['-C', origin, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'first'])
    await dialog.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Clone repository…' }).click()
    const cloneDialog = page.getByRole('dialog', { name: 'Clone repository' })
    await recordAssertion(page, 'clone-dialog-opens', () => expect(cloneDialog).toBeVisible())
    await cloneDialog.getByRole('textbox', { name: 'Repository URL' }).fill(`file://${origin}`)
    await recordAssertion(page, 'folder-name-follows-the-url', () => expect(cloneDialog.getByRole('textbox', { name: 'Folder name' })).toHaveValue('origin'))
    await cloneDialog.getByRole('textbox', { name: 'Parent folder' }).fill(scratchRoot)
    await cloneDialog.getByRole('textbox', { name: 'Folder name' }).fill('cloned-project')
    await cloneDialog.getByRole('button', { name: 'Clone', exact: true }).click()
    await recordAssertion(page, 'clone-closes-after-registration', () => expect(cloneDialog).toBeHidden({ timeout: 30_000 }))
    await recordAssertion(page, 'cloned-folder-is-registered-as-workspace', () =>
      expect(page.getByRole('treeitem').filter({ hasText: 'cloned-project' })).toBeVisible(),
    )
    await finishJourneyAssertions(page)
  } finally {
    await rm(scratchRoot, { recursive: true, force: true })
  }
})

Then('a new project can be created and registered as a workspace', async ({ page }: { page: Page }) => {
  const scratchRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-folder-picker-new-')))
  const dialog = folderPickerDialog(page)
  try {
    await dialog.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByRole('menuitem', { name: 'New project…' }).click()
    const createDialog = page.getByRole('dialog', { name: 'New project' })
    await recordAssertion(page, 'new-project-dialog-opens', () => expect(createDialog).toBeVisible())
    await createDialog.getByRole('textbox', { name: 'Parent folder' }).fill(scratchRoot)
    await createDialog.getByRole('textbox', { name: 'Project name' }).fill('fresh-project')
    await createDialog.getByRole('button', { name: 'Create', exact: true }).click()
    await recordAssertion(page, 'new-project-closes-after-registration', () => expect(createDialog).toBeHidden({ timeout: 30_000 }))
    await recordAssertion(page, 'new-project-is-registered-as-workspace', () =>
      expect(page.getByRole('treeitem').filter({ hasText: 'fresh-project' })).toBeVisible(),
    )
    await recordAssertion(page, 'new-project-has-readme-and-jj', async () => {
      expect(await readFile(join(scratchRoot, 'fresh-project', 'README.md'), 'utf8')).toBe('# fresh-project\n')
      await access(join(scratchRoot, 'fresh-project', '.jj'))
    })
    await finishJourneyAssertions(page)
  } finally {
    await rm(scratchRoot, { recursive: true, force: true })
  }
})
