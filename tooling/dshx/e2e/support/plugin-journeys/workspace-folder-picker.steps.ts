import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page, type Route } from '@playwright/test'
import * as Schema from 'effect/Schema'
import { ApiChannelModel } from '../../../packages/dshx/src/api/channel.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const folderPickerDialog = (page: Page) => page.getByRole('dialog', { name: 'Add workspace' })
const absolutePathPattern = /^(?:\/|[a-z]:[\\/]|\\\\)/i
const capabilityEndpoint = `${ApiChannelModel.apiChannel('@dshfiles/workspace-folder-picker', 'workspace-folder-picker.browser').slice(1)}/capabilities`
const rpcIdentity = Schema.Struct({ rpcId: Schema.String, method: Schema.String })
const capabilityResult = Schema.Struct({
  result: Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Struct({ nativePicker: Schema.Boolean }) }) }),
})

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
  await recordAssertion(page, 'host-home-directory-is-listed', () => expect(dialog.locator('p').filter({ hasText: absolutePathPattern })).toBeVisible())
  const response = await page.request.post(new URL(`/api/${capabilityEndpoint}`, page.url()).href, {
    data: { type: 'client-request', rpcId: 'folder-picker-capability-check', method: capabilityEndpoint, payload: { version: 1, input: {} } },
  })
  const capability = Schema.decodeUnknownSync(capabilityResult)(await response.json()).result.value.output
  await recordAssertion(page, 'native-chooser-matches-host-capability', () =>
    expect(dialog.getByRole('button', { name: 'Browse…' })).toHaveCount(capability.nativePicker ? 1 : 0),
  )
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
  const homePath = await dialog.locator('p').filter({ hasText: absolutePathPattern }).first().textContent()
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

Then('native folder selection supports cancellation, recovery and registration', async ({ page }: { page: Page }) => {
  const scratchRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-native-picker-e2e-')))
  const selectedPath = join(scratchRoot, 'native-selected-workspace')
  await mkdir(selectedPath)
  await writeFile(join(selectedPath, 'keep.txt'), 'keep this file\n')
  let picked = 0
  let capabilityAvailable = false
  const pathStyle = process.platform === 'win32' ? 'windows' : 'posix'
  const nativeRoute = async (route: Route) => {
    const request = Schema.decodeUnknownSync(rpcIdentity)(route.request().postDataJSON())
    if (request.method === capabilityEndpoint) {
      if (!capabilityAvailable) {
        return route.fulfill({
          json: {
            type: 'server-response',
            rpcId: request.rpcId,
            result: { ok: false, error: { code: 'gateway/method-not-found', message: 'An older Host has no capability query', details: {} } },
          },
        })
      }
      return route.fulfill({
        json: { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { version: 1, output: { nativePicker: true, pathStyle } } } },
      })
    }
    picked += 1
    const result =
      picked === 1
        ? { ok: true, value: null }
        : picked === 2
          ? { ok: false, error: { code: 'directory-picker/unavailable', message: 'Injected native chooser failure', details: {} } }
          : { ok: true, value: selectedPath }
    return route.fulfill({ json: { type: 'server-response', rpcId: request.rpcId, result } })
  }
  const capabilityPattern = `**/api/${capabilityEndpoint}`
  const pickPattern = '**/api/directoryPicker/pick'
  await page.route(capabilityPattern, nativeRoute)
  await page.route(pickPattern, nativeRoute)
  const dialog = folderPickerDialog(page)
  const pathInput = dialog.getByRole('textbox', { name: 'Enter a folder path' })
  const browse = dialog.getByRole('button', { name: 'Browse…', exact: true })
  // Every opening mounts a fresh flow; wait for its capability read and its home listing before asserting on either.
  const openAddWorkspace = async (): Promise<void> => {
    const capabilityRead = page.waitForResponse(response => response.url().endsWith(`/${capabilityEndpoint}`))
    await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
    await capabilityRead
    await expect(dialog.getByRole('listbox', { name: 'Folders' })).toBeVisible()
    await expect(pathInput).toHaveValue(absolutePathPattern)
  }
  const pickNative = async (expectedPicks: number): Promise<void> => {
    await browse.click()
    await expect.poll(() => picked).toBe(expectedPicks)
  }
  try {
    await openAddWorkspace()
    await recordAssertion(page, 'older-host-keeps-absolute-path-fallback', async () => {
      await expect(dialog.getByRole('alert')).toHaveCount(0)
      await expect(browse).toHaveCount(0)
      await pathInput.fill(selectedPath)
      await expect(dialog.getByRole('button', { name: 'Use this folder', exact: true })).toBeVisible()
    })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    capabilityAvailable = true
    await openAddWorkspace()
    await expect(browse).toBeEnabled()
    const initialPath = await pathInput.inputValue()
    await pickNative(1)
    await recordAssertion(page, 'native-cancel-preserves-folder-selection', async () => {
      await expect(browse).toBeEnabled()
      await expect(pathInput).toHaveValue(initialPath)
      await expect(dialog).toBeVisible()
    })
    await pickNative(2)
    await recordAssertion(page, 'native-failure-keeps-path-entry-and-retry', async () => {
      await expect(dialog.getByRole('alert')).toContainText('Paste an absolute path')
      await expect(pathInput).toBeEnabled()
      await expect(browse).toBeEnabled()
    })
    await pickNative(3)
    await recordAssertion(page, 'native-selection-registers-workspace', async () => {
      await expect(dialog).toBeHidden()
      await expect(page.getByRole('treeitem').filter({ hasText: 'native-selected-workspace' })).toBeVisible()
      expect(await readFile(join(selectedPath, 'keep.txt'), 'utf8')).toBe('keep this file\n')
    })
    await finishJourneyAssertions(page)
  } finally {
    await page.unroute(capabilityPattern, nativeRoute)
    await page.unroute(pickPattern, nativeRoute)
    await rm(scratchRoot, { recursive: true, force: true })
  }
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
