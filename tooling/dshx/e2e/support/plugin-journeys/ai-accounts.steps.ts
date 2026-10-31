import { expect, test, type Page, type Request } from '@playwright/test'
import { globalPanelLink, openGlobalPanel } from '../plugin-view-names.js'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import { zstdCompressSync } from 'node:zlib'
import { accountConnectionSnapshotSchema, accountDraftSchema, accountsFileSchema } from '../../../../../plugins/@dshfiles/ai-accounts/src/api.js'
import { threadAccountPreviewSchema } from '../../../../../plugins/@dshfiles/ai-accounts/src/thread-account-api.js'
import { After, Given, Then, When } from '../bdd.js'
import {
  browserDiagnosticsFor,
  finishJourneyAssertions,
  openSettingsDialog,
  profileFor,
  recordAssertion,
  restartScratchProfileInBrowser,
  visitIsolatedPluginProfile,
} from '../steps.js'
import { bootComposedPluginProfile } from '../boot.js'
import { seedAiAccountsWorkspace } from '../ai-accounts-workspace.js'
import { seedCancellationOnlyCodexCli } from '../fake-account-codex.js'
import {
  fakeCommandCodeFor,
  fakeQuotaReads,
  setFakeQuotaStatus,
  startControllableQuotaCommandCode,
  startFakeCommandCode,
  stopFakeCommandCode,
} from '../fake-command-code.js'

const providerAccounts = (page: Page) => page.getByRole('complementary', { name: 'Provider accounts' })
const selectedAccount = (page: Page) => page.getByRole('region', { name: 'Selected account', exact: true })
const savedAccountCards = (page: Page) =>
  providerAccounts(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Select /u }) })
    .filter({ has: page.getByRole('button', { name: /^Actions for /u }) })
const accountCard = (page: Page, name: string) =>
  providerAccounts(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })

const openAccountAdvanced = async (page: Page): Promise<void> => {
  await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
  const advanced = selectedAccount(page)
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Advanced settings/u }) })
  if ((await advanced.getAttribute('open')) === null) await advanced.locator('summary').click()
  await expect(selectedAccount(page).getByRole('heading', { name: 'Runtime paths', exact: true })).toBeVisible()
}

const openPageOptions = async (page: Page): Promise<void> => {
  const options = page.getByRole('button', { name: 'Account page options', exact: true })
  if ((await options.getAttribute('data-state')) !== 'open') await options.click()
}

const moveAccountEarlier = async (page: Page, name: string): Promise<void> => {
  await accountCard(page, name)
    .getByRole('button', { name: `Actions for ${name}`, exact: true })
    .click()
  await page.getByRole('menuitem', { name: `Move ${name} earlier in account order`, exact: true }).click()
}

const chooseNewAccount = async (page: Page, provider: string): Promise<void> => {
  // Header and empty state intentionally share this action; the header is first.
  const add = page.getByRole('button', { name: 'Add account', exact: true }).first()
  if (await add.isVisible()) await add.click()
  else await page.getByRole('button', { name: 'Add AI account', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Add account', exact: true })
    .getByRole('button', { name: `${provider} account`, exact: true })
    .click()
}

const expandSetupDetails = async (page: Page, name: string): Promise<void> => {
  const dialog = page.getByRole('dialog').last()
  const details = dialog
    .locator('summary')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .locator('..')
  if ((await details.getAttribute('open')) === null) await details.locator(':scope > summary').click()
}

const renamePendingAccount = async (page: Page, name: string, submit: 'button' | 'Enter' = 'button'): Promise<void> => {
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('button', { name: 'Edit account name', exact: true }).click()
  const input = dialog.getByRole('textbox', { name: 'Account name', exact: true })
  await input.fill(name)
  if (submit === 'Enter') await input.press('Enter')
  else await dialog.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(input).toHaveCount(0)
  await expect(dialog.getByText(name.trim(), { exact: true })).toBeVisible()
}

const captureMinimalClaude = async (page: Page): Promise<void> => {
  const originalViewport = page.viewportSize()
  try {
    for (const width of [360, 480, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      const dialog = page.getByRole('dialog', { name: 'Connect Claude', exact: true })
      await expect(dialog.getByRole('button', { name: 'Edit account name', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'API key', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Use existing credential', exact: true })).toBeHidden()
      await expect(dialog.getByRole('button', { name: 'Verify subscription and add account', exact: true })).toBeVisible()
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.mouse.move(0, 0)
      await page.screenshot({ path: test.info().outputPath(`minimal-claude-${width}.png`), animations: 'disabled' })
      await dialog.getByRole('button', { name: 'Edit account name', exact: true }).click()
      await expect(dialog.getByRole('textbox', { name: 'Account name', exact: true })).toBeFocused()
      await page.screenshot({ path: test.info().outputPath(`minimal-claude-name-${width}.png`), animations: 'disabled' })
      await dialog.getByRole('button', { name: 'Cancel name edit', exact: true }).click()
      await dialog.getByRole('button', { name: 'API key', exact: true }).click()
      await expect(dialog.getByRole('textbox', { name: 'API key or setup token value', exact: true })).toBeVisible()
      await page.mouse.move(0, 0)
      await page.screenshot({ path: test.info().outputPath(`minimal-claude-key-${width}.png`), animations: 'disabled' })
      await dialog.getByRole('button', { name: 'Claude account', exact: true }).click()
    }
  } finally {
    if (originalViewport !== null) await page.setViewportSize(originalViewport)
  }
}

const prepareCommandCodeKey = async (page: Page, name: string): Promise<void> => {
  await chooseNewAccount(page, 'Command Code')
  const dialog = page.getByRole('dialog', { name: 'Connect Command Code', exact: true })
  await expect(dialog.getByText(name, { exact: true })).toBeVisible()
  const connection = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Connection settings$/ }) })
  await connection.locator('summary').click()
  await dialog.getByRole('textbox', { name: 'API base URL', exact: true }).fill(fakeCommandCodeFor(page).baseUrl)
  await dialog.getByRole('button', { name: 'Apply connection settings', exact: true }).click()
  // The connection editor remounts collapsed only after the Host accepted the provisional base URL.
  await expect(connection).not.toHaveAttribute('open', '')
  await expectEditableConnection(page)
  await expect(dialog.getByRole('button', { name: 'API key', exact: true })).toHaveAttribute('aria-pressed', 'true')
}

const CUSTOM_MODEL_ID = 'e2e-custom-model'

const addCommandCodeAccount = async (page: Page, input: { readonly name: string; readonly routeSlug?: string; readonly key: string }): Promise<void> => {
  await prepareCommandCodeKey(page, input.name)
  const keyDialog = page.getByRole('dialog', { name: 'Connect Command Code', exact: true })
  await keyDialog.getByRole('textbox', { name: 'API key value', exact: true }).fill(input.key)
  await keyDialog.getByRole('button', { name: 'Verify and add account', exact: true }).click()
  await expect(keyDialog).toBeHidden()
  await expect(selectedAccount(page).getByRole('heading', { name: input.name, exact: true })).toBeVisible()
  await expect(accountCard(page, input.name).getByRole('switch')).toBeChecked()
  if (input.routeSlug === undefined) return
  // Only rename a successfully connected saved route. Keep its verified unique credential reference unchanged.
  await openAccountAdvanced(page)
  const routeSlug = selectedAccount(page).getByRole('textbox', { name: 'Route slug', exact: true })
  await routeSlug.fill(input.routeSlug)
  await routeSlug.blur()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: `Renamed to ${input.routeSlug}.` })
      .first(),
  ).toBeVisible()
  await openAccountAdvanced(page)
}

const openAccountsPanel = async (page: Page): Promise<void> => {
  if (await providerAccounts(page).isVisible()) return

  const globalPanel = globalPanelLink(page, 'AI Accounts: Accounts')
  if (await globalPanel.isVisible()) {
    await globalPanel.click()
  } else {
    await openSettingsDialog(page)
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
  }
  await expect(providerAccounts(page)).toBeVisible()
}

Given('the isolated AI Accounts and thread account controller profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/ai-accounts', '@dshfiles/session-controller'],
    profileLabel: 'ai-accounts-thread-account-controller',
    seedHome: seedAiAccountsWorkspace,
    seedKey: 'ai-accounts-thread-account-controller-v1',
  })
  await visitIsolatedPluginProfile(page, profile)
})

Given('the isolated account dashboard reference profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/ai-accounts', '@dshfiles/usage'],
    profileLabel: 'ai-accounts-dashboard-reference',
    seedHome: seedAiAccountsWorkspace,
    seedKey: 'ai-accounts-dashboard-reference-v1',
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('two synthetic work accounts and recorded account usage populate the dashboard', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  const accountSettings = page.getByRole('button', { name: 'AI account settings', exact: true })
  await expect(accountSettings).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add AI account', exact: true })).toBeVisible()
  await accountSettings.click()
  await expect(page.getByRole('heading', { name: 'AI Accounts', exact: true })).toBeVisible()
  await addCommandCodeAccount(page, { name: 'Command Code 1', routeSlug: 'commandcode_work', key: 'e2e-fake-key-ALPHA1' })
  await addCommandCodeAccount(page, { name: 'Command Code 2', routeSlug: 'commandcode_personal', key: 'e2e-fake-key-BRAVO2-EXHAUSTED' })
  for (const [oldName, newName] of [
    ['Command Code 1', 'Command Code Work'],
    ['Command Code 2', 'Command Code Personal'],
  ] as const) {
    await accountCard(page, oldName)
      .getByRole('button', { name: `Select ${oldName}`, exact: true })
      .click()
    await selectedAccount(page).getByRole('button', { name: 'Rename account', exact: true }).click()
    const nameInput = selectedAccount(page).getByRole('textbox', { name: 'Account name', exact: true }).first()
    await nameInput.fill(newName)
    await nameInput.press('Enter')
    await expect.poll(async () => (await readSavedAccounts(page)).some(account => account.displayName === newName)).toBe(true)
  }
  const home = profileFor(page).homeRoot
  const directory = join(home, 'sessions', '-synthetic-account-dashboard', 'session-dashboard-reference')
  await mkdir(directory, { recursive: true })
  const now = Date.now()
  const records = [{ type: 'session', id: 'session-dashboard-reference', createdAt: now - 14 * 86_400_000, cwd: '/synthetic/account-dashboard' }]
  const events: object[] = [...records]
  for (let index = 0; index < 84; index++) {
    const time = now - (13 - Math.floor(index / 6)) * 86_400_000 - ((index % 6) + 1) * 60_000
    const model = index % 3 === 0 ? 'gpt-6-luna-mini' : 'gpt-6-luna'
    const turn = index + 1
    events.push(
      { type: 'model/selection', seq: index * 3 + 1, time, data: { provider: 'commandcode_work', model } },
      { type: 'step/start', seq: index * 3 + 2, time, data: { turn, step: 1 } },
      {
        type: 'assistant/message',
        seq: index * 3 + 3,
        time: time + 1250 + index * 10,
        data: {
          turn,
          step: 1,
          message: { id: `synthetic-${index}`, source: { provider: 'commandcode_work', model } },
          usage: { inputTokens: 12000 + index * 100, outputTokens: 2300 + index * 20, cacheReadTokens: 3000 },
          stream: [
            { type: 'chunk', time: time + 250, chunk: { type: 'block-start' } },
            { type: 'chunk', time: time + 1250 + index * 10, chunk: { type: 'finish', reason: { kind: 'stop' } } },
          ],
        },
      },
    )
  }
  await writeFile(join(directory, 'session.v1.jsonl.zstd'), zstdCompressSync(events.map(event => JSON.stringify(event)).join('\n') + '\n'))
  await writeFile(
    join(home, 'plugins', 'ai-accounts', 'pricing.json'),
    JSON.stringify({
      version: 1,
      fetchedAt: now,
      source: 'synthetic-e2e',
      providers: {
        commandcode_work: { 'gpt-6-luna': { input: 1.25, output: 10, cacheRead: 0.125 }, 'gpt-6-luna-mini': { input: 0.25, output: 2, cacheRead: 0.025 } },
      },
    }),
  )
  await openGlobalPanel(page, 'Usage: Analytics')
  await page.getByRole('button', { name: 'Re-index session logs', exact: true }).click()
  await expect.poll(() => page.getByRole('table').getByRole('row').count()).toBeGreaterThan(20)
  await page.reload()
  await openAccountsPanel(page)
  await accountCard(page, 'Command Code Work').getByRole('button', { name: 'Select Command Code Work', exact: true }).click()
})

Then('the account dashboard reference screens fit desktop mobile and dark layouts', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-dashboard-reference-layout', async () => {
    for (const width of [1816, 1536, 1024, 768, 480, 360]) {
      await page.setViewportSize({ width, height: 1150 })
      if (width >= 1024) {
        const accountSettings = page.getByRole('button', { name: 'AI account settings', exact: true })
        await expect(accountSettings).toBeVisible()
        await openGlobalPanel(page, 'AI Accounts: Usage history')
        await accountSettings.focus()
        await accountSettings.press('Enter')
        await expect(page.getByRole('heading', { name: 'AI Accounts', exact: true })).toBeVisible()
        const strip = page.getByRole('group', { name: /^AI accounts usage/ })
        const healthy = strip.getByRole('button', { name: /^Command Code Work:/ })
        const exhausted = strip.getByRole('button', { name: /^Command Code Personal:/ })
        await expect(exhausted).toHaveClass(/dshx:bg-destructive\/10/u)
        const healthyHeight = await healthy.evaluate(element => element.getBoundingClientRect().height)
        const paintedHeight = await exhausted.evaluate(element => ({
          height: element.getBoundingClientRect().height,
          background: getComputedStyle(element).backgroundColor,
        }))
        expect(healthyHeight).toBeGreaterThan(0)
        expect(paintedHeight.height).toBe(healthyHeight)
        expect(paintedHeight.background).not.toBe('rgba(0, 0, 0, 0)')
        await page
          .getByRole('group', { name: /^AI accounts usage/ })
          .screenshot({ path: test.info().outputPath(`sidebar-account-settings-${width}.png`), animations: 'disabled' })
      }
      const tabBounds = await selectedAccount(page).evaluate(element => {
        const pane = element.getBoundingClientRect()
        return [...element.querySelectorAll('[role="tab"]')].map(tab => {
          const box = tab.getBoundingClientRect()
          return { name: tab.textContent?.trim(), left: box.left - pane.left, right: box.right - pane.right }
        })
      })
      expect(tabBounds).toHaveLength(3)
      for (const bounds of tabBounds) {
        expect(bounds.left, `${width}px ${bounds.name} tab left edge`).toBeGreaterThanOrEqual(0)
        expect(bounds.right, `${width}px ${bounds.name} tab right edge`).toBeLessThanOrEqual(0)
      }
      for (const section of ['Models', 'Settings', 'Usage']) {
        await selectedAccount(page).getByRole('tab', { name: section, exact: true }).click()
        if (section === 'Usage') {
          await expect(selectedAccount(page).getByText('Total requests', { exact: true })).toBeVisible()
          await expect(selectedAccount(page).getByRole('img', { name: 'Account usage over time', exact: true })).toBeVisible()
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        await page.mouse.move(0, 0)
        await page.screenshot({ path: test.info().outputPath(`dashboard-${section.toLowerCase()}-${width}.png`), animations: 'disabled' })
        if (width === 1816)
          await page
            .locator('[data-account-dashboard]')
            .screenshot({ path: test.info().outputPath(`dashboard-${section.toLowerCase()}-reference.png`), animations: 'disabled' })
      }
      if (width === 1816) process.stdout.write(`Dashboard main-only reference screenshots ready: ${test.info().outputDir}\n`)
    }
    await page.setViewportSize({ width: 1816, height: 1150 })
    await page.emulateMedia({ colorScheme: 'dark' })
    for (const section of ['Models', 'Settings', 'Usage']) {
      await selectedAccount(page).getByRole('tab', { name: section, exact: true }).click()
      await page
        .locator('[data-account-dashboard]')
        .screenshot({ path: test.info().outputPath(`dashboard-${section.toLowerCase()}-dark.png`), animations: 'disabled' })
    }
  })
})

Then('the dashboard model routing and sign-out controls preserve saved account state', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-dashboard-controls-persist', async () => {
    await selectedAccount(page).getByRole('tab', { name: 'Models', exact: true }).click()
    await selectedAccount(page).getByRole('button', { name: 'Star gpt-6-luna', exact: true }).click()
    await expect(selectedAccount(page).getByRole('button', { name: 'Unstar gpt-6-luna', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const show = selectedAccount(page).getByRole('switch', { name: 'Show gpt-6-luna in the picker', exact: true })
    await show.click()
    await expect(show).not.toBeChecked()
    await expect
      .poll(async () => (await readSavedAccounts(page)).find(account => account.instanceId === 'commandcode_work')?.hiddenModelIds)
      .toContain('gpt-6-luna')
    await page.reload()
    await openAccountsPanel(page)
    await accountCard(page, 'Command Code Work').getByRole('button', { name: 'Select Command Code Work', exact: true }).click()
    await expect(selectedAccount(page).getByRole('button', { name: 'Unstar gpt-6-luna', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(show).not.toBeChecked()
    await show.click()
    await expect(show).toBeChecked()
    await selectedAccount(page).getByRole('button', { name: 'Unstar gpt-6-luna', exact: true }).click()
    await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
    const routing = selectedAccount(page).getByRole('switch', { name: 'Enable for model routing', exact: true })
    await routing.click()
    await expect(accountCard(page, 'Command Code Work').getByRole('switch')).not.toBeChecked()
    await routing.click()
    await expect(accountCard(page, 'Command Code Work').getByRole('switch')).toBeChecked()
    await expect
      .poll(async () => (await readSavedAccounts(page)).find(account => account.instanceId === 'commandcode_work'))
      .toMatchObject({ enabled: true, favoriteModelIds: [], hiddenModelIds: [] })
    await page.reload()
    await openAccountsPanel(page)
    await accountCard(page, 'Command Code Work').getByRole('button', { name: 'Select Command Code Work', exact: true }).click()
    await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
    const copy = selectedAccount(page).getByRole('button', { name: 'Copy account ID', exact: true })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await copy.click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('commandcode_work')
    await expect(copy.locator('svg')).toHaveClass(/lucide-check/u)
    const before = await readSavedAccounts(page)
    const signOutCalls: Request[] = []
    const recordSignOut = (request: Request): void => {
      if (new URL(request.url()).pathname.endsWith('/signOut')) signOutCalls.push(request)
    }
    page.on('request', recordSignOut)
    try {
      await selectedAccount(page).getByRole('button', { name: 'Sign out', exact: true }).click()
      const confirmation = page.getByRole('alertdialog')
      await expect(confirmation.getByRole('heading', { name: 'Sign out of Command Code Work?', exact: true })).toBeVisible()
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirmation).toBeHidden()
      expect(await readSavedAccounts(page)).toEqual(before)
      expect(signOutCalls).toHaveLength(0)
      await expect(selectedAccount(page).getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled()
    } finally {
      page.off('request', recordSignOut)
    }
  })
  const diagnostics = browserDiagnosticsFor(page)
  process.stdout.write(
    `Dashboard browser diagnostics: ${JSON.stringify({ consoleErrors: diagnostics.filter(value => value.startsWith('console.error:')).length, pageErrors: diagnostics.filter(value => value.startsWith('pageerror:')).length, httpErrors: diagnostics.filter(value => value.startsWith('http ')).length, failedRequests: diagnostics.filter(value => value.startsWith('requestfailed:')) })}\n`,
  )
  await finishJourneyAssertions(page)
})

Given('the isolated provisional account connections profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/ai-accounts'],
    profileLabel: 'ai-accounts-provisional-connections',
    seedHome: async home => {
      await seedAiAccountsWorkspace(home)
      const root = await realpath(home)
      const underTemp = relative(await realpath(tmpdir()), root)
      if (underTemp === '' || underTemp.startsWith('..') || isAbsolute(underTemp)) throw new Error('CLI fixture requires a private temporary home.')
      const authDirectory = join(root, '.commandcode')
      await mkdir(authDirectory, { recursive: true, mode: 0o700 })
      await writeFile(join(authDirectory, 'auth.json'), JSON.stringify({ apiKey: 'e2e-fake-key-CLI003' }), { flag: 'wx', mode: 0o600 })
      return seedCancellationOnlyCodexCli(home)
    },
    seedKey: 'ai-accounts-provisional-cancellation-cli-v2',
  })
  await visitIsolatedPluginProfile(page, profile)
})

const readSavedAccounts = async (page: Page) => {
  const source = await readFile(join(profileFor(page).homeRoot, 'plugins', 'ai-accounts', 'accounts.json'), 'utf8').catch(() => '{"accounts":[]}')
  return z.object({ accounts: z.array(accountDraftSchema) }).parse(JSON.parse(source)).accounts
}
const emptyAccountStore = async (page: Page): Promise<void> => {
  expect(await readSavedAccounts(page)).toHaveLength(0)
  await expect(savedAccountCards(page)).toHaveCount(0)
  await expect(page.getByRole('group', { name: /^AI accounts usage/ }).getByRole('button', { name: /Weekly limit|Current session/ })).toHaveCount(0)
}

const expectEditableConnection = async (page: Page): Promise<void> => {
  await expect(
    page
      .getByRole('dialog')
      .last()
      .getByRole('alert')
      .filter({ hasText: /unavailable or expired|could not be changed/ }),
  ).toHaveCount(0)
}
const chooseMethod = async (page: Page, label: string): Promise<void> => {
  if (label === 'Use existing credential') await expandSetupDetails(page, 'More options')
  const method = page.getByRole('dialog').last().getByRole('button', { name: label, exact: true })
  if ((await method.getAttribute('aria-pressed')) !== 'true') await method.click()
  await expect(method).toHaveAttribute('aria-pressed', 'true')
  await expectEditableConnection(page)
}
const applyExistingReference = async (page: Page, ref: string): Promise<void> => {
  await chooseMethod(page, 'Use existing credential')
  const dialog = page.getByRole('dialog').last()
  await expect(dialog.getByRole('button', { name: 'Use existing credential', exact: true }).locator('xpath=ancestor::details[1]')).toHaveAttribute('open', '')
  await dialog.getByRole('textbox', { name: 'Existing credential reference', exact: true }).fill(ref)
  await dialog.getByRole('button', { name: 'Apply credential reference', exact: true }).click()
  await expect(dialog.getByText(`Using ${ref}`, { exact: true })).toBeVisible()
  await expectEditableConnection(page)
}

const sidebarAddOrigins = new WeakMap<Page, string>()

When('the sidebar add-account shortcut is opened from the composer', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('Keep this unsent draft while connecting an account.')
  sidebarAddOrigins.set(page, page.url())
  await page.getByRole('button', { name: 'Add AI account', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add account', exact: true })).toBeVisible()
})

Then('account setup closes without navigating away or losing the composer draft', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-sidebar-add-does-not-navigate', async () => {
    let first = true
    for (const name of ['Codex', 'Claude', 'GitHub Copilot', 'OpenCode Go', 'Command Code', 'Cursor']) {
      for (const dismissal of ['Cancel', 'Close', 'Escape']) {
        if (!first) await page.getByRole('button', { name: 'Add AI account', exact: true }).click()
        first = false
        const chooser = page.getByRole('dialog', { name: 'Add account', exact: true })
        await chooser.getByRole('button', { name: `${name} account`, exact: true }).click()
        const dialog = page.getByRole('dialog').last()
        let fakePid: string | undefined
        if (name === 'Codex') {
          await dialog.getByRole('button', { name: 'Continue with Codex', exact: true }).click()
          await expect(dialog.getByText('ABCD-1234', { exact: true })).toBeVisible()
          fakePid = (await readFile(join(profileFor(page).homeRoot, 'fake-codex-cancellation.pid'), 'utf8')).trim()
        }
        if (name === 'Claude') {
          await expect(dialog).toContainText('No API key needed')
          await expect(dialog.locator('pre code')).not.toHaveText('')
          await expect(dialog.getByRole('textbox', { name: 'API key value', exact: true })).toHaveCount(0)
          if (dismissal === 'Cancel') {
            await captureMinimalClaude(page)
            await renamePendingAccount(page, '  Cancelled Claude  ', 'Enter')
            await emptyAccountStore(page)
            await dialog.getByRole('button', { name: 'Edit account name', exact: true }).click()
            await dialog.getByRole('textbox', { name: 'Account name', exact: true }).fill('Discard by Escape')
            await dialog.getByRole('textbox', { name: 'Account name', exact: true }).press('Escape')
            await expect(dialog).toBeVisible()
            await expect(dialog.getByText('Cancelled Claude', { exact: true })).toBeVisible()
            await expandSetupDetails(page, 'Sign-in command')
            const command = dialog.locator('pre code')
            const original = await command.innerText()
            try {
              // Scrub only the disposable Host path in captured evidence, never credentials or behavior.
              await command.evaluate(element => {
                element.textContent = 'CLAUDE_CONFIG_DIR="/scratch/private-claude" claude auth login'
              })
              await page.screenshot({ path: test.info().outputPath('provisional-claude-subscription.png') })
            } finally {
              await command.evaluate((element, value) => {
                element.textContent = value
              }, original)
            }
            await dialog.getByRole('button', { name: 'API key', exact: true }).click()
            await expect(dialog.getByRole('textbox', { name: 'API key or setup token value', exact: true })).toBeVisible()
            await dialog.getByRole('textbox', { name: 'API key or setup token value', exact: true }).fill('synthetic-key-not-submitted')
          }
        }
        if (name === 'OpenCode Go' || name === 'Command Code' || name === 'Cursor') {
          await dialog.getByRole('textbox', { name: 'API key value', exact: true }).fill('synthetic-key-not-submitted')
        }
        await emptyAccountStore(page)
        if (dismissal === 'Escape') await page.keyboard.press('Escape')
        else await dialog.getByRole('button', { name: dismissal, exact: true }).click()
        await expect(dialog).toBeHidden()
        await emptyAccountStore(page)
        if (fakePid !== undefined) {
          await expect
            .poll(async () =>
              readFile(join(profileFor(page).homeRoot, 'fake-codex-cancellation.stopped'), 'utf8')
                .then(value => value.trim())
                .catch(() => ''),
            )
            .toBe(fakePid)
        }
      }
    }
    await startFakeCommandCode(page)
    await prepareCommandCodeKey(page, 'Command Code 1')
    const failed = page.getByRole('dialog', { name: 'Connect Command Code', exact: true })
    await failed.getByRole('textbox', { name: 'API key value', exact: true }).fill('e2e-fake-key-BROKEN')
    await emptyAccountStore(page)
    await failed.getByRole('button', { name: 'Verify and add account', exact: true }).click()
    await expect(failed.getByRole('alert').filter({ hasText: 'Connection could not be verified.' })).toBeVisible()
    await emptyAccountStore(page)
    await failed.getByRole('button', { name: 'Cancel', exact: true }).click()
    await emptyAccountStore(page)
    expect(page.url()).toBe(sidebarAddOrigins.get(page))
    await expect(providerAccounts(page)).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toHaveText(
      'Keep this unsent draft while connecting an account.',
    )
  })
  await finishJourneyAssertions(page)
})

When('restored sign-in methods are configured provisionally without using real credentials', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  for (const name of ['Claude', 'Codex', 'Command Code', 'Cursor', 'OpenCode Go']) {
    await chooseNewAccount(page, name)
    const dialog = page.getByRole('dialog').last()
    await expect(dialog.getByRole('region', { name: 'Sign-in options', exact: true })).toBeVisible()
    if (name === 'Claude') {
      await expect(dialog.getByRole('button', { name: 'Claude account', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(dialog.getByRole('region', { name: 'Sign-in options', exact: true }).locator('[aria-label="Sign-in method"] button')).toHaveCount(2)
      await expect(dialog.getByRole('button', { name: 'Use existing credential', exact: true })).toBeHidden()
      await expect(dialog).toContainText('No API key needed')
      await expandSetupDetails(page, 'More options')
      await dialog.getByRole('button', { name: 'Use default Claude Code login', exact: true }).click()
      await expandSetupDetails(page, 'Sign-in command')
      await expect(dialog.locator('pre code')).toContainText(join(profileFor(page).homeRoot, '.claude'))
      await expect(dialog.getByRole('alert').filter({ hasText: /unavailable or expired|could not be changed/ })).toHaveCount(0)
      const defaultHomes = dialog
        .locator('summary')
        .filter({ hasText: /^Existing or custom CLI home$/ })
        .locator('..')
      await defaultHomes.locator('summary').click()
      await expect(dialog.getByRole('textbox', { name: 'CLAUDE_CONFIG_DIR', exact: true })).toHaveValue('~/.claude')
      const config = join(profileFor(page).homeRoot, 'custom-claude-fixture')
      await dialog.getByRole('textbox', { name: 'CLAUDE_CONFIG_DIR', exact: true }).fill(config)
      await dialog.getByRole('button', { name: 'Apply CLI home settings', exact: true }).click()
      await expect(dialog.locator('pre code')).toContainText(config)
      await expectEditableConnection(page)
      await chooseMethod(page, 'API key')
      await expect(dialog.getByRole('textbox', { name: 'API key or setup token value', exact: true })).toBeVisible()
      await expect(dialog).toContainText('Setup tokens are also supported')
      await applyExistingReference(page, 'SYNTHETIC_CLAUDE_API_KEY')
      await chooseMethod(page, 'Claude account')
      await expandSetupDetails(page, 'Sign-in command')
      const command = dialog.locator('pre code')
      const original = await command.innerText()
      try {
        await command.evaluate(element => {
          element.textContent = 'CLAUDE_CONFIG_DIR="/scratch/custom-claude" claude auth login'
        })
        await page.screenshot({ path: test.info().outputPath('restored-claude-sign-in-options.png') })
      } finally {
        await command.evaluate((element, value) => {
          element.textContent = value
        }, original)
      }
    } else if (name === 'Codex') {
      await expect(dialog.getByRole('button', { name: 'Browser sign-in', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await chooseMethod(page, 'Existing login')
      await expandSetupDetails(page, 'More options')
      await expandSetupDetails(page, 'Sign-in command')
      await expandSetupDetails(page, 'How this works')
      await expect(dialog).toContainText('distinct auth overlay')
      const homes = dialog
        .locator('summary')
        .filter({ hasText: /^Existing or custom CLI home$/ })
        .locator('..')
      await homes.locator('summary').click()
      // This is a lexical-only choice under the account policy's OS home. No read, creation or login is requested.
      const shared = join(homedir(), '.dsh-e2e-never-read-shared')
      const overlay = join(homedir(), '.dsh-e2e-never-read-overlay')
      await dialog.getByRole('textbox', { name: 'Shared Codex home', exact: true }).fill(shared)
      await dialog.getByRole('textbox', { name: 'Authentication overlay (CODEX_HOME)', exact: true }).fill(overlay)
      await dialog.getByRole('button', { name: 'Apply CLI home settings', exact: true }).click()
      await expect(dialog.locator('pre code')).toContainText(overlay)
      await expectEditableConnection(page)
      await chooseMethod(page, 'Browser sign-in')
      await expect(dialog.getByRole('button', { name: 'Continue with Codex', exact: true })).toBeVisible()
    } else {
      await expect(dialog.getByRole('region', { name: 'Sign-in options', exact: true }).locator('[aria-label="Sign-in method"] button')).toHaveCount(
        name === 'OpenCode Go' ? 0 : 2,
      )
      await expect(dialog.getByRole('button', { name: 'Use existing credential', exact: true })).toBeHidden()
      if (name === 'Command Code' || name === 'Cursor') {
        await chooseMethod(page, 'CLI login')
        await expandSetupDetails(page, 'Sign-in command')
        await expandSetupDetails(page, 'How this works')
        await expect(dialog.getByRole('button', { name: 'Verify CLI login and add account', exact: true })).toBeVisible()
        await expect(dialog.locator('pre code')).not.toHaveText('')
        if (name === 'Cursor') await expect(dialog).toContainText('quota only')
      }
      await applyExistingReference(page, 'SYNTHETIC_EXISTING_API_KEY')
      if (name === 'Command Code') {
        const connection = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Connection settings$/ }) })
        await connection.locator('summary').click()
        await dialog.getByRole('textbox', { name: 'API base URL', exact: true }).fill(fakeCommandCodeFor(page).baseUrl)
        await dialog.getByRole('button', { name: 'Apply connection settings', exact: true }).click()
        await expect(connection).not.toHaveAttribute('open', '')
        await expectEditableConnection(page)
        await chooseMethod(page, 'CLI login')
        await chooseMethod(page, 'API key')
        await connection.locator('summary').click()
        await expect(dialog.getByRole('textbox', { name: 'API base URL', exact: true })).toHaveValue(fakeCommandCodeFor(page).baseUrl)
      }
    }
    await emptyAccountStore(page)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await emptyAccountStore(page)
  }
})

Then('all restored methods remain provisional and cancelled connections add no accounts', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-restored-sign-in-options', () => emptyAccountStore(page))
  await finishJourneyAssertions(page)
})

When('a provider request fails because its credential is missing', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('Verify inline recovery for missing provider credentials.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click({ timeout: 10_000 })
  await expect(page.getByText('This turn failed', { exact: false })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Add or fix credentials', exact: true })).toBeVisible()
})

Then('the inline credential action opens AI Accounts', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-credential-recovery-action', async () => {
    await page.getByRole('button', { name: 'Add or fix credentials', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Provider accounts' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add account', exact: true }).first()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the AI Accounts settings section is opened', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Failure recovery' })).toBeVisible()
})

When('a verified loopback account is edited in manual save mode', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  const manualSave = page.getByRole('radio', { name: /Manual/ })
  // The radio follows the stored setting, so it flips after the Host round trip rather than on click.
  await manualSave.click()
  await expect(manualSave).toBeChecked()
  await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Provider accounts' })).toBeVisible()
  await addCommandCodeAccount(page, { name: 'Command Code 1', key: 'e2e-fake-key-ALPHA1' })
  await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
  await selectedAccount(page).getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('E2E Draft Account')
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes.' })).toBeVisible()
})

Then('the manual draft saves and persists when AI Accounts is reopened', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-manual-draft-persistence', async () => {
    const saveChanges = page.getByRole('button', { name: 'Save changes', exact: true })
    await saveChanges.click()
    await expect(saveChanges).toBeDisabled()
    // Confirm the Host persisted the draft; the redesigned manual footer has no saved-notice copy.
    await expect.poll(async () => (await readSavedAccounts(page))[0]?.displayName).toBe('E2E Draft Account')
    await openSettingsDialog(page)
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked()
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
    await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
    const edit = selectedAccount(page).getByRole('button', { name: 'Edit', exact: true })
    if (await edit.isVisible()) await edit.click()
    await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('E2E Draft Account')
  })
  await finishJourneyAssertions(page)
})

When('a verified loopback account is ready for removal', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', key: 'e2e-fake-key-ALPHA1' })
})

Then('account removal can be canceled and confirmed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-account-removal', async () => {
    const removeButton = page.getByRole('menuitem', { name: 'Remove profile', exact: true })
    await selectedAccount(page).getByRole('button', { name: 'Account actions', exact: true }).click()
    await removeButton.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Remove Command Code 1?', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Command Code 1', exact: true })).toBeVisible()
    await selectedAccount(page).getByRole('button', { name: 'Account actions', exact: true }).click()
    await removeButton.click()
    await dialog.getByRole('button', { name: 'Remove profile', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Removed Command Code 1. Credentials were left on disk.' })).toBeVisible()
    await expect(page.getByText('Your accounts, side by side.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the usage windows per account can be configured and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-usage-window-layout', async () => {
    const layout = page.getByRole('combobox', { name: 'Windows per account' })
    await expect(layout).toHaveText('Most relevant window')
    await layout.click()
    await page.getByRole('option', { name: 'All windows vertically', exact: true }).click()
    await expect(layout).toHaveText('All windows vertically')
    await layout.click()
    await page.getByRole('option', { name: 'Most relevant window', exact: true }).click()
    await expect(layout).toHaveText('Most relevant window')
  })
  await finishJourneyAssertions(page)
})

Then('the usage history cadence and retention can be changed and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-history-retention', async () => {
    const recordEvery = page.getByRole('combobox', { name: 'Record every' })
    const keepHistory = page.getByRole('combobox', { name: 'Keep history for' })
    await expect(recordEvery).toHaveText('5 min')
    await recordEvery.click()
    await page.getByRole('option', { name: '10 min', exact: true }).click()
    await expect(recordEvery).toHaveText('10 min')
    await expect(keepHistory).toHaveText('90 days')
    await keepHistory.click()
    await page.getByRole('option', { name: '180 days', exact: true }).click()
    await expect(keepHistory).toHaveText('180 days')
    await recordEvery.click()
    await page.getByRole('option', { name: '5 min', exact: true }).click()
    await expect(recordEvery).toHaveText('5 min')
    await keepHistory.click()
    await page.getByRole('option', { name: '90 days', exact: true }).click()
    await expect(keepHistory).toHaveText('90 days')
  })
  await finishJourneyAssertions(page)
})

Then('the price refresh interval and explicit override can be changed and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-pricing-cost-settings', async () => {
    const refreshInterval = page.getByRole('combobox', { name: 'Refresh prices every' })
    const overrides = page.getByRole('textbox', { name: 'Price overrides', exact: true })
    await expect(refreshInterval).toHaveText('24 h')
    await refreshInterval.click()
    await page.getByRole('option', { name: '2 days', exact: true }).click()
    await expect(refreshInterval).toHaveText('2 days')
    await overrides.fill('codex/*=free')
    await overrides.blur()
    await expect(overrides).toHaveValue('codex/* = free')
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
    await openSettingsDialog(page)
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await expect(refreshInterval).toHaveText('2 days')
    await expect(overrides).toHaveValue('codex/* = free')
    await refreshInterval.click()
    await page.getByRole('option', { name: '24 h', exact: true }).click()
    await expect(refreshInterval).toHaveText('24 h')
    await overrides.fill('')
    await overrides.blur()
    await expect(overrides).toHaveValue('')
  })
  await finishJourneyAssertions(page)
})

Then('the exhausted-limit retry default is on and the per-thread choice is shown', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-quota-retry-settings', async () => {
    const exhausted = page.getByRole('group', { name: /Usage exhausted/ })
    const failover = exhausted.getByRole('switch', { name: 'Fail over to the next account' })
    await failover.click()
    await expect(page.getByRole('heading', { name: 'Quota retry', exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Automatically resume after reset by default' })).toBeChecked()
    await expect(page.getByRole('switch', { name: 'Show the per-thread choice' })).toBeChecked()
    await failover.click()
    await expect(page.getByRole('heading', { name: 'Quota retry', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the rate-limit recovery failover can be changed and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-rate-limit-failover-toggle', async () => {
    const rateLimit = page.getByRole('group', { name: /Rate limited/ })
    const failover = rateLimit.getByRole('switch', { name: 'Fail over to the next account' })
    await expect(rateLimit.getByText('The provider answered 429.')).toBeVisible()
    await expect(failover).toBeChecked()
    await expect(failover).toBeEnabled()
    await failover.click()
    await expect(failover).not.toBeChecked()
    await failover.click()
    await expect(failover).toBeChecked()
  })
  await finishJourneyAssertions(page)
})

When('two verified loopback accounts are added with Priority distribution', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  await openGlobalPanel(page, 'AI Accounts: Accounts')
  await expect(page.getByRole('complementary', { name: 'Provider accounts' })).toBeVisible()
  await addCommandCodeAccount(page, { name: 'Command Code 1', key: 'e2e-fake-key-ALPHA1' })
  await addCommandCodeAccount(page, { name: 'Command Code 2', key: 'e2e-fake-key-BRAVO2' })
  await openPageOptions(page)
  const distribution = page.getByRole('combobox', { name: 'Request distribution' })
  await distribution.click()
  await page.getByRole('option', { name: /Priority/ }).click()
  await expect(distribution).toHaveText('Priority')
})

Then('the account order controls Priority routing', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-priority-order', async () => {
    await page.keyboard.press('Escape')
    await moveAccountEarlier(page, 'Command Code 2')
    await accountCard(page, 'Command Code 2').getByRole('button', { name: 'Actions for Command Code 2', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Move Command Code 2 earlier in account order', exact: true })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: 'Move Command Code 2 later in account order', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
  })
  await finishJourneyAssertions(page)
})

Then('the AI Accounts list on the Models page can be hidden and restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-model-curation', async () => {
    const settings = page.getByRole('dialog')
    const accountList = page.getByRole('switch', { name: 'Accounts on the Models page' })
    await expect(accountList).toBeChecked()
    await accountList.click()
    await expect(accountList).not.toBeChecked()
    await settings.getByRole('button', { name: 'Models', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'AI Accounts', exact: true })).toHaveCount(0)
    await settings.getByRole('button', { name: 'AI Accounts', exact: true }).click()
    const restoredAccountList = page.getByRole('switch', { name: 'Accounts on the Models page' })
    await expect(restoredAccountList).not.toBeChecked()
    await restoredAccountList.click()
    await expect(restoredAccountList).toBeChecked()
    await settings.getByRole('button', { name: 'Models', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'AI Accounts', exact: true })).toBeVisible()
    await settings.getByRole('button', { name: 'Add account', exact: true }).click()
    const setup = page.getByRole('dialog', { name: 'Add account', exact: true })
    await expect(setup.getByRole('button', { name: 'Codex account', exact: true })).toBeVisible()
    await expect(setup.getByRole('button', { name: 'Claude account', exact: true })).toBeVisible()
    await expect(page.getByText('No accounts yet.', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  })
  await finishJourneyAssertions(page)
})

When('a Codex account with a manually added model is configured', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', key: 'e2e-fake-key-ALPHA1' })
  await selectedAccount(page).getByRole('tab', { name: 'Models', exact: true }).click()
  await selectedAccount(page).getByRole('button', { name: 'Add custom model', exact: true }).click()
  await selectedAccount(page).getByRole('textbox', { name: 'Additional model ID', exact: true }).fill(CUSTOM_MODEL_ID)
  await selectedAccount(page).getByRole('button', { name: 'Add model', exact: true }).click()
  await expect.poll(async () => (await readSavedAccounts(page))[0]?.additionalModelIds).toContain(CUSTOM_MODEL_ID)
})

Then('the custom model can be removed from its picker list', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-custom-model-removal', async () => {
    const customRow = selectedAccount(page).getByRole('row').filter({ hasText: 'Custom' })
    await expect(customRow).toHaveCount(1)
    await customRow.getByRole('button', { name: /^Actions for /u }).click()
    await page.getByRole('menuitem', { name: 'Remove additional model', exact: true }).click()
    await expect(customRow).toHaveCount(0)
    await expect.poll(async () => (await readSavedAccounts(page))[0]?.additionalModelIds).not.toContain(CUSTOM_MODEL_ID)
  })
  await finishJourneyAssertions(page)
})

When('a Command Code account backed by a local fake provider is added', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', routeSlug: 'commandcode_work', key: 'e2e-fake-key-ALPHA1' })
  await expect(savedAccountCards(page)).toHaveCount(1)
  const saved = await readSavedAccounts(page)
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ enabled: true, kind: 'commandcode', instanceId: 'commandcode_work' })
  await expect(accountCard(page, 'Command Code 1').getByRole('switch')).toBeChecked()
})

Then('existing reference and CLI methods verify against only the loopback provider', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-existing-reference-and-cli', async () => {
    const first = (await readSavedAccounts(page))[0]
    if (first === undefined || first.apiKeyEnv === '') throw new Error('The verified seed account has no native reference.')
    await chooseNewAccount(page, 'Command Code')
    await applyExistingReference(page, first.apiKeyEnv)
    await renamePendingAccount(page, '  Reference Work  ', 'Enter')
    await chooseMethod(page, 'CLI login')
    await applyExistingReference(page, first.apiKeyEnv)
    let dialog = page.getByRole('dialog').last()
    await expect(dialog.getByText('Reference Work', { exact: true })).toBeVisible()
    let connection = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Connection settings$/ }) })
    await connection.locator('summary').click()
    await dialog.getByRole('textbox', { name: 'API base URL', exact: true }).fill(fakeCommandCodeFor(page).baseUrl)
    await dialog.getByRole('button', { name: 'Apply connection settings', exact: true }).click()
    await expect(connection).not.toHaveAttribute('open', '')
    await expectEditableConnection(page)
    expect(await readSavedAccounts(page)).toHaveLength(1)
    await dialog.getByRole('button', { name: 'Verify and add account', exact: true }).click()
    await expect(dialog).toBeHidden()
    const referenced = await readSavedAccounts(page)
    expect(referenced).toHaveLength(2)
    expect(referenced.find(account => account.instanceId !== first.instanceId)).toMatchObject({
      enabled: true,
      authSource: 'reference',
      apiKeyEnv: first.apiKeyEnv,
      displayName: 'Reference Work',
    })
    await chooseNewAccount(page, 'Command Code')
    await renamePendingAccount(page, '  CLI Work  ')
    await chooseMethod(page, 'CLI login')
    dialog = page.getByRole('dialog').last()
    connection = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Connection settings$/ }) })
    await connection.locator('summary').click()
    await dialog.getByRole('textbox', { name: 'API base URL', exact: true }).fill(fakeCommandCodeFor(page).baseUrl)
    await dialog.getByRole('button', { name: 'Apply connection settings', exact: true }).click()
    await expect(connection).not.toHaveAttribute('open', '')
    await expectEditableConnection(page)
    await dialog.getByRole('button', { name: 'Verify CLI login and add account', exact: true }).click()
    await expect(dialog).toBeHidden()
    const saved = await readSavedAccounts(page)
    expect(saved).toHaveLength(3)
    expect(saved.find(account => account.authSource === 'cli')).toMatchObject({ enabled: true, apiKeyEnv: '', kind: 'commandcode', displayName: 'CLI Work' })
    await page.reload()
    await openAccountsPanel(page)
    expect(await readSavedAccounts(page)).toEqual(saved)
    await expect(savedAccountCards(page)).toHaveCount(3)
    const cliCard = accountCard(page, 'CLI Work')
    await cliCard.getByRole('button').first().click()
    await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
    await selectedAccount(page).getByRole('button', { name: 'Reauthenticate', exact: true }).click()
    const reconnect = page.getByRole('dialog', { name: 'Reconnect CLI Work', exact: true })
    await expect(reconnect.getByRole('button', { name: 'Edit account name', exact: true })).toHaveCount(0)
    await expect(reconnect.getByRole('button', { name: 'CLI login', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await reconnect.getByRole('button', { name: 'Close', exact: true }).first().click()
    expect(await readSavedAccounts(page)).toEqual(saved)
  })
  await finishJourneyAssertions(page)
})

When('a second Command Code account whose verification fails is attempted', async ({ page }: { page: Page }) => {
  await prepareCommandCodeKey(page, 'Command Code 2')
  const dialog = page.getByRole('dialog', { name: 'Connect Command Code', exact: true })
  await dialog.getByRole('textbox', { name: 'API key value', exact: true }).fill('e2e-fake-key-BROKEN')
  await expect(accountCard(page, 'Command Code 2')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Verify and add account', exact: true }).click()
})

Then('the account shows the session and weekly windows the provider reports', async ({ page }: { page: Page }) => {
  await accountCard(page, 'Command Code 1').getByRole('button').first().click()
  await selectedAccount(page).getByRole('tab', { name: 'Usage', exact: true }).click()
  await selectedAccount(page)
    .locator('summary')
    .filter({ hasText: /^Subscription quota & history$/u })
    .click()
  await recordAssertion(page, 'ai-accounts-quota-windows-follow-the-provider', async () => {
    await expect(page.getByRole('progressbar', { name: 'Current session remaining', exact: true })).toBeVisible()
    await expect(page.getByText('75% left', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Resets in (59|60)m$/)).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Weekly limit remaining', exact: true })).toBeVisible()
    await expect(page.getByText('10% left', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Resets in 2d \d+h$/)).toBeVisible()
  })
  await recordAssertion(page, 'ai-accounts-sidebar-foot-shows-the-tightest-window', () =>
    expect(page.getByRole('button', { name: /^Command Code 1: Weekly limit: 10% left, resets in 2d \d+h$/ })).toBeVisible(),
  )
})

Then('failed verification reports a retry error without adding the account', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-failed-quota-read-is-shown-as-an-error', async () => {
    const dialog = page.getByRole('dialog', { name: 'Connect Command Code', exact: true })
    await expect(dialog.getByRole('alert').filter({ hasText: 'Connection could not be verified.' })).toBeVisible()
    await expect(dialog).not.toContainText('503')
    await expect(accountCard(page, 'Command Code 2')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Command Code 2: Weekly limit/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(savedAccountCards(page)).toHaveCount(1)
    await expect(accountCard(page, 'Command Code 1').getByRole('switch')).toBeChecked()
    const before = await readSavedAccounts(page)
    await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
    await selectedAccount(page).getByRole('button', { name: 'Reauthenticate', exact: true }).click()
    const reconnect = page.getByRole('dialog', { name: 'Reconnect Command Code 1', exact: true })
    await expect(reconnect.getByRole('button', { name: 'Verify and reconnect', exact: true })).toBeVisible()
    await reconnect.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(reconnect).toBeHidden()
    expect(await readSavedAccounts(page)).toEqual(before)
    await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
    await selectedAccount(page).getByRole('button', { name: 'Reauthenticate', exact: true }).click()
    await reconnect.getByRole('button', { name: 'Verify and reconnect', exact: true }).click()
    await expect(reconnect).toBeHidden()
    const after = await readSavedAccounts(page)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ instanceId: before[0]?.instanceId, apiKeyEnv: before[0]?.apiKeyEnv, enabled: true })
    await expect(savedAccountCards(page)).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

/** The picker lists the route radios directly on a fresh session, but shows the Model cell that opens them once one is picked. */
const selectAccountModel = async (page: Page, model: string): Promise<void> => {
  const cell = page.getByRole('menuitem', { name: /^Model / })
  const option = page.getByRole('menuitemradio', { name: model, exact: true })
  await expect(option.or(cell).first()).toBeVisible()
  if ((await option.count()) === 0) await cell.click()
  await option.click()
}

const usageStrip = (page: Page) => page.getByRole('group', { name: /^AI accounts usage/ })
const stripMeter = (page: Page) => usageStrip(page).getByRole('button', { name: /^Command Code 1: Weekly limit/ })
const expectActiveAccount = async (page: Page, accountId: string): Promise<void> => {
  const active = usageStrip(page).locator('[data-active-account]')
  await expect(active).toHaveCount(1)
  await expect(active).toHaveAttribute('data-active-account', accountId)
  await expect(active).toHaveAttribute('aria-current', 'true')
}

When('two healthy threads use different accounts', async ({ page }: { page: Page }) => {
  for (const [accountId, answer] of [
    ['commandcode_work', 'ALPHA1'],
    ['commandcode_work_2', 'BRAVO2'],
  ] as const) {
    await page.getByRole('button', { name: 'New session', exact: true }).first().click()
    await page.getByRole('button', { name: /^Select model/ }).click()
    await selectAccountModel(page, `${accountId}/gpt-6-luna`)
    const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
    await composer.fill(`Verify the source of chat ${answer}.`)
    await composer.press('Enter')
    await expect(page.getByText(`Answered by ${answer}`, { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    await expectActiveAccount(page, accountId)
  }
})

Then('the sidebar account source follows thread switches', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-source-switches-with-chat-and-clears-for-draft', async () => {
    const chats = page.getByRole('treeitem', { name: /^Fake thread title(?:\s|$)/u })
    await expect(chats).toHaveCount(2)
    await page.getByRole('button', { name: 'New session', exact: true }).first().click()
    await expect(usageStrip(page).locator('[data-active-account]')).toHaveCount(0)
    await chats.nth(1).click()
    await expect(page.getByText('Answered by ALPHA1', { exact: true })).toBeVisible()
    await expectActiveAccount(page, 'commandcode_work')
    await chats.nth(0).click()
    await expect(page.getByText('Answered by BRAVO2', { exact: true })).toBeVisible()
    await expectActiveAccount(page, 'commandcode_work_2')
  })
  await finishJourneyAssertions(page)
})

Then('the sidebar moves the current thread between accounts without the model picker', async ({ page }: { page: Page }) => {
  // Account creation and the two initial selections use the real picker. Switching below must not open it.
  const fake = fakeCommandCodeFor(page)
  const turns = () => fake.requests.filter(request => request.kind === 'turn')
  expect(turns().map(request => request.key)).toEqual(['e2e-fake-key-ALPHA1', 'e2e-fake-key-BRAVO2'])
  const chats = page.getByRole('treeitem', { name: /^Fake thread title(?:\s|$)/u })
  await expect(chats).toHaveCount(2)
  // The stock shell in this fixture has no ?thread route. Compare its URL without logging its launch token;
  // the real dialog API responses below provide the exact persisted Session identity.
  let threadUrl = page.url()
  let threadId: string | undefined
  const threadResponse = z.object({ result: z.object({ ok: z.literal(true), value: z.object({ output: threadAccountPreviewSchema }) }) })
  const waitForThreadResponse = (method: 'preview' | 'switch') =>
    page.waitForResponse(
      response => /\/api\/dshx-[0-9a-f]+\//u.test(new URL(response.url()).pathname) && new URL(response.url()).pathname.endsWith(`/${method}`),
    )
  const expectSameThread = (plan: z.infer<typeof threadAccountPreviewSchema>): void => {
    threadId ??= plan.sessionId
    expect(plan.sessionId).toBe(threadId)
  }
  const expectSameRoute = (): void => {
    expect(page.url() === threadUrl, 'The account action must preserve the native chat route.').toBe(true)
  }
  const originalAccounts = await readSavedAccounts(page)
  expect(originalAccounts.map(account => account.instanceId)).toEqual(['commandcode_work', 'commandcode_work_2'])
  let expectedAccounts = originalAccounts
  const picker = page.getByRole('button', { name: /^Select model/ })
  const expectSelection = async (accountId: string, model = 'gpt-6-luna'): Promise<void> => {
    await expect(picker).toHaveAttribute('aria-label', new RegExp(`^Select model, current ${accountId}/${model}(?:,|$)`, 'u'))
    await expect(page.getByRole('menuitem', { name: /^Model / })).toHaveCount(0)
    await expect(page.getByRole('menuitemradio')).toHaveCount(0)
  }
  const expectAccountOrder = async (): Promise<void> => {
    expect(await readSavedAccounts(page)).toEqual(expectedAccounts)
    const tiles = usageStrip(page).getByRole('button', { name: /^Command Code [12]:/u })
    await expect(tiles).toHaveCount(2)
    await expect(tiles.nth(0)).toHaveAttribute('aria-label', /^Command Code 1:/u)
    await expect(tiles.nth(1)).toHaveAttribute('aria-label', /^Command Code 2:/u)
  }
  const openSwitch = async (
    account: 1 | 2,
    keyboard = false,
    model = 'gpt-6-luna',
    strategy: 'same-model' | 'preferred-model' = 'same-model',
  ): Promise<z.infer<typeof threadAccountPreviewSchema>> => {
    const tile = usageStrip(page).getByRole('button', { name: new RegExp(`^Command Code ${account}: Weekly limit`, 'u') })
    if (keyboard) {
      await tile.focus()
      await tile.press('Shift+F10')
    } else await tile.click({ button: 'right' })
    const action = page.getByRole('menuitem', { name: 'Use this account for this thread', exact: true })
    await expect(action).toBeEnabled()
    await test.info().attach(`thread-account-menu-${account}`, {
      body: await page.getByRole('menu').screenshot({ path: test.info().outputPath(`thread-account-menu-${account}.png`), animations: 'disabled' }),
      contentType: 'image/png',
    })
    const response = waitForThreadResponse('preview')
    await action.click()
    const plan = threadResponse.parse(await (await response).json()).result.value.output
    expectSameThread(plan)
    expect(plan.instanceId).toBe(account === 1 ? 'commandcode_work' : 'commandcode_work_2')
    const dialog = page.getByRole('dialog', { name: 'Use account for this thread', exact: true })
    await expect(dialog.getByText(`Command Code ${account}`, { exact: true })).toBeVisible()
    await expect(dialog.getByText(`commandcode_work${account === 1 ? '' : '_2'}/${model}`, { exact: true })).toBeVisible()
    expect(plan.target).toMatchObject({ provider: account === 1 ? 'commandcode_work' : 'commandcode_work_2', model })
    expect(plan.strategy).toBe(strategy)
    if (strategy === 'same-model') {
      await expect(dialog).toContainText('Same model retained.')
    } else {
      expect(plan.strategy).toBe('preferred-model')
      await expect(dialog).not.toContainText('Same model retained.')
      await expect(dialog).toContainText('The first model in this account’s preferred order is shown above.')
    }
    await expect(dialog).toContainText('No message is sent automatically.')
    await expect(dialog.getByRole('button', { name: 'Use this account', exact: true })).toBeEnabled()
    return plan
  }
  const confirmSwitch = async (accountId: string, model = 'gpt-6-luna'): Promise<void> => {
    const before = turns().length
    const response = waitForThreadResponse('switch')
    await page.getByRole('dialog', { name: 'Use account for this thread', exact: true }).getByRole('button', { name: 'Use this account', exact: true }).click()
    const plan = threadResponse.parse(await (await response).json()).result.value.output
    expectSameThread(plan)
    expect(plan.target).toMatchObject({ provider: accountId, model })
    const success = page.getByRole('dialog', { name: 'Thread account changed', exact: true })
    await expect(success.getByRole('heading', { name: 'Thread account changed', exact: true })).toBeVisible()
    await success.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(success).toBeHidden()
    await expectSelection(accountId, model)
    expectSameRoute()
    await expectAccountOrder()
    expect(turns()).toHaveLength(before)
  }
  const ask = async (accountId: string, answer: string, question: string, model = 'gpt-6-luna'): Promise<void> => {
    const before = turns().length
    const previousAnswers = await page.getByText(`Answered by ${answer}`, { exact: true }).count()
    const composer = page.getByRole('textbox', { name: /\/ commands, @ files or sessions$/u })
    await composer.fill(question)
    await composer.press('Enter')
    await expect(page.getByText(`Answered by ${answer}`, { exact: true })).toHaveCount(previousAnswers + 1, { timeout: 30_000 })
    const requests = turns().slice(before)
    if (requests.length !== 1) {
      await test.info().attach('thread-account-request-diagnostics', {
        body: JSON.stringify(
          requests.map(request => ({
            account: request.key.slice(-6),
            messages: request.messages.map(message => ({
              role: message.role,
              characters: message.text.length,
              prefix: message.text.slice(0, 240),
              suffix: message.text.slice(-240),
              containsCurrentQuestion: message.text.includes(question),
            })),
          })),
          null,
          2,
        ),
        contentType: 'application/json',
      })
    }
    expect(requests.map(request => request.key)).toEqual([`e2e-fake-key-${answer}`])
    await expectActiveAccount(page, accountId)
    await expectSelection(accountId, model)
    expectSameRoute()
  }

  await recordAssertion(page, 'ai-accounts-thread-switch-cancel-has-no-effects', async () => {
    await openAccountsPanel(page)
    await openPageOptions(page)
    const distribution = page.getByRole('combobox', { name: 'Request distribution', exact: true })
    await distribution.click()
    await page.getByRole('option', { name: /Priority/u }).click()
    await expect(distribution).toHaveText('Priority')
    await page.keyboard.press('Escape')
    await chats.nth(0).click()
    await expect(page.getByText('Answered by BRAVO2', { exact: true })).toBeVisible()
    await expectSelection('commandcode_work_2')
    expectSameRoute()
    const before = turns().length
    await openSwitch(1)
    const dialog = page.getByRole('dialog', { name: 'Use account for this thread', exact: true })
    const viewport = page.viewportSize()
    try {
      for (const width of [360, 480]) {
        await page.setViewportSize({ width, height: 900 })
        const bounds = await dialog.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds?.x).toBeGreaterThanOrEqual(0)
        expect((bounds?.x ?? width) + (bounds?.width ?? width)).toBeLessThanOrEqual(width)
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
        await expect(dialog.getByRole('button', { name: 'Use this account', exact: true })).toBeInViewport()
        await test.info().attach(`thread-account-dialog-${width}`, {
          body: await dialog.screenshot({ path: test.info().outputPath(`thread-account-dialog-${width}.png`), animations: 'disabled' }),
          contentType: 'image/png',
        })
      }
    } finally {
      if (viewport !== null) await page.setViewportSize(viewport)
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expectSelection('commandcode_work_2')
    await expectActiveAccount(page, 'commandcode_work_2')
    expectSameRoute()
    await expectAccountOrder()
    expect(turns()).toHaveLength(before)
  })
  await recordAssertion(page, 'ai-accounts-thread-switch-targets-only-next-request', async () => {
    await openSwitch(1)
    await confirmSwitch('commandcode_work')
    await ask('commandcode_work', 'ALPHA1', 'Which account handles this next question?')
    await expect(page.getByText('Answered by BRAVO2', { exact: true })).toHaveCount(1)
    expectSameRoute()
  })
  await recordAssertion(page, 'ai-accounts-keyboard-thread-switch-overrides-priority', async () => {
    await openSwitch(2, true)
    await confirmSwitch('commandcode_work_2')
    await ask('commandcode_work_2', 'BRAVO2', 'And which account handles this question now?')
    await expect(page.getByText('Answered by ALPHA1', { exact: true })).toHaveCount(1)
    await expectAccountOrder()
    expectSameRoute()
    await chats.nth(1).click()
    await expectSelection('commandcode_work')
    await expectActiveAccount(page, 'commandcode_work')
    await expect(page.getByText('Answered by ALPHA1', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Answered by BRAVO2', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Verify the source of chat ALPHA1.', { exact: true })).toBeVisible()
    await chats.nth(0).click()
    expectSameRoute()
  })
  await recordAssertion(page, 'ai-accounts-thread-preference-survives-host-restart', async () => {
    const before = turns().length
    await restartScratchProfileInBrowser(page)
    await expect(chats).toHaveCount(2)
    await chats.nth(0).click()
    await expect(page.getByText('Verify the source of chat BRAVO2.', { exact: true })).toBeVisible()
    threadUrl = page.url()
    await expectSelection('commandcode_work_2')
    await openSwitch(1)
    await page.getByRole('dialog', { name: 'Use account for this thread', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click()
    expectSameRoute()
    await expect(page.getByText('Answered by ALPHA1', { exact: true })).toHaveCount(1)
    await expect(page.getByText('Answered by BRAVO2', { exact: true })).toHaveCount(2)
    await expectAccountOrder()
    expect(turns()).toHaveLength(before)
    await openAccountsPanel(page)
    await openPageOptions(page)
    await expect(page.getByRole('combobox', { name: 'Request distribution', exact: true })).toHaveText('Priority')
    await page.keyboard.press('Escape')
    await chats.nth(0).click()
    await ask('commandcode_work_2', 'BRAVO2', 'Does this account choice still apply after restarting?')
    await expectAccountOrder()
  })
  await recordAssertion(page, 'ai-accounts-thread-switch-declares-preferred-model-fallback', async () => {
    await openAccountsPanel(page)
    await accountCard(page, 'Command Code 1').getByRole('button', { name: 'Select Command Code 1', exact: true }).click()
    await selectedAccount(page).getByRole('tab', { name: 'Models', exact: true }).click()
    const show = selectedAccount(page).getByRole('switch', { name: 'Show gpt-6-luna in the picker', exact: true })
    await expect(show).toBeChecked()
    await show.click()
    await expect(show).not.toBeChecked()
    expectedAccounts = originalAccounts.map(account =>
      account.instanceId === 'commandcode_work'
        ? { ...account, inheritModelSettings: false, hiddenModelIds: [...account.hiddenModelIds, 'gpt-6-luna'] }
        : account,
    )
    await expect.poll(() => readSavedAccounts(page)).toEqual(expectedAccounts)
    await chats.nth(0).click()
    await expectSelection('commandcode_work_2')
    const before = turns().length
    const fallbackModel = 'deepseek/deepseek-v4-flash'
    await openSwitch(1, false, fallbackModel, 'preferred-model')
    await test.info().attach('thread-account-preferred-model', {
      body: await page.getByRole('dialog', { name: 'Use account for this thread', exact: true }).screenshot({
        path: test.info().outputPath('thread-account-preferred-model.png'),
        animations: 'disabled',
      }),
      contentType: 'image/png',
    })
    expect(turns()).toHaveLength(before)
    await confirmSwitch('commandcode_work', fallbackModel)
    await ask('commandcode_work', 'ALPHA1', 'Which account serves this conversation with its available model?', fallbackModel)
    await expect(page.getByText('Verify the source of chat BRAVO2.', { exact: true })).toBeVisible()
    await expect(page.getByText('Answered by BRAVO2', { exact: true })).toHaveCount(3)
    await expectAccountOrder()
    expectSameRoute()
  })
  await recordAssertion(page, 'ai-accounts-thread-long-context-advice-does-not-compact', async () => {
    // This last action creates real persisted history using a supported fixture directive. No later user turn
    // is sent: stock prompt-preparation compaction is separate from the dialog's advisory-only behavior.
    const retainedDetail = 'retain this detail '.repeat(6_000).trimEnd()
    const before = turns().length
    const composer = page.getByRole('textbox', { name: /\/ commands, @ files or sessions$/u })
    await composer.fill(`Keep this detail in our conversation. [[answer ${retainedDetail}]]`)
    await composer.press('Enter')
    const retainedHistory = page.getByText(/^retain this detail /u)
    await expect(retainedHistory).toBeVisible({ timeout: 30_000 })
    expect(await retainedHistory.textContent()).toBe(retainedDetail)
    expect(
      turns()
        .slice(before)
        .map(request => request.key),
    ).toEqual(['e2e-fake-key-ALPHA1'])
    const afterHistory = turns().length
    const plan = await openSwitch(2, false, 'deepseek/deepseek-v4-flash')
    const dialog = page.getByRole('dialog', { name: 'Use account for this thread', exact: true })
    if (plan.context === null) {
      test.info().annotations.push({ type: 'unverified', description: 'The scratch profile did not expose native token-meter context advice.' })
    } else {
      expect(plan.context.estimatedTokens).toBeGreaterThanOrEqual(32_000)
      if (plan.context.targetWindow !== null) expect(plan.context.estimatedTokens).toBeLessThan(plan.context.targetWindow * 0.75)
      expect(plan.context.suggestCompaction).toBe(true)
      await expect(dialog.getByText('Consider compacting this long conversation', { exact: true })).toBeVisible()
      await expect(dialog).toContainText('Estimated current context:')
      await expect(dialog).toContainText('may not share the previous account’s prompt cache.')
      await expect(dialog).toContainText('summarizing costs tokens and can omit details.')
      await expect(dialog).toContainText('The transcript stays available. No savings are guaranteed.')
      await expect(dialog).toContainText('This account switch does not compact the conversation.')
      await expect(dialog).toContainText('Native automatic-compaction settings still apply to later requests.')
      await expect(dialog).toContainText('Native compaction may use the configured summarizer or the previous request’s account,')
      await expect(dialog).toContainText('not necessarily the account selected here.')
      await test.info().attach('thread-account-context-advice', {
        body: await dialog.screenshot({ path: test.info().outputPath('thread-account-context-advice.png'), animations: 'disabled' }),
        contentType: 'image/png',
      })
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expectSelection('commandcode_work', 'deepseek/deepseek-v4-flash')
    expect(turns()).toHaveLength(afterHistory)
    expect(await retainedHistory.textContent()).toBe(retainedDetail)
    expectSameRoute()
  })
  await finishJourneyAssertions(page)
})

Then('the usage strip shows its short name, renamed from AI Accounts settings', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-strip-shows-initials-by-default', () => expect(stripMeter(page)).toContainText('CC'))
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Short names in the strip', exact: true })).toBeChecked()
  const shortName = page.getByRole('textbox', { name: 'Short name for Command Code 1', exact: true })
  await shortName.fill('WRK')
  await shortName.press('Enter')
  await page.keyboard.press('Escape')
  await recordAssertion(page, 'ai-accounts-strip-uses-the-configured-short-name', () => expect(stripMeter(page)).toContainText('WRK'))
})

Then("the strip's context menu hides and shows short names", async ({ page }: { page: Page }) => {
  await stripMeter(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Hide short names', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-strip-hides-short-names', () => expect(stripMeter(page)).not.toContainText('WRK'))
  await stripMeter(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show short names', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-strip-shows-short-names-again', () => expect(stripMeter(page)).toContainText('WRK'))
  await finishJourneyAssertions(page)
})

When('a second healthy Command Code account is added', async ({ page }: { page: Page }) => {
  await addCommandCodeAccount(page, { name: 'Command Code 2', routeSlug: 'commandcode_work_2', key: 'e2e-fake-key-BRAVO2' })
})

When('the second Command Code account is moved earlier on the accounts page', async ({ page }: { page: Page }) => {
  await moveAccountEarlier(page, 'Command Code 2')
  await accountCard(page, 'Command Code 2').getByRole('button', { name: 'Actions for Command Code 2', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Move Command Code 2 earlier in account order', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
})

Then('the sidebar tiles follow the shared priority order after reload', async ({ page }: { page: Page }) => {
  const assertOrder = async (): Promise<void> => {
    const tiles = usageStrip(page).getByRole('button', { name: /^Command Code [12]:/ })
    await expect(tiles).toHaveCount(2)
    await expect(tiles.nth(0)).toHaveAttribute('aria-label', /^Command Code 2:/)
    await expect(tiles.nth(1)).toHaveAttribute('aria-label', /^Command Code 1:/)
    const cards = providerAccounts(page)
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: /^Select Command Code [12]$/u }) })
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('Command Code 2')
    await expect(cards.nth(1)).toContainText('Command Code 1')
  }
  await recordAssertion(page, 'ai-accounts-priority-order-syncs-sidebar', assertOrder)
  await page.reload()
  await openAccountsPanel(page)
  await recordAssertion(page, 'ai-accounts-priority-order-sync-persists', assertOrder)
  await recordAssertion(page, 'ai-accounts-sidebar-drag-updates-real-priority', async () => {
    const drag = (name: string) =>
      usageStrip(page)
        .locator('[draggable="true"]')
        .filter({ has: page.getByRole('button', { name: new RegExp(`^${name}:`) }) })
    await drag('Command Code 1').dragTo(drag('Command Code 2'))
    await expect(providerAccounts(page).getByRole('listitem').nth(0)).toContainText('Command Code 1')
    await expect(
      usageStrip(page)
        .getByRole('button', { name: /^Command Code [12]:/ })
        .nth(0),
    ).toHaveAttribute('aria-label', /^Command Code 1:/)
    expect(
      await usageStrip(page)
        .getByRole('button', { name: 'Add AI account', exact: true })
        .evaluate(element => element.closest('[draggable]') === null),
    ).toBe(true)
    await page.reload()
    await openAccountsPanel(page)
    await expect(providerAccounts(page).getByRole('listitem').nth(0)).toContainText('Command Code 1')
  })
  await finishJourneyAssertions(page)
})

const usagePopover = (page: Page) => page.getByRole('region', { name: 'AI account usage', exact: true })
const disabledAccountBefore = new WeakMap<Page, Awaited<ReturnType<typeof readSavedAccounts>>>()
const disabledPreview = (page: Page) =>
  usageStrip(page)
    .getByRole('button', { name: /^Command Code 1:/u })
    .and(page.locator('[aria-label*="OFF"]'))
const expectDisabledQuotaPreview = async (page: Page): Promise<void> => {
  const tile = disabledPreview(page)
  await expect(tile).toBeVisible()
  await expect(tile).toBeEnabled()
  await expect(tile).toHaveClass(/dshx:opacity-50/u)
  await expect(tile).toHaveAttribute('aria-label', /^Command Code 1: Weekly limit: 10% left, resets in 2d 23h\. OFF(?:\.|$)/u)
  await expect(tile.getByText('10%', { exact: true })).toBeVisible()
  await expect(tile.getByText('↻ 2d 23h', { exact: true })).toBeVisible()
  const off = tile.getByText('OFF', { exact: true })
  const shortName = off.locator('..').locator(':scope > span').first()
  await expect(off).toBeVisible()
  await expect(shortName).toBeVisible()
  await expect(shortName).not.toHaveText(/^(?:OFF)?$/u)
  for (const text of [shortName, off, tile.getByText('10%', { exact: true }), tile.getByText('↻ 2d 23h', { exact: true })]) {
    await expect(text).toHaveClass(/dshx:text-muted-foreground/u)
    expect(await text.evaluate(element => getComputedStyle(element).color)).toBe(await off.evaluate(element => getComputedStyle(element).color))
  }
  const nameBounds = await shortName.boundingBox()
  const offBounds = await off.boundingBox()
  const tileBounds = await tile.boundingBox()
  expect(nameBounds).not.toBeNull()
  expect(offBounds).not.toBeNull()
  expect(tileBounds).not.toBeNull()
  expect(offBounds?.x).toBe(nameBounds?.x)
  expect(offBounds?.y).toBeGreaterThanOrEqual((nameBounds?.y ?? 0) + (nameBounds?.height ?? 0))
  expect((offBounds?.y ?? 0) + (offBounds?.height ?? 0)).toBeLessThanOrEqual((tileBounds?.y ?? 0) + (tileBounds?.height ?? 0))
  expect(await off.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeLessThanOrEqual(9)
  await expect(tile).not.toContainText('Disabled')
  expect(tileBounds?.height).toBe(32)
  expect(await tile.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
}
const measureQuotaWindow = (element: Element) => {
  const indicator = element.querySelector('[data-slot="progress-indicator"]')
  if (indicator === null) throw new Error('The quota window has no progress indicator.')
  const track = element.getBoundingClientRect()
  const fill = indicator.getBoundingClientRect()
  const style = getComputedStyle(indicator)
  return {
    name: element.getAttribute('aria-label'),
    width: track.width,
    visiblePercent: (Math.max(0, Math.min(track.right, fill.right) - Math.max(track.left, fill.left)) / track.width) * 100,
    indicatorColor: style.backgroundColor,
    indicatorTransform: style.transform,
  }
}
const expectDisabledPopoverQuota = async (page: Page): Promise<void> => {
  const card = quotaAccountCard(page, 'Command Code 1')
  await expect(card.getByText('OFF', { exact: true })).toBeVisible()
  await expect(card.getByText('75% left', { exact: true })).toBeVisible()
  await expect(card.getByText('10% left', { exact: true })).toBeVisible()
  for (const [window, percent] of [
    ['Current session', 75],
    ['Weekly limit', 10],
  ] as const) {
    const meter = card.getByRole('progressbar', { name: `Command Code 1 ${window} remaining`, exact: true })
    await expect(meter).toBeVisible()
    expect((await meter.evaluate(measureQuotaWindow)).width).toBeGreaterThan(0)
    // The kit exposes value through the actual translated fill, not aria-valuenow on its Radix Root.
    await expect.poll(async () => (await meter.evaluate(measureQuotaWindow)).visiblePercent).toBeCloseTo(percent, 1)
  }
  for (const percent of ['75% left', '10% left']) {
    await expect(card.getByText(percent, { exact: true })).toHaveClass(/dshx:text-muted-foreground/u)
  }
  const mutedColor = await card.getByText('10% left', { exact: true }).evaluate(element => getComputedStyle(element).color)
  const meters = card.getByRole('progressbar')
  await expect(meters).toHaveCount(2)
  for (const meter of await meters.all()) {
    await expect(meter).toBeVisible()
    expect(await meter.locator('[data-slot="progress-indicator"]').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(mutedColor)
  }
  await expect(card.getByText(/^Resets in (59|60)m$/u)).toBeVisible()
  await expect(card.getByText('Resets in 2d 23h', { exact: true })).toBeVisible()
  await expect(card.getByText('Disabled', { exact: true })).toHaveCount(0)
}
const expectPreviewOrder = async (page: Page): Promise<void> => {
  const tiles = usageStrip(page).getByRole('button', { name: /^Command Code [12]:/u })
  await expect(tiles).toHaveCount(2)
  await expect(tiles.nth(0)).toHaveAttribute('aria-label', /^Command Code 1:/u)
  await expect(tiles.nth(1)).toHaveAttribute('aria-label', /^Command Code 2:/u)
}
const expectEnabledSave = async (page: Page, enabled: boolean, action: () => Promise<void>): Promise<void> => {
  const before = disabledAccountBefore.get(page)
  if (before === undefined) throw new Error('Missing original synthetic accounts for enabled-state persistence assertion.')
  const expected = before.map(account => (account.instanceId === 'commandcode_work' ? { ...account, enabled } : account))
  const response = page.waitForResponse(candidate => {
    const path = new URL(candidate.url()).pathname
    if (!/\/api\/dshx-[0-9a-f]+\/save$/u.test(path)) return false
    const input = z.object({ payload: z.object({ input: z.object({ draft: accountDraftSchema }) }) }).safeParse(candidate.request().postDataJSON())
    return input.success && input.data.payload.input.draft.instanceId === 'commandcode_work'
  })
  await action()
  const saved = await response
  expect(saved.ok()).toBe(true)
  const draft = z.object({ payload: z.object({ input: z.object({ draft: accountDraftSchema }) }) }).parse(saved.request().postDataJSON()).payload.input.draft
  expect(draft).toEqual(expected.find(account => account.instanceId === 'commandcode_work'))
  const result = z.object({ result: z.object({ ok: z.literal(true), value: z.object({ output: accountsFileSchema }) }) }).parse(await saved.json())
  // The Host returns observed identity/health as well as saved settings; compare the complete authored draft projection.
  expect(result.result.value.output.accounts.map(account => accountDraftSchema.parse(account))).toEqual(expected)
  expect(result.result.value.output.accounts.find(account => account.instanceId === 'commandcode_work')?.state).toBe(enabled ? 'healthy' : 'disabled')
  await expect.poll(() => readSavedAccounts(page)).toEqual(expected)
}

Then('disabling an account in settings keeps its dimmed sidebar preview', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-settings-disable-preserves-preview', async () => {
    await openAccountsPanel(page)
    const before = await readSavedAccounts(page)
    expect(before.map(account => account.instanceId)).toEqual(['commandcode_work', 'commandcode_work_2'])
    expect(before.every(account => account.enabled)).toBe(true)
    disabledAccountBefore.set(page, before)
    await accountCard(page, 'Command Code 1').getByRole('button', { name: 'Select Command Code 1', exact: true }).click()
    await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
    const routing = selectedAccount(page).getByRole('switch', { name: 'Enable for model routing', exact: true })
    await expect(routing).toBeChecked()
    await expectEnabledSave(page, false, () => routing.click())
    await expect(routing).not.toBeChecked()
    await expectDisabledQuotaPreview(page)
    await expectPreviewOrder(page)
    expect(await usageStrip(page).evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')
    await disabledPreview(page).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Use this account for this thread', exact: true })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: 'Hide Command Code 1', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: test.info().outputPath('disabled-account-sidebar-preview.png'), animations: 'disabled' })
  })
})

Then('usage popover toggles persist enabled state without hiding or reordering accounts', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-popover-toggle-persists-without-hiding', async () => {
    const before = disabledAccountBefore.get(page)
    if (before === undefined) throw new Error('Missing original synthetic accounts for popover toggle assertion.')
    const turnCount = fakeCommandCodeFor(page).requests.length
    const route = page.url()
    await disabledPreview(page).click()
    const first = quotaAccountCard(page, 'Command Code 1')
    const second = quotaAccountCard(page, 'Command Code 2')
    const enabled = first.getByRole('switch', { name: 'Enable Command Code 1', exact: true })
    await expect(usagePopover(page)).toBeVisible()
    await expect(first.getByText('Enable account', { exact: true })).toBeVisible()
    await expect(enabled).not.toBeChecked()
    await expect(second.getByRole('switch', { name: 'Enable Command Code 2', exact: true })).toBeChecked()
    await expectDisabledPopoverQuota(page)
    await expect(first.locator(':scope > div').filter({ has: page.locator('header') })).toHaveClass(/dshx:opacity-50/u)
    expect(await enabled.evaluate(element => element.closest('[class~="dshx:opacity-50"]') === null)).toBe(true)
    await expect(usagePopover(page).getByRole('button', { name: '1 hidden by you', exact: true })).toHaveCount(0)
    await expectEnabledSave(page, true, () => enabled.click())
    await expect(enabled).toBeChecked()
    await expect(usagePopover(page)).toBeVisible()
    await expect(stripMeter(page)).toBeVisible()
    await expect(stripMeter(page)).not.toHaveAttribute('aria-label', /OFF/u)
    await expect(stripMeter(page).getByText('OFF', { exact: true })).toHaveCount(0)
    await expect(stripMeter(page)).not.toHaveClass(/dshx:opacity-50/u)
    await expect(first.locator(':scope > div').filter({ has: page.locator('header') })).not.toHaveClass(/dshx:opacity-50/u)
    await expectPreviewOrder(page)
    const saveStartedAt = Date.now()
    const saves: { method: string; instanceId: string; enabled: boolean; elapsedMs: number }[] = []
    const snapshots: { point: string; accounts: { instanceId: string; enabled: boolean }[] }[] = []
    const layoutMeasurements: object[] = []
    const captureLayout = async (width: number): Promise<void> => {
      layoutMeasurements.push({
        width,
        tile: await disabledPreview(page).evaluate(element => ({
          height: element.getBoundingClientRect().height,
          opacity: getComputedStyle(element).opacity,
          labels: [...element.querySelectorAll('span')]
            .filter(span => span.childElementCount === 0)
            .map(span => {
              const box = span.getBoundingClientRect()
              const style = getComputedStyle(span)
              return { text: span.textContent, x: box.x, y: box.y, width: box.width, height: box.height, color: style.color, fontSize: style.fontSize }
            }),
        })),
        windows: await Promise.all((await first.getByRole('progressbar').all()).map(meter => meter.evaluate(measureQuotaWindow))),
      })
    }
    const capturePersistence = async (point: string) => {
      const accounts = await readSavedAccounts(page)
      snapshots.push({ point, accounts: accounts.map(account => ({ instanceId: account.instanceId, enabled: account.enabled })) })
      return accounts
    }
    const collectSave = (request: Request): void => {
      if (!/\/api\/dshx-[0-9a-f]+\/save$/u.test(new URL(request.url()).pathname)) return
      const input = z.object({ payload: z.object({ input: z.object({ draft: accountDraftSchema }) }) }).safeParse(request.postDataJSON())
      if (input.success) {
        const { instanceId, enabled } = input.data.payload.input.draft
        saves.push({ method: 'save', instanceId, enabled, elapsedMs: Date.now() - saveStartedAt })
      }
    }
    page.on('request', collectSave)
    try {
      await expectEnabledSave(page, false, () => enabled.click())
      await expect(enabled).not.toBeChecked()
      await expect(usagePopover(page)).toBeVisible()
      await expect(first.locator(':scope > div').filter({ has: page.locator('header') })).toHaveClass(/dshx:opacity-50/u)
      expect(await enabled.evaluate(element => element.closest('[class~="dshx:opacity-50"]') === null)).toBe(true)
      await expectDisabledQuotaPreview(page)
      await expectDisabledPopoverQuota(page)
      await expectPreviewOrder(page)
      await captureLayout(page.viewportSize()?.width ?? 0)
      await page.mouse.move(0, 0)
      await page.screenshot({ path: test.info().outputPath('disabled-account-usage-popover.png'), animations: 'disabled' })
      const viewport = page.viewportSize()
      try {
        for (const width of [360, 480]) {
          await page.keyboard.press('Escape')
          await page.setViewportSize({ width, height: 900 })
          // Wait for the native responsive remount instead of reading the outgoing desktop sidebar.
          const openSidebar = page.getByRole('button', { name: 'Open sidebar', exact: true })
          await expect(openSidebar).toBeVisible()
          await openSidebar.click()
          await expectDisabledQuotaPreview(page)
          await expectPreviewOrder(page)
          await page.mouse.move(0, 0)
          await page.screenshot({ path: test.info().outputPath(`disabled-account-sidebar-preview-${width}.png`), animations: 'disabled' })
          await disabledPreview(page).click()
          await expect(usagePopover(page)).toBeVisible()
          await expectDisabledPopoverQuota(page)
          await expect(enabled).toBeInViewport()
          const bounds = await usagePopover(page).boundingBox()
          expect(bounds).not.toBeNull()
          expect(bounds?.x).toBeGreaterThanOrEqual(0)
          expect((bounds?.x ?? width) + (bounds?.width ?? width)).toBeLessThanOrEqual(width)
          expect(await usagePopover(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
          await captureLayout(width)
          await page.screenshot({ path: test.info().outputPath(`disabled-account-popover-${width}.png`), animations: 'disabled' })
          await page.keyboard.press('Escape')
          await expect(usagePopover(page)).toBeHidden()
          await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
          await expect(openSidebar).toBeVisible()
        }
      } catch (cause) {
        await page.screenshot({ path: test.info().outputPath('disabled-account-responsive-failure.png'), animations: 'disabled' })
        throw cause
      } finally {
        if (viewport !== null) await page.setViewportSize(viewport)
      }
      expect(await capturePersistence('before-reload')).toEqual(
        before.map(account => (account.instanceId === 'commandcode_work' ? { ...account, enabled: false } : account)),
      )
      await page.keyboard.press('Escape')
      await page.reload()
      expect(await capturePersistence('after-reload')).toEqual(
        before.map(account => (account.instanceId === 'commandcode_work' ? { ...account, enabled: false } : account)),
      )
      await expectDisabledQuotaPreview(page)
      await expectPreviewOrder(page)
      await disabledPreview(page).click()
      await expectDisabledPopoverQuota(page)
      await expect(enabled).not.toBeChecked()
      await expect(second.getByRole('switch', { name: 'Enable Command Code 2', exact: true })).toBeChecked()
      expect(await readSavedAccounts(page)).toEqual(
        before.map(account => (account.instanceId === 'commandcode_work' ? { ...account, enabled: false } : account)),
      )
      await page.keyboard.press('Escape')
      await disabledPreview(page).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Hide Command Code 1', exact: true }).click()
      await expect(usageStrip(page).getByRole('button', { name: /^Command Code 1:/u })).toHaveCount(0)
      await usageStrip(page)
        .getByRole('button', { name: /^Command Code 2:/u })
        .click()
      await usagePopover(page).getByRole('button', { name: '1 hidden by you', exact: true }).click()
      await usagePopover(page).getByRole('button', { name: 'Show', exact: true }).click()
      await expectDisabledQuotaPreview(page)
      await expectDisabledPopoverQuota(page)
      await expect(enabled).not.toBeChecked()
      await expectPreviewOrder(page)
      expect(await readSavedAccounts(page)).toEqual(
        before.map(account => (account.instanceId === 'commandcode_work' ? { ...account, enabled: false } : account)),
      )
      expect(saves.map(({ method, instanceId, enabled }) => ({ method, instanceId, enabled }))).toEqual([
        { method: 'save', instanceId: 'commandcode_work', enabled: false },
      ])
      expect(page.url() === route, 'The popover must preserve the native route.').toBe(true)
      expect(fakeCommandCodeFor(page).requests).toHaveLength(turnCount)
    } finally {
      page.off('request', collectSave)
      await capturePersistence('final-state')
      const diagnosticsPath = test.info().outputPath('account-enabled-persistence.json')
      await writeFile(diagnosticsPath, JSON.stringify({ saves, snapshots, layoutMeasurements }, null, 2))
      await test.info().attach('account-enabled-persistence.json', { path: diagnosticsPath, contentType: 'application/json' })
    }
  })
  await finishJourneyAssertions(page)
})

const unavailableAccountKey = 'e2e-fake-key-ALPHA1'
const unavailableBefore = new WeakMap<Page, Awaited<ReturnType<typeof readSavedAccounts>>>()
const unavailableTile = (page: Page) => usageStrip(page).getByRole('button', { name: /^Command Code 1: Sign in again\./u })
const quotaAccountCard = (page: Page, name: string) =>
  usagePopover(page)
    .locator('article')
    .filter({ has: page.getByText(name, { exact: true }) })
const expectCanonicalQuotaOrder = async (page: Page): Promise<void> => {
  const tiles = usageStrip(page).getByRole('button', { name: /^Command Code [12]:/u })
  await expect(tiles).toHaveCount(2)
  await expect(tiles.nth(0)).toHaveAttribute('aria-label', /^Command Code 2:/u)
  await expect(tiles.nth(1)).toHaveAttribute('aria-label', /^Command Code 1:/u)
}

When('two verified accounts use a controllable loopback quota provider', async ({ page }: { page: Page }) => {
  await startControllableQuotaCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', routeSlug: 'commandcode_work', key: unavailableAccountKey })
  await addCommandCodeAccount(page, { name: 'Command Code 2', routeSlug: 'commandcode_work_2', key: 'e2e-fake-key-BRAVO2' })
  await moveAccountEarlier(page, 'Command Code 2')
  await expectCanonicalQuotaOrder(page)
  await selectedAccount(page).getByRole('tab', { name: 'Usage', exact: true }).click()
  const before = await readSavedAccounts(page)
  expect(before.map(account => account.instanceId)).toEqual(['commandcode_work_2', 'commandcode_work'])
  expect(before.every(account => account.enabled)).toBe(true)
  unavailableBefore.set(page, before)
})

Then('an expired quota login keeps its sidebar identity without inventing a percentage', async ({ page }: { page: Page }) => {
  await stripMeter(page).click()
  await expect(quotaAccountCard(page, 'Command Code 1').getByRole('progressbar')).toHaveCount(2)
  const beforeReads = setFakeQuotaStatus(page, unavailableAccountKey, 401)
  await usagePopover(page).getByRole('button', { name: 'Refresh usage', exact: true }).click()
  await expect.poll(() => fakeQuotaReads(page, unavailableAccountKey)).toBeGreaterThan(beforeReads)
  await recordAssertion(page, 'ai-accounts-unavailable-sidebar-remains-visible', async () => {
    await expect(unavailableTile(page)).toBeVisible()
    await expect(unavailableTile(page)).toContainText('Sign in again')
    await expect(unavailableTile(page)).not.toContainText('%')
    await expect(unavailableTile(page).getByRole('progressbar')).toHaveCount(0)
    await expectCanonicalQuotaOrder(page)
    const unavailable = quotaAccountCard(page, 'Command Code 1')
    await expect(unavailable).toContainText('Sign in again')
    await expect(unavailable).toContainText('Command Code rejected this key.')
    await expect(unavailable).not.toContainText('%')
    await expect(unavailable.getByRole('progressbar')).toHaveCount(0)
    await expect(usagePopover(page).getByRole('button', { name: /hidden|unavailable account/iu })).toHaveCount(0)
    expect(await readSavedAccounts(page)).toEqual(unavailableBefore.get(page))
  })
  const hostLabels = usagePopover(page).locator('article header span[title]:not([title^="Subscription plan:"])')
  const originals = await hostLabels.allTextContents()
  try {
    await hostLabels.evaluateAll(elements => {
      for (const element of elements) element.textContent = 'scratch-host'
    })
    await page.screenshot({ path: test.info().outputPath('sidebar-unavailable-accounts.png') })
  } finally {
    await hostLabels.evaluateAll((elements, values) => {
      elements.forEach((element, index) => {
        element.textContent = values[index] ?? ''
      })
    }, originals)
  }
  await recordAssertion(page, 'ai-accounts-unavailable-card-reconnects-existing-id', async () => {
    const before = await readSavedAccounts(page)
    const existing = before.find(account => account.instanceId === 'commandcode_work')
    if (existing === undefined || existing.apiKeyEnv === '') throw new Error('The synthetic existing account must retain its verified credential reference.')
    const requests: Request[] = []
    const collect = (request: Request): void => {
      if (/\/api\/dshx-[0-9a-f]+\//u.test(new URL(request.url()).pathname)) requests.push(request)
    }
    const method = (request: Request): string => new URL(request.url()).pathname.split('/').at(-1) ?? ''
    const forbidden = new Set([
      'begin',
      'beginCopilotLogin',
      'completeAccountConnection',
      'stageAccountConnectionKey',
      'importAccountConnectionKey',
      'save',
      'createSetupAccount',
    ])
    page.on('request', collect)
    try {
      await expect(quotaAccountCard(page, 'Command Code 2').getByRole('button', { name: 'Reauthenticate', exact: true })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await unavailableTile(page).click()
      await expect(quotaAccountCard(page, 'Command Code 1').getByRole('button', { name: 'Reauthenticate', exact: true })).toBeVisible()
      await expect(quotaAccountCard(page, 'Command Code 2')).toBeVisible()
      await expect(page.getByRole('dialog', { name: /^Reconnect Command Code 1/u })).toHaveCount(0)
      expect(requests.filter(request => method(request) === 'prepareAccountConnection' || forbidden.has(method(request)))).toHaveLength(0)
      expect(await readSavedAccounts(page)).toEqual(before)

      await quotaAccountCard(page, 'Command Code 1').getByRole('button', { name: 'Reauthenticate', exact: true }).click()
      const reconnect = page.getByRole('dialog', { name: 'Reconnect Command Code 1', exact: true })
      await expect(reconnect).toBeVisible()
      await expect(usagePopover(page)).toBeHidden()
      await expect(reconnect.getByRole('button', { name: 'Verify and reconnect', exact: true })).toBeVisible()
      await expect(reconnect.getByRole('button', { name: 'Use existing credential', exact: true })).toHaveAttribute('aria-pressed', 'true')
      const preparations = requests.filter(request => method(request) === 'prepareAccountConnection')
      expect(preparations).toHaveLength(1)
      expect(
        z.object({ payload: z.object({ input: z.object({ existingInstanceId: z.string() }) }) }).parse(preparations[0]?.postDataJSON()).payload.input
          .existingInstanceId,
      ).toBe(existing.instanceId)
      expect(requests.filter(request => forbidden.has(method(request)))).toHaveLength(0)
      expect(await readSavedAccounts(page)).toEqual(before)
      await reconnect.getByRole('button', { name: 'Close', exact: true }).first().click()
      await expect(reconnect).toBeHidden()
      expect(await readSavedAccounts(page)).toEqual(before)
      expect(requests.filter(request => forbidden.has(method(request)))).toHaveLength(0)
      expect(fakeCommandCodeFor(page).requests).toHaveLength(0)
      await unavailableTile(page).click()
      await expect(quotaAccountCard(page, 'Command Code 1').getByRole('button', { name: 'Reauthenticate', exact: true })).toBeVisible()
      expect(requests.filter(request => method(request) === 'prepareAccountConnection')).toHaveLength(1)
    } finally {
      page.off('request', collect)
    }
  })
  await recordAssertion(page, 'ai-accounts-rejected-reconnect-starts-fresh-operation', async () => {
    const before = await readSavedAccounts(page)
    const existing = before.find(account => account.instanceId === 'commandcode_work')
    if (existing === undefined) throw new Error('Missing synthetic saved account for reconnect retry.')
    const requests: Request[] = []
    const method = (request: Request): string => new URL(request.url()).pathname.split('/').at(-1) ?? ''
    const collect = (request: Request): void => {
      if (/\/api\/dshx-[0-9a-f]+\//u.test(new URL(request.url()).pathname)) requests.push(request)
    }
    const preparationInput = z.object({ payload: z.object({ input: z.object({ requestId: z.uuid(), existingInstanceId: z.string() }) }) })
    const connectionResponse = z.object({ result: z.object({ ok: z.literal(true), value: z.object({ output: accountConnectionSnapshotSchema }) }) })
    page.on('request', collect)
    try {
      await quotaAccountCard(page, 'Command Code 1').getByRole('button', { name: 'Reauthenticate', exact: true }).click()
      const reconnect = page.getByRole('dialog', { name: 'Reconnect Command Code 1', exact: true })
      await expect(reconnect).toBeVisible()
      const initial = requests.filter(request => method(request) === 'prepareAccountConnection')
      expect(initial).toHaveLength(1)
      const first = preparationInput.parse(initial[0]?.postDataJSON()).payload.input
      expect(first.existingInstanceId).toBe(existing.instanceId)
      const terminalResponse = page.waitForResponse(async response => {
        if (!new URL(response.url()).pathname.endsWith('/getAccountConnection')) return false
        const parsed = connectionResponse.safeParse(await response.json())
        return parsed.success && parsed.data.result.value.output.operationId === first.requestId && parsed.data.result.value.output.status === 'discarded'
      })
      await reconnect.getByRole('button', { name: 'Verify and reconnect', exact: true }).click()
      const terminal = connectionResponse.parse(await (await terminalResponse).json()).result.value.output
      expect(terminal.account).toBeNull()
      expect(terminal.expiresAt).toBeGreaterThan(Date.now())
      const unavailable = page.getByRole('dialog', { name: 'Reconnect account', exact: true })
      await expect(unavailable).toBeVisible()
      await expect(unavailable).toContainText('Your saved account is unchanged')
      await expect(unavailable).not.toContainText('expired')
      expect(await readSavedAccounts(page)).toEqual(before)
      await unavailable.getByRole('button', { name: 'Start again', exact: true }).click()
      await expect(reconnect).toBeVisible()
      const preparations = requests.filter(request => method(request) === 'prepareAccountConnection')
      expect(preparations).toHaveLength(2)
      const second = preparationInput.parse(preparations[1]?.postDataJSON()).payload.input
      expect(second.requestId).not.toBe(first.requestId)
      expect(second.existingInstanceId).toBe(existing.instanceId)
      await expect(reconnect.getByRole('button', { name: 'Use existing credential', exact: true })).toHaveAttribute('aria-pressed', 'true')
      expect(requests.filter(request => method(request) === 'completeAccountConnection')).toHaveLength(1)
      expect(
        requests.filter(request =>
          new Set(['begin', 'beginCopilotLogin', 'stageAccountConnectionKey', 'importAccountConnectionKey', 'save', 'createSetupAccount']).has(method(request)),
        ),
      ).toHaveLength(0)
      expect(await readSavedAccounts(page)).toEqual(before)
      await reconnect.getByRole('button', { name: 'Close', exact: true }).first().click()
      await expect(reconnect).toBeHidden()
      expect(await readSavedAccounts(page)).toEqual(before)
      expect(fakeCommandCodeFor(page).requests).toHaveLength(0)
      await unavailableTile(page).click()
      await expect(quotaAccountCard(page, 'Command Code 1').getByRole('button', { name: 'Reauthenticate', exact: true })).toBeVisible()
    } finally {
      page.off('request', collect)
    }
  })
})

Then('quota recovery and explicit hiding preserve saved account identity and order', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await unavailableTile(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Hide Command Code 1', exact: true }).click()
  await expect(usageStrip(page).getByRole('button', { name: /^Command Code 1:/u })).toHaveCount(0)
  const healthy = usageStrip(page).getByRole('button', { name: /^Command Code 2:/u })
  await healthy.click()
  await usagePopover(page).getByRole('button', { name: '1 hidden by you', exact: true }).click()
  await usagePopover(page).getByRole('button', { name: 'Show', exact: true }).click()
  await expect(unavailableTile(page)).toBeVisible()
  await expectCanonicalQuotaOrder(page)
  const beforeReads = setFakeQuotaStatus(page, unavailableAccountKey, 200)
  await usagePopover(page).getByRole('button', { name: 'Refresh usage', exact: true }).click()
  await expect.poll(() => fakeQuotaReads(page, unavailableAccountKey)).toBeGreaterThan(beforeReads)
  await recordAssertion(page, 'ai-accounts-unavailable-sidebar-recovers-with-identity', async () => {
    await expect(stripMeter(page)).toBeVisible()
    await expect(stripMeter(page)).toContainText('10%')
    await expect(quotaAccountCard(page, 'Command Code 1').getByRole('progressbar')).toHaveCount(2)
    await expect(quotaAccountCard(page, 'Command Code 1').getByRole('button', { name: 'Reauthenticate', exact: true })).toHaveCount(0)
    await expectCanonicalQuotaOrder(page)
    expect(await readSavedAccounts(page)).toEqual(unavailableBefore.get(page))
    expect(fakeCommandCodeFor(page).requests).toHaveLength(0)
  })
  await finishJourneyAssertions(page)
})
const usageCardTop = async (page: Page, name: string): Promise<number> =>
  (
    await usagePopover(page)
      .getByLabel(new RegExp(`^${name}: drag to reorder`))
      .boundingBox()
  )?.y ?? Number.NaN

const expectUsageCards = async (page: Page, layout: 'stacked' | 'side by side'): Promise<void> =>
  expect
    .poll(async () => {
      const [first, second] = [await usageCardTop(page, 'Command Code 1'), await usageCardTop(page, 'Command Code 2')]
      return Math.abs(first - second) < 1 ? 'side by side' : 'stacked'
    })
    .toBe(layout)

Then('widening the usage popover from its grip lays the accounts out side by side', async ({ page }: { page: Page }) => {
  await stripMeter(page).click()
  await expectUsageCards(page, 'stacked')
  await recordAssertion(page, 'ai-accounts-quota-header-shows-provider-plan', async () => {
    const header = usagePopover(page).locator('article header').filter({ hasText: 'Command Code 1' })
    const plan = header.getByLabel('Subscription plan: individual-pro', { exact: true })
    await expect(plan).toBeVisible()
    await expect(plan).toHaveText('individual-pro')
    await expect(plan).toHaveAttribute('title', 'Subscription plan: individual-pro')
    const bounds = await plan.evaluate(element => {
      const header = element.closest('header')
      if (header === null) throw new Error('The plan badge is not in a quota card header')
      const headerBox = header.getBoundingClientRect()
      const planBox = element.getBoundingClientRect()
      return {
        planTop: planBox.top,
        planBottom: planBox.bottom,
        planWidth: planBox.width,
        headerTop: headerBox.top,
        headerBottom: headerBox.bottom,
        headerWidth: headerBox.width,
      }
    })
    expect(bounds.planTop).toBeGreaterThanOrEqual(bounds.headerTop)
    expect(bounds.planBottom).toBeLessThanOrEqual(bounds.headerBottom + 1)
    expect(bounds.planWidth).toBeLessThanOrEqual(bounds.headerWidth * 0.3 + 1)
  })
  const grip = await usagePopover(page).getByRole('separator', { name: 'Resize usage popover', exact: true }).boundingBox()
  if (grip === null) throw new Error('The usage popover grip is not laid out')
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 420, grip.y - 40, { steps: 8 })
  await page.mouse.up()
  await recordAssertion(page, 'ai-accounts-wide-usage-popover-shows-a-grid', () => expectUsageCards(page, 'side by side'))
})

Then('the usage popover keeps its size until its grip is double-clicked', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await expect(usagePopover(page)).toBeHidden()
  await stripMeter(page).click()
  await recordAssertion(page, 'ai-accounts-usage-popover-keeps-its-size', () => expectUsageCards(page, 'side by side'))
  await usagePopover(page).getByRole('separator', { name: 'Resize usage popover', exact: true }).dblclick()
  await recordAssertion(page, 'ai-accounts-usage-popover-fits-again', () => expectUsageCards(page, 'stacked'))
  await finishJourneyAssertions(page)
})

When('a rate-limited and a healthy Command Code account share a local fake provider', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', routeSlug: 'commandcode_work', key: 'e2e-fake-key-LIMITED' })
  await addCommandCodeAccount(page, { name: 'Command Code 2', routeSlug: 'commandcode_work_2', key: 'e2e-fake-key-BRAVO2' })
})

When("a new thread asks the first account's model a question", async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await selectAccountModel(page, 'commandcode_work/gpt-6-luna')
  await expect(page.getByRole('button', { name: /^Select model, current commandcode_work\/gpt-6-luna/ })).toBeVisible()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('Which account answers?')
  await composer.press('Enter')
})

Then('the healthy account answers and the rate-limited one cools down', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-pool-fails-over-to-the-healthy-account', async () => {
    await expect(page.getByText('Answered by BRAVO2', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    const chatKeys = fakeCommandCodeFor(page)
      .requests.filter(request => request.kind === 'turn')
      .map(request => request.key)
    expect(chatKeys[0]).toBe('e2e-fake-key-LIMITED')
    expect(chatKeys.at(-1)).toBe('e2e-fake-key-BRAVO2')
    expect(new Set(chatKeys)).toEqual(new Set(['e2e-fake-key-LIMITED', 'e2e-fake-key-BRAVO2']))
    await expectActiveAccount(page, 'commandcode_work_2')
  })
  // The account rail reads runtime health with its usage poll; reopening the app reads it now instead of a minute later.
  await page.reload()
  await openGlobalPanel(page, 'AI Accounts: Accounts')
  await recordAssertion(page, 'ai-accounts-rate-limited-account-is-cooling-down', async () => {
    await expect(accountCard(page, 'Command Code 1').getByText('Rate limited', { exact: true })).toBeVisible()
    await expect(accountCard(page, 'Command Code 2').getByText('Credentials available', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('request distribution is set to Priority', async ({ page }: { page: Page }) => {
  await openPageOptions(page)
  const distribution = page.getByRole('combobox', { name: 'Request distribution' })
  await distribution.click()
  await page.getByRole('option', { name: /Priority/ }).click()
  await expect(distribution).toHaveText('Priority')
})

When("a new thread asks the second account's model a question", async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await selectAccountModel(page, 'commandcode_work_2/gpt-6-luna')
  await expect(page.getByRole('button', { name: /^Select model, current commandcode_work_2\/gpt-6-luna/ })).toBeVisible()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill('Which account answers first?')
  await composer.press('Enter')
})

Then('the first account is tried, the healthy one answers, and the next request goes straight to it', async ({ page }: { page: Page }) => {
  const turnKeys = (): string[] =>
    fakeCommandCodeFor(page)
      .requests.filter(request => request.kind === 'turn')
      .map(request => request.key)
  await recordAssertion(page, 'ai-accounts-priority-tries-the-first-account', async () => {
    await expect(page.getByText('Answered by BRAVO2', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    expect(turnKeys()[0]).toBe('e2e-fake-key-LIMITED')
    expect(turnKeys().at(-1)).toBe('e2e-fake-key-BRAVO2')
    await expectActiveAccount(page, 'commandcode_work_2')
  })
  const before = turnKeys().length
  const composer = page.getByRole('textbox', { name: /\/ commands, @ files or sessions$/ })
  await composer.fill('And the next request?')
  await composer.press('Enter')
  await recordAssertion(page, 'ai-accounts-priority-skips-the-cooling-account', async () => {
    await expect(page.getByText('Answered by BRAVO2', { exact: true })).toHaveCount(2, { timeout: 30_000 })
    expect(turnKeys().slice(before)).toEqual(['e2e-fake-key-BRAVO2'])
    await expectActiveAccount(page, 'commandcode_work_2')
  })
  await finishJourneyAssertions(page)
})

When('a third Command Code account is added', async ({ page }: { page: Page }) => {
  await addCommandCodeAccount(page, { name: 'Command Code 3', routeSlug: 'commandcode_work_3', key: 'e2e-fake-key-CHAIN3' })
})

const composerPicker = (page: Page) => page.getByRole('button', { name: /, reasoning / })
const fallbacks = (page: Page) => page.getByRole('region', { name: 'Fallbacks', exact: true })

const pickAccountModel = async (page: Page, account: string): Promise<void> => {
  const dialog = page.getByRole('dialog')
  const accountChip = dialog.getByRole('button', { name: account, exact: true })
  if ((await accountChip.count()) > 0) {
    await accountChip.click()
    await expect(accountChip).toHaveAttribute('aria-pressed', 'true')
    return
  }
  const modelList = page.getByRole('list', { name: 'Models and accounts', exact: true })
  const row = modelList
    .locator('[data-model-picker-row]')
    .filter({ hasText: account })
    .filter({ hasText: /gpt-6-luna/iu })
  await row.locator('[data-model-picker-option]').click()
  await expect(row.locator('[data-model-picker-option]')).toHaveAttribute('aria-pressed', 'true')
  await row.getByRole('button', { name: /Details for/iu }).click()
}

When('a new thread falls back from the first account to the third one in the composer picker', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await composerPicker(page).click()
  await pickAccountModel(page, 'Command Code 3')
  await fallbacks(page).getByRole('button', { name: 'Add fallback', exact: true }).click()
  await expect(fallbacks(page).getByRole('listitem')).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('model-fallbacks.png') })
  await pickAccountModel(page, 'Command Code 1')
  await page.keyboard.press('Escape')
})

When('the thread asks a question', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: /\/ commands, @ files or sessions$/ })
  await composer.fill('Who takes over?')
  await composer.press('Enter')
})

Then('the third account answers instead of the next account in the list', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-fallback-chain-takes-over', async () => {
    await expect(page.getByText('Answered by CHAIN3', { exact: true }).last()).toBeVisible({ timeout: 30_000 })
    const turnKeys = fakeCommandCodeFor(page)
      .requests.filter(request => request.kind === 'turn')
      .map(request => request.key)
    expect(turnKeys[0]).toBe('e2e-fake-key-LIMITED')
    expect(turnKeys).not.toContain('e2e-fake-key-BRAVO2')
    expect(turnKeys.at(-1)).toBe('e2e-fake-key-CHAIN3')
  })
})

Then('the picker offers to return the thread to its selection', async ({ page }: { page: Page }) => {
  await composerPicker(page).click()
  const serving = fallbacks(page).getByRole('status')
  await recordAssertion(page, 'ai-accounts-fallback-chain-moves-the-picker', async () => {
    await expect(serving).toContainText('Command Code 3')
    await expect(composerPicker(page)).toContainText('CC3')
  })
  await serving.getByRole('button', { name: 'Return', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-fallback-chain-returns-to-the-selection', async () => {
    await expect(serving).toHaveCount(0)
    await expect(page.getByLabel('Available accounts').getByRole('button', { name: 'Command Code 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
  await finishJourneyAssertions(page)
})

const failTurnOnExhaustedAccount = async (page: Page, key: string): Promise<void> => {
  await startFakeCommandCode(page)
  await openAccountsPanel(page)
  await addCommandCodeAccount(page, { name: 'Command Code 1', routeSlug: 'commandcode_work', key })
  // The inline recovery choice exists only while automatic exhausted-limit failover is off.
  await openSettingsDialog(page)
  await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
  const exhausted = page.getByRole('group', { name: /Usage exhausted/ })
  const failover = exhausted.getByRole('switch', { name: 'Fail over to the next account' })
  await failover.click()
  await expect(failover).not.toBeChecked()
  await page.keyboard.press('Escape')
  const threadSidebarNewThreadButton = page.getByRole('button', { name: 'New thread', exact: true })
  if (await threadSidebarNewThreadButton.isVisible()) {
    await threadSidebarNewThreadButton.click()
    await expect.poll(() => new URL(page.url()).searchParams.get('thread'), { timeout: 15_000 }).not.toBeNull()
  } else {
    await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  }
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByRole('button', { name: /^Select model/ }).click()
  await selectAccountModel(page, 'commandcode_work/gpt-6-luna')
  await composer.fill('Recover this turn on another available route.')
  await composer.press('Enter')
}

When('an exhausted Command Code account fails a turn with failover off', async ({ page }: { page: Page }) => {
  await failTurnOnExhaustedAccount(page, 'e2e-fake-key-EXHAUSTED')
})

When('a briefly exhausted Command Code account fails a turn with auto-resume on', async ({ page }: { page: Page }) => {
  await failTurnOnExhaustedAccount(page, 'e2e-fake-key-RESETTING')
})

Then('the turn resumes on its own one minute after the reset', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-exhausted-turn-auto-resumes', async () => {
    // Auto-resume is on by default for a known reset, so nobody has to opt in.
    await expect(page.getByRole('checkbox', { name: 'Automatically resume after the limit resets' })).toBeChecked({ timeout: 30_000 })
    // The fake limit resets 5 seconds after the failed turn; the Host resumes 1 minute after that.
    await expect(page.getByText('Answered by ETTING', { exact: true }).last()).toBeVisible({ timeout: 100_000 })
  })
  await finishJourneyAssertions(page)
})

Then('the exhausted turn offers an inline route switch and one-minute auto-resume', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-exhausted-inline-recovery', async () => {
    await expect(page.getByText("Your current account's usage limit is exhausted", { exact: false })).toBeVisible({ timeout: 30_000 })
    // The per-thread toggle sits beside Resume and starts on for a known reset.
    const autoResume = page.getByRole('checkbox', { name: 'Automatically resume after the limit resets' })
    await expect(autoResume).toBeChecked({ timeout: 30_000 })
    // Turning it off keeps this scenario manual and proves the toggle writes through.
    await autoResume.click()
    await expect(autoResume).not.toBeChecked()
    // The route switch renders only once the Host stored this turn's recovery.
    const expand = page.getByRole('button', { name: 'Resume with another model', exact: true })
    await expect(expand).toHaveAttribute('data-variant', 'ghost')
    await expect(expand).toBeEnabled({ timeout: 30_000 })
    await expand.click()
    await expect(page.getByRole('combobox', { name: 'Provider or account', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resume with this selection', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the quota forecast shows its account and forecast views', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-quota-forecast-account-row', async () => {
    await openGlobalPanel(page, 'AI Accounts: Quota forecast')
    await expect(page.getByRole('tab', { name: 'Forecast', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Table', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Hand-off', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Command Code 1/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Command Code 2/ })).toBeVisible()
    await page.getByRole('tab', { name: 'Table', exact: true }).click()
    const forecastTable = page.getByRole('table')
    await expect(forecastTable).toContainText('Command Code 1')
    await expect(forecastTable).toContainText('Command Code 2')
    await expect(forecastTable).toContainText('90%')
    await page.getByRole('tab', { name: 'Hand-off', exact: true }).click()
    await expect(page.getByText('Work on Command Code 1', { exact: true })).toBeVisible()
    await expect(page.getByText(/Work on the account that resets soonest, hand off when it runs out/)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  await stopFakeCommandCode(page)
})
