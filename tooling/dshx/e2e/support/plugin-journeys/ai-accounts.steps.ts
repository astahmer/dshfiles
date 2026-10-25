import { expect, test, type Page, type Request } from '@playwright/test'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import { accountConnectionSnapshotSchema, accountDraftSchema } from '../../../../../plugins/@dshfiles/ai-accounts/src/api.js'
import { After, Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, profileFor, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
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
    .filter({ has: page.getByRole('button', { name: / earlier in account order$/ }) })
const accountCard = (page: Page, name: string) =>
  providerAccounts(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })

const openAccountAdvanced = async (page: Page): Promise<void> => {
  await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
  const advanced = selectedAccount(page)
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: /^Advanced$/ }) })
  if ((await advanced.getAttribute('open')) === null) await advanced.locator('summary').click()
  await expect(selectedAccount(page).getByRole('heading', { name: 'Runtime paths', exact: true })).toBeVisible()
}

const openPageOptions = async (page: Page): Promise<void> => {
  const options = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Page options/ }) })
  if ((await options.getAttribute('open')) === null) await options.locator('summary').click()
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

  const globalPanel = page.getByRole('button', { name: 'AI Accounts', exact: true })
  if (await globalPanel.isVisible()) {
    await globalPanel.click()
  } else {
    await openSettingsDialog(page)
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
  }
  await expect(providerAccounts(page)).toBeVisible()
}

Given('the isolated AI Accounts workspace profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/ai-accounts'],
    profileLabel: 'ai-accounts-workspace',
    seedHome: seedAiAccountsWorkspace,
  })
  await visitIsolatedPluginProfile(page, profile)
})

Given('the isolated AI Accounts and owned Chat plugin profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/ai-accounts', '@dshfiles/chat'],
    profileLabel: 'ai-accounts-owned-chat',
    seedHome: seedAiAccountsWorkspace,
  })
  await visitIsolatedPluginProfile(page, profile)
})

Given('the isolated AI Accounts and model effort picker plugin profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/ai-accounts', '@dshfiles/model-effort-picker', '@dshfiles/multi-host'],
    profileLabel: 'ai-accounts-model-fallback',
    seedHome: seedAiAccountsWorkspace,
  })
  await visitIsolatedPluginProfile(page, profile)
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
  await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('E2E Draft Account')
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes.' })).toBeVisible()
})

Then('the manual draft saves and persists when AI Accounts is reopened', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'ai-accounts-manual-draft-persistence', async () => {
    const saveChanges = page.getByRole('button', { name: 'Save changes', exact: true })
    await saveChanges.click()
    await expect(saveChanges).toBeDisabled()
    // The page notice announces the Host save; remounting starts on the Models tab.
    await expect(page.getByRole('status').filter({ hasText: 'Saved. New sessions use the updated route settings.' }).first()).toBeVisible()
    await openSettingsDialog(page)
    await page.getByRole('dialog').getByRole('button', { name: 'AI Accounts', exact: true }).click()
    await expect(page.getByRole('radio', { name: /Manual/ })).toBeChecked()
    await page.getByRole('button', { name: 'Open AI Accounts', exact: true }).click()
    await selectedAccount(page).getByRole('tab', { name: 'Settings', exact: true }).click()
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
    const removeButton = page.getByRole('button', { name: 'Remove profile', exact: true })
    await removeButton.click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Remove Command Code 1?', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Command Code 1', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'AI Accounts', exact: true }).click()
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
    const moveCodexEarlier = page.getByRole('button', { name: 'Move Command Code 2 earlier in account order', exact: true })
    await expect(moveCodexEarlier).toBeEnabled()
    await moveCodexEarlier.click()
    await expect(moveCodexEarlier).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Move Command Code 2 later in account order', exact: true })).toBeEnabled()
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
    await selectedAccount(page).getByRole('button', { name: 'Reauthenticate', exact: true }).click()
    const reconnect = page.getByRole('dialog', { name: 'Reconnect Command Code 1', exact: true })
    await expect(reconnect.getByRole('button', { name: 'Verify and reconnect', exact: true })).toBeVisible()
    await reconnect.getByRole('button', { name: 'Close', exact: true }).first().click()
    await expect(reconnect).toBeHidden()
    expect(await readSavedAccounts(page)).toEqual(before)
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
  await accountCard(page, 'Command Code 2').getByRole('button', { name: 'Move Command Code 2 earlier in account order', exact: true }).click()
  await expect(accountCard(page, 'Command Code 2').getByRole('button', { name: 'Move Command Code 2 earlier in account order', exact: true })).toBeDisabled()
})

Then('the sidebar tiles follow the shared priority order after reload', async ({ page }: { page: Page }) => {
  const assertOrder = async (): Promise<void> => {
    const tiles = usageStrip(page).getByRole('button', { name: /^Command Code [12]:/ })
    await expect(tiles).toHaveCount(2)
    await expect(tiles.nth(0)).toHaveAttribute('aria-label', /^Command Code 2:/)
    await expect(tiles.nth(1)).toHaveAttribute('aria-label', /^Command Code 1:/)
    const cards = providerAccounts(page)
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: /^Command Code [12] /u }) })
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
  await accountCard(page, 'Command Code 2').getByRole('button', { name: 'Move Command Code 2 earlier in account order', exact: true }).click()
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
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'AI Accounts', exact: true }).click()
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
  await page
    .getByRole('region', { name: account, exact: true })
    .getByRole('button', { name: /gpt-6-luna/ })
    .click()
  await expect(page.getByRole('region', { name: account, exact: true }).getByRole('button', { name: /gpt-6-luna/ })).toHaveAttribute('aria-pressed', 'true')
}

When('a new thread falls back from the first account to the third one in the composer picker', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await composerPicker(page).click()
  await pickAccountModel(page, 'Command Code 3')
  await fallbacks(page).getByRole('button', { name: 'Add current selection', exact: true }).click()
  await expect(fallbacks(page).getByRole('listitem')).toHaveCount(1)
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
    await expect(page.getByRole('region', { name: 'Command Code 3', exact: true }).getByRole('button', { name: /gpt-6-luna/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
  await serving.getByRole('button', { name: 'Return to selection', exact: true }).click()
  await recordAssertion(page, 'ai-accounts-fallback-chain-returns-to-the-selection', async () => {
    await expect(serving).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Command Code 1', exact: true }).getByRole('button', { name: /gpt-6-luna/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
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
    await expect(expand).toHaveAttribute('data-variant', 'outline')
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
    await page.getByRole('button', { name: 'Quota forecast', exact: true }).click()
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
