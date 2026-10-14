import { expect, type Page } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder } from '../threads.js'

const workspaces = new WeakMap<Page, string>()
const helloSource = 'export const greeting = "hello"\n'
const headSource = 'ref: refs/heads/main\n'

const workspaceFor = (page: Page): string => {
  const workspace = workspaces.get(page)
  if (workspace === undefined) throw new Error('The disposable editor workspace was not created for this scenario.')
  return workspace
}

const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true })
const editorPanel = (page: Page) =>
  page
    .locator('div.dshx-root')
    .filter({ has: page.getByRole('button', { name: 'Toggle file tree', exact: true }) })
    .last()
const editorTab = (page: Page, name: string) => editorPanel(page).getByRole('tab', { name, exact: true })
const saveState = (page: Page) => editorPanel(page).getByText(/^(Saved|Unsaved|New file|Read-only)$/)

const openGoToFile = async (page: Page): Promise<void> => {
  await page.keyboard.press('Meta+Shift+P')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('option', { name: /Go to file/ }).click()
  await expect(paletteDialog(page).getByText('Go to file in this thread’s workspace…', { exact: true })).toBeVisible()
}

/** Monaco keeps its accessible textbox off-screen; typing goes through the rendered lines it does show. */
const appendToActiveFile = async (page: Page, text: string): Promise<void> => {
  await editorPanel(page).locator('[data-editor-surface] .view-lines').click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(text)
}

const saveActiveFile = async (page: Page): Promise<void> => {
  await page.keyboard.press('Meta+s')
}

When('a disposable workspace with source, dependency and version-control files has a thread', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-editor-e2e-')
  const workspace = join(root, 'editor-workspace')
  workspaces.set(page, root)
  await mkdir(join(workspace, 'src'), { recursive: true })
  await mkdir(join(workspace, 'node_modules', 'left-pad'), { recursive: true })
  await mkdir(join(workspace, '.git'), { recursive: true })
  await writeFile(join(workspace, 'src', 'hello.ts'), helloSource)
  await writeFile(join(workspace, 'README.md'), '# Editor workspace\n')
  await writeFile(join(workspace, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')
  await writeFile(join(workspace, '.git', 'HEAD'), headSource)

  await registerWorkspaceFolder(page, workspace)
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  // The New thread composer resets a draft typed while it switches to the just-registered project, so type until it sticks.
  await expect(async () => {
    await composer.fill('editor e2e thread')
    await page.waitForTimeout(400)
    await expect(composer).toHaveText('editor e2e thread', { timeout: 500 })
  }).toPass({ timeout: 15_000 })
  await composer.press('Enter')
  await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('editor e2e thread', { timeout: 45_000 })
})

When('{string} is opened with Go to file', async ({ page }: { page: Page }, fileName: string) => {
  await openGoToFile(page)
  await paletteDialog(page).getByRole('combobox').fill(fileName.replace(/\.\w+$/, ''))
  await paletteDialog(page).getByRole('option', { name: new RegExp(`^${fileName.replace('.', '\\.')}`) }).click()
  await expect(editorTab(page, fileName)).toHaveAttribute('aria-selected', 'true')
})

When('the editor placement is set to {string} in the plugin settings', async ({ page }: { page: Page }, placement: string) => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'View @dshfiles/editor', exact: true }).click()
  await page.getByRole('combobox', { name: 'Editor placement', exact: true }).selectOption({ label: placement })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  // Leaving a global panel can land on the panel shown before it, so the thread is reopened until its view is on screen.
  await expect(async () => {
    await page.getByRole('treeitem', { name: /^editor e2e thread/ }).click()
    await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('editor e2e thread', { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
})

When('a line is appended to {string} and saved', async ({ page }: { page: Page }, fileName: string) => {
  await editorTab(page, fileName).click()
  await appendToActiveFile(page, 'export const saved = true')
  await expect(editorPanel(page).getByLabel('Unsaved changes', { exact: true })).toBeVisible()
  await saveActiveFile(page)
})

When('src\\/hello.ts changes on disk while it has unsaved edits and is saved again', async ({ page }: { page: Page }) => {
  await editorTab(page, 'hello.ts').click()
  await appendToActiveFile(page, '\nexport const mine = true')
  await writeFile(join(workspaceFor(page), 'editor-workspace', 'src', 'hello.ts'), 'export const greeting = "changed by an agent"\n')
  await recordAssertion(page, 'editor-notices-the-external-change', () =>
    expect(editorPanel(page).getByRole('status').filter({ hasText: 'Changed on disk while you were editing.' })).toBeVisible(),
  )
  await saveActiveFile(page)
})

When('the version-control file .git\\/HEAD is edited from the file tree and saved', async ({ page }: { page: Page }) => {
  const tree = editorPanel(page).getByRole('tree', { name: 'Workspace files', exact: true })
  await tree.getByRole('button', { name: '.git', exact: true }).click()
  await tree.getByRole('button', { name: 'HEAD', exact: true }).click()
  await expect(editorTab(page, 'HEAD')).toHaveAttribute('aria-selected', 'true')
  await appendToActiveFile(page, '\ntampered')
  await saveActiveFile(page)
  const approval = page.getByRole('alertdialog', { name: 'Write this file to disk?', exact: true })
  await approval.getByRole('button', { name: 'Save', exact: true }).click()
})

Then('Go to file lists workspace sources but not dependency or version-control files', async ({ page }: { page: Page }) => {
  await openGoToFile(page)
  const query = paletteDialog(page).getByRole('combobox')
  await recordAssertion(page, 'editor-file-index-lists-workspace-sources', async () => {
    await expect(paletteDialog(page).getByRole('option', { name: /^README\.md/ })).toBeVisible()
    await expect(paletteDialog(page).getByRole('option', { name: /^hello\.ts src/ })).toBeVisible()
  })
  await recordAssertion(page, 'editor-file-index-skips-node-modules-and-git', async () => {
    await query.fill('index')
    await expect(paletteDialog(page).getByText('No matches.', { exact: true })).toBeVisible()
    await query.fill('HEAD')
    await expect(paletteDialog(page).getByText('No matches.', { exact: true })).toBeVisible()
  })
  await query.press('Escape')
  await query.press('Escape')
  await expect(paletteDialog(page)).toBeHidden()
})

Then('{string} opens in the {string} editor with its disk content', async ({ page }: { page: Page }, fileName: string, placement: string) => {
  await recordAssertion(page, `editor-opens-in-the-${placement.replaceAll(' ', '-')}`, async () => {
    const workbenchEditor = page.getByRole('region', { name: 'Editor', exact: true })
    if (placement === 'workbench') {
      await expect(page.getByRole('heading', { name: 'Workbench', exact: true })).toBeVisible()
      await expect(workbenchEditor.getByRole('tab', { name: 'Editor' })).toHaveAttribute('aria-selected', 'true')
      return
    }
    await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('editor e2e thread')
    await expect(page.getByRole('tab', { name: 'Editor Close', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(workbenchEditor).toHaveCount(0)
  })
  await recordAssertion(page, `editor-shows-${fileName.replaceAll('.', '-').toLowerCase()}-from-disk`, async () => {
    await expect(editorPanel(page).locator('[data-editor-surface] .view-lines')).toContainText(fileName === 'hello.ts' ? 'export const greeting' : 'Editor workspace')
    await expect(saveState(page)).toHaveText('Saved')
  })
})

Then('the first save asks for approval and writes the edit to disk', async ({ page }: { page: Page }) => {
  const approval = page.getByRole('alertdialog', { name: 'Write this file to disk?', exact: true })
  await recordAssertion(page, 'editor-first-save-asks-for-approval', () => expect(approval).toContainText('src/hello.ts'))
  await approval.getByRole('button', { name: 'Save', exact: true }).click()
  await recordAssertion(page, 'editor-save-writes-the-buffer', async () => {
    await expect(saveState(page)).toHaveText('Saved')
    await expect(editorPanel(page).getByLabel('Unsaved changes', { exact: true })).toHaveCount(0)
    await expect
      .poll(() => readFile(join(workspaceFor(page), 'editor-workspace', 'src', 'hello.ts'), 'utf8'))
      .toBe(`${helloSource}export const saved = true`)
  })
})

Then('the editor reports the conflict and overwrites only when asked', async ({ page }: { page: Page }) => {
  const filePath = join(workspaceFor(page), 'editor-workspace', 'src', 'hello.ts')
  const conflict = page.getByRole('alertdialog', { name: 'File changed on disk', exact: true })
  await recordAssertion(page, 'editor-stale-save-is-a-conflict', async () => {
    await expect(conflict).toBeVisible()
    expect(await readFile(filePath, 'utf8')).toBe('export const greeting = "changed by an agent"\n')
  })
  await conflict.getByRole('button', { name: 'Overwrite', exact: true }).click()
  await recordAssertion(page, 'editor-explicit-overwrite-writes-the-buffer', async () => {
    await expect(saveState(page)).toHaveText('Saved')
    await expect.poll(() => readFile(filePath, 'utf8')).toBe(`${helloSource}export const saved = true\nexport const mine = true`)
  })
})

Then('the save is refused with the Host reason and the file is unchanged', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'editor-refuses-version-control-writes', async () => {
    await expect(editorPanel(page).getByText('Version-control internals are not editable.', { exact: true })).toBeVisible()
    await expect(saveState(page)).toHaveText('Unsaved')
    expect(await readFile(join(workspaceFor(page), 'editor-workspace', '.git', 'HEAD'), 'utf8')).toBe(headSource)
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const root = workspaces.get(page)
  if (root === undefined) return
  workspaces.delete(page)
  await rm(root, { recursive: true, force: true })
})
