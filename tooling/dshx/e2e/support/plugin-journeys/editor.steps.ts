import { expect, type Page } from '@playwright/test'
import { openGlobalPanel } from '../plugin-view-names.js'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import type {} from '../../../packages/dshx/src/client/broker.js'
import type { SessionScreenService } from '../../../packages/dshx/src/client/app-services.js'
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
  await paletteDialog(page)
    .getByRole('option', { name: /Go to file/ })
    .click()
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
  await paletteDialog(page)
    .getByRole('combobox')
    .fill(fileName.replace(/\.\w+$/, ''))
  await paletteDialog(page)
    .getByRole('option', { name: new RegExp(`^${fileName.replace('.', '\\.')}`) })
    .click()
  await expect(editorTab(page, fileName)).toHaveAttribute('aria-selected', 'true')
})

When('the editor placement is set to {string} in the plugin settings', async ({ page }: { page: Page }, placement: string) => {
  await openGlobalPanel(page, 'Plugins')
  await page.getByRole('button', { name: 'View @dshfiles/editor', exact: true }).click()
  const placementField = page.getByRole('combobox', { name: 'Editor placement', exact: true })
  // A right-panel editor shows its own Save; take the one of the form that holds the placement field.
  const saveSettings = page
    .locator('*')
    .filter({ has: placementField })
    .filter({ has: page.getByRole('button', { name: 'Save', exact: true }) })
    .last()
    .getByRole('button', { name: 'Save', exact: true })
  await placementField.selectOption({ label: placement })
  await saveSettings.click()
  await expect(saveSettings).toBeDisabled()
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
    const workbenchEditor = page.getByRole('region', { name: 'Editor: Files', exact: true })
    if (placement === 'workbench') {
      const pane = page.locator('[data-workbench-region="main"]').first()
      await expect(pane).toBeVisible()
      await expect(workbenchEditor.getByRole('tab', { name: 'Editor: Files', exact: true })).toHaveAttribute('aria-selected', 'true')
      // File browsing belongs to Editor; the shared chooser offers no duplicate Explorer.
      await pane.getByRole('button', { name: 'New tab', exact: true }).first().click()
      const chooser = pane.getByRole('region', { name: 'Choose a view', exact: true }).filter({ visible: true })
      await expect(chooser).toBeVisible()
      await expect(chooser.getByRole('button', { name: 'Explorer', exact: true })).toHaveCount(0)
      await pane
        .getByRole('tab', { name: 'New tab', exact: true })
        .filter({ has: page.locator('[aria-label="Close New tab"]') })
        .last()
        .getByRole('button', { name: 'Close New tab', exact: true })
        .click()
      return
    }
    await expect(page.getByRole('navigation', { name: 'Session hierarchy', exact: true })).toContainText('editor e2e thread')
    // The owned right sidebar names its tab after the view; its Close control is a separate button.
    await expect(page.getByRole('tab', { name: 'Editor', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(workbenchEditor).toHaveCount(0)
  })
  await recordAssertion(page, `editor-shows-${fileName.replaceAll('.', '-').toLowerCase()}-from-disk`, async () => {
    await expect(editorPanel(page).locator('[data-editor-surface] .view-lines')).toContainText(
      fileName === 'hello.ts' ? 'export const greeting' : 'Editor workspace',
    )
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
    await expect.poll(() => readFile(join(workspaceFor(page), 'editor-workspace', 'src', 'hello.ts'), 'utf8')).toBe(`${helloSource}export const saved = true`)
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

const sessionScreen = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => globalThis.__dshxBrokerV1?.contracts.get('dshx.session-screen')?.live.status === 'active')
}

Then('SessionScreen indexes {string} and {string} for the mounted session', async ({ page }: { page: Page }, first: string, second: string) => {
  await sessionScreen(page)
  await recordAssertion(page, 'session-screen-index-is-ready', async () => {
    const index = await page.evaluate(
      () =>
        new Promise<{ readonly mounted: string | undefined; readonly sessionId: string; readonly files: readonly string[] } | undefined>(resolve => {
          const live = globalThis.__dshxBrokerV1?.contracts.get('dshx.session-screen')?.live
          if (live?.status !== 'active') return resolve(undefined)
          // SAFETY: the broker stores contract values untyped; `dshx.session-screen` is only ever provided with a SessionScreenService.
          const screen = live.value as SessionScreenService
          let done = false
          const settle = (): void => {
            const state = screen.files.index.get()
            if (done || state.status !== 'ready') return
            done = true
            resolve({ mounted: screen.mounted.get(), sessionId: state.sessionId, files: state.files })
          }
          // Subscribing starts the walk and may publish synchronously, so the unsubscribe waits for the answer.
          const stop = screen.files.index.subscribe(settle)
          settle()
          const release = (): void => (done ? stop() : void setTimeout(release, 50))
          release()
        }),
    )
    expect(index?.files).toEqual(expect.arrayContaining([first, second]))
    expect(index?.sessionId).toBe(index?.mounted)
  })
})

Then(
  'SessionScreen lists {string} under {string} and its search finds {string}',
  async ({ page }: { page: Page }, file: string, directory: string, hit: string) => {
    const found = await page.evaluate(
      async ({ directory, query }) => {
        const live = globalThis.__dshxBrokerV1?.contracts.get('dshx.session-screen')?.live
        if (live?.status !== 'active') throw new Error('dshx.session-screen is not provided')
        // SAFETY: as above, `dshx.session-screen` holds a SessionScreenService.
        const screen = live.value as SessionScreenService
        return { listed: await screen.files.list({ path: directory }), hits: await screen.files.search({ query }) }
      },
      {
        directory,
        query:
          hit
            .split('/')
            .at(-1)
            ?.replace(/\.\w+$/, '') ?? hit,
      },
    )
    await recordAssertion(page, 'session-screen-lists-a-tree-level', () =>
      expect(found.listed).toContainEqual(expect.objectContaining({ path: file, type: 'file' })),
    )
    await recordAssertion(page, 'session-screen-search-finds-the-file', () => expect(found.hits).toContainEqual({ path: hit, kind: 'file' }))
    await finishJourneyAssertions(page)
  },
)
