import { expect, test, type Page } from '@playwright/test'
import { globalPanelLink } from '../plugin-view-names.js'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { accountDraftSchema } from '../../../../../plugins/@dshfiles/ai-accounts/src/api.js'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { After, Given, Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, profileFor, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { bootComposedPluginProfile } from '../boot.js'
import { seedAiAccountsWorkspace } from '../ai-accounts-workspace.js'
import { AccountDraftModel } from '../../../../../plugins/@dshfiles/ai-accounts/src/account-draft.js'
import { seedInertCodexLogin } from '../../../../../plugins/@dshfiles/ai-accounts/src/inert-codex-login.fixture.js'
import { fakeCommandCodeFor, startFakeCommandCode, stopFakeCommandCode } from '../fake-command-code.js'

const reasoningEffort = (page: Page) => page.getByRole('region', { name: 'Reasoning effort', exact: true })
const pickerSelectionByPage = new WeakMap<Page, { readonly model: string; readonly effort: string }>()

When('a submitted prompt opens a scratch Session', async ({ page }: { page: Page }) => {
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await expect(composer).toBeVisible()
  await composer.fill('Open a scratch Session for the model picker')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByText('Open a scratch Session for the model picker', { exact: true })).toBeVisible()
  await expect(page.getByText('MISSING_CREDENTIAL', { exact: true })).toBeVisible()
})

When('the composer model picker is searched for an unavailable model', async ({ page }: { page: Page }) => {
  const trigger = page.locator('[data-model-picker-text]')
  const selectedModel = (await trigger.innerText()).trim()
  const effortLabel = page.locator('[data-model-picker-effort]')
  const selectedEffort = (await effortLabel.innerText()).trim()
  await expect(trigger).toBeVisible()
  await expect(effortLabel).toBeVisible()
  const modelBounds = await trigger.boundingBox()
  const effortBounds = await effortLabel.boundingBox()
  if (modelBounds === null || effortBounds === null) throw new Error('The composer model and reasoning labels have no visible bounds.')
  expect(Math.abs(modelBounds.y - effortBounds.y)).toBeLessThan(2)
  pickerSelectionByPage.set(page, { model: selectedModel, effort: selectedEffort })
  await trigger.click()

  await expect(page.getByText('Choose a model', { exact: true })).toHaveCount(0)
  const modelList = page.getByRole('list', { name: 'Models grouped by provider', exact: true })
  const search = page.getByRole('textbox', { name: 'Search models and providers', exact: true })
  const modelOptions = modelList.locator('[data-model-picker-option]')
  await expect(modelList).toBeVisible()
  await expect(modelOptions).toHaveCount(0)
  await expect(search).toBeFocused()
  await search.press('ArrowDown')
  await expect(search).toBeFocused()

  const popoverBounds = await page.getByRole('dialog').boundingBox()
  if (popoverBounds === null) throw new Error('The model picker popover has no visible bounds.')
  expect(popoverBounds.width).toBeLessThanOrEqual(430)
  const effort = reasoningEffort(page)
  await expect(effort).toContainText('Select a model to see its reasoning controls.')
  await expect(effort.getByRole('slider')).toHaveCount(0)
  await search.fill('zz-no-provider-model-83914')
  await expect(modelList.getByText('No matching models.', { exact: true })).toBeVisible()
})

Then('the empty catalog preserves selection without model-specific reasoning controls', async ({ page }: { page: Page }) => {
  const selection = pickerSelectionByPage.get(page)
  if (selection === undefined) throw new Error('The model picker selection was not captured before search.')

  await recordAssertion(page, 'empty-catalog-preserves-model-and-effort', async () => {
    const model = page.locator('[data-model-picker-text]')
    const effortLabel = page.locator('[data-model-picker-effort]')
    await expect(model).toHaveText(selection.model)
    await expect(effortLabel).toHaveText(selection.effort)
    await expect(page.getByRole('list', { name: 'Models grouped by provider', exact: true }).getByText('No matching models.', { exact: true })).toBeVisible()

    const effort = reasoningEffort(page)
    await expect(effort).toContainText('Select a model to see its reasoning controls.')
    await expect(effort.getByRole('slider')).toHaveCount(0)
  })
})

When('the reasoning-effort slider is adjusted one step', async ({ page }: { page: Page }) => {
  const selection = pickerSelectionByPage.get(page)
  if (selection === undefined) throw new Error('The model picker selection was not captured before adjusting reasoning effort.')

  const effort = reasoningEffort(page)
  const slider = effort.getByRole('slider')
  await expect(slider).toBeVisible()
  const currentValueAttribute = await slider.getAttribute('aria-valuenow')
  const minimumAttribute = await slider.getAttribute('aria-valuemin')
  const maximumAttribute = await slider.getAttribute('aria-valuemax')
  if (currentValueAttribute === null || minimumAttribute === null || maximumAttribute === null) {
    throw new Error('The reasoning slider did not expose its accessible value range.')
  }

  const currentValue = Number(currentValueAttribute)
  const minimum = Number(minimumAttribute)
  const maximum = Number(maximumAttribute)
  if (![currentValue, minimum, maximum].every(Number.isInteger)) throw new Error('The reasoning slider exposed a non-integer value range.')

  const direction = currentValue > minimum ? 'ArrowLeft' : 'ArrowRight'
  const targetValue = direction === 'ArrowLeft' ? currentValue - 1 : currentValue + 1
  if (targetValue < minimum || targetValue > maximum) throw new Error('The reasoning slider has no adjacent value to select.')

  const targetEffort = (await effort.locator('[data-model-effort-option]').nth(targetValue).innerText()).trim()
  await slider.press(direction)
  await expect(slider).toHaveAttribute('aria-valuenow', String(targetValue))
  pickerSelectionByPage.set(page, { model: selection.model, effort: targetEffort })
})

Then('the picker reflects the adjusted reasoning effort', async ({ page }: { page: Page }) => {
  const selection = pickerSelectionByPage.get(page)
  if (selection === undefined) throw new Error('The adjusted model picker selection was not captured.')

  await recordAssertion(page, 'reasoning-slider-updates-selected-effort', async () => {
    await expect(page.locator('[data-model-picker-text]')).toHaveText(selection.model)
    await expect(page.locator('[data-model-picker-effort]')).toHaveText(selection.effort)
    await expect(reasoningEffort(page).getByRole('button', { name: selection.effort, exact: true })).toHaveAttribute('aria-pressed', 'true')
  })
  await finishJourneyAssertions(page)
})

Given('the isolated model picker profile with a legacy inert Codex account is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/ai-accounts', '@dshfiles/model-effort-picker', '@dshfiles/multi-host'],
    profileLabel: 'model-picker-legacy-codex',
    seedKey: 'model-picker-legacy-codex-v1',
    seedHome: async homeRoot => {
      await seedAiAccountsWorkspace(homeRoot)
      const home = await realpath(homeRoot)
      const underTemp = relative(await realpath(tmpdir()), home)
      if (underTemp === '' || underTemp.startsWith('..') || isAbsolute(underTemp)) throw new Error('Legacy account fixture requires a private temporary home.')
      const instanceId = 'codex_work_00000000000000000000000000000001'
      const privateHome = join(home, 'plugins', 'ai-accounts', 'homes', instanceId)
      const draft = {
        ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
        instanceId,
        displayName: 'Codex 1',
        enabled: false,
        homePath: privateHome,
        shadowHomePath: privateHome,
      }
      const store = join(home, 'plugins', 'ai-accounts')
      await mkdir(store, { recursive: true, mode: 0o700 })
      await writeFile(
        join(store, 'accounts.json'),
        JSON.stringify({ distribution: 'sticky', cooldownMs: 300_000, shadowRoot: join(store, 'homes'), accounts: [draft] }),
        { flag: 'wx', mode: 0o600 },
      )
      // Explicit legacy fixture for model catalogs only. Missing account_id prevents quota networking; this is NOT connection proof.
      await seedInertCodexLogin(home, 'Codex 1')
    },
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('a supported legacy Codex model is selected without validating a new connection', async ({ page }: { page: Page }) => {
  const providerAccounts = page.getByRole('complementary', { name: 'Provider accounts', exact: true })
  await globalPanelLink(page, 'AI Accounts: Accounts').click()
  await expect(providerAccounts).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Codex 1', exact: true })).toBeVisible()
  // This pre-existing fixture tests catalog controls only, never provider authentication or new-account admission.
  const card = providerAccounts.getByRole('listitem').filter({ has: page.getByText('Codex 1', { exact: true }) })
  await card.getByRole('switch').click()
  await expect(card.getByRole('switch')).toBeChecked()
  const home = profileFor(page).homeRoot
  const readLegacy = async () =>
    z.object({ accounts: z.array(accountDraftSchema) }).parse(JSON.parse(await readFile(join(home, 'plugins/ai-accounts/accounts.json'), 'utf8'))).accounts[0]
  await expect.poll(async () => (await readLegacy())?.enabled).toBe(true)
  const legacy = await readLegacy()
  if (legacy === undefined) throw new Error('Legacy catalog fixture is not persisted')
  expect(legacy.instanceId).toBe('codex_work_00000000000000000000000000000001')
  expect(legacy.homePath).toBe(join(home, 'plugins/ai-accounts/homes', legacy.instanceId))
  expect(legacy.shadowHomePath).toBe(legacy.homePath)
  expect((await stat(join(legacy.homePath, 'auth.json'))).mode & 0o777).toBe(0o600)
  await test.info().attach('legacy-account-enabled-proof', {
    body: JSON.stringify({ enabled: legacy.enabled, privatePairedHome: true, authMode: '0600', connectionProof: false }),
    contentType: 'application/json',
  })
  await page.getByRole('treeitem', { name: /Open a scratch Session for/i }).click()
  await expect(providerAccounts).toBeHidden()

  const trigger = page.locator('[data-model-picker-text]')
  if ((await trigger.count()) === 0) {
    await page.getByRole('button', { name: 'Select model', exact: true }).click()
    const menu = page.getByRole('menu').last()
    await expect(menu).toBeVisible()
    await test.info().attach('legacy-picker-diagnostics', {
      body: JSON.stringify({
        nativePickerText: (await menu.innerText()).slice(0, 4000),
        browserErrors: browserDiagnosticsFor(page).map(message => message.replace(/https?:\/\/\S+/gu, '[redacted URL]')),
      }),
      contentType: 'application/json',
    })
    await page.screenshot({ path: test.info().outputPath('enabled-legacy-native-picker.png') })
    throw new Error('The private legacy account is persisted enabled with 0600 auth, but the owned model picker is absent; see attached catalog diagnostics.')
  }
  await trigger.click()
  const modelList = page.getByRole('list', { name: 'Models grouped by provider', exact: true })
  const codexGroup = modelList.getByRole('region', { name: 'Codex 1', exact: true })
  const search = page.getByRole('textbox', { name: 'Search models and providers', exact: true })
  const modelOptions = modelList.locator('[data-model-picker-option]')
  await search.fill('gpt-')
  await expect.poll(() => modelOptions.count()).toBeGreaterThan(1)
  await search.press('ArrowDown')
  await expect(modelOptions.first()).toBeFocused()
  await modelOptions.first().press('ArrowDown')
  await expect(modelOptions.nth(1)).toBeFocused()
  await modelOptions.nth(1).press('ArrowUp')
  await expect(modelOptions.first()).toBeFocused()
  await modelOptions.first().press('ArrowUp')
  await expect(search).toBeFocused()
  await search.fill('gpt-6-luna')
  const model = codexGroup.getByRole('button', { name: /gpt-6-luna/ })
  await expect(model).toBeVisible()
  await model.click()
  await expect(trigger).toHaveAttribute('title', /Codex 1/)

  const fastMode = page.getByRole('switch', { name: 'Fast mode; may cost more', exact: true })
  const dialog = page.getByRole('dialog')
  if (!(await dialog.isVisible())) await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(fastMode).toBeVisible()

  const popoverBounds = await dialog.boundingBox()
  if (popoverBounds === null) throw new Error('The model picker popover has no visible bounds.')
  expect(popoverBounds.width).toBeLessThanOrEqual(430)
  const effort = reasoningEffort(page)
  const providerDefault = effort.getByRole('button', { name: 'Use provider default', exact: true })
  await expect(providerDefault).toBeVisible()
  const defaultBounds = await providerDefault.boundingBox()
  const slider = effort.getByRole('slider')
  const sliderBounds = await slider.boundingBox()
  if (defaultBounds === null || sliderBounds === null) throw new Error('The reasoning controls have no visible bounds.')
  expect(defaultBounds.y + defaultBounds.height).toBeLessThan(sliderBounds.y)
  const trackBounds = await effort.locator('[data-model-effort-slider] [data-slot="slider-track"]').boundingBox()
  if (trackBounds === null) throw new Error('The effort slider track has no visible bounds.')
  expect(trackBounds.height).toBeGreaterThanOrEqual(10)
  expect(sliderBounds.width).toBeGreaterThanOrEqual(20)
  const accentRange = await effort.locator('[data-model-effort-slider] [data-slot="slider-range"]').evaluate(element => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--dsw-alias-state-business-primary)'
    document.body.append(probe)
    const accentColor = getComputedStyle(probe).backgroundColor
    probe.remove()
    return accentColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(element).backgroundColor === accentColor
  })
  expect(accentRange).toBe(true)
  expect(await effort.locator('[data-model-effort-slider-markers] [data-model-effort-marker]').count()).toBe(
    await effort.locator('[data-model-effort-option]').count(),
  )
  pickerSelectionByPage.set(page, {
    model: (await trigger.innerText()).trim(),
    effort: (await page.locator('[data-model-picker-effort]').innerText()).trim(),
  })
})

Then('Fast mode works for supported Codex models and stays hidden for Spark', async ({ page }: { page: Page }) => {
  const selection = pickerSelectionByPage.get(page)
  if (selection === undefined) throw new Error('The Codex model selection was not captured before checking Fast mode.')

  const trigger = page.locator('[data-model-picker-text]')
  const dialog = page.getByRole('dialog')
  const fastMode = page.getByRole('switch', { name: 'Fast mode; may cost more', exact: true })
  await recordAssertion(page, 'fast-mode-is-limited-to-supported-codex-models', async () => {
    if (!(await dialog.isVisible())) await trigger.click()
    await expect(dialog).toBeVisible()
    await expect(trigger).toHaveText(selection.model)
    await expect(page.locator('[data-model-picker-effort]')).toHaveText(selection.effort)
    await expect(reasoningEffort(page).getByRole('slider')).toBeVisible()
    await expect(reasoningEffort(page).getByRole('button', { name: selection.effort, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(fastMode).toBeEnabled()
    await fastMode.click()
    await expect(fastMode).toBeChecked()
    await expect(page.locator('[data-model-fast-mode-enabled]')).toBeVisible()
    await fastMode.click()
    await expect(fastMode).not.toBeChecked()
    await expect(page.locator('[data-model-fast-mode-enabled]')).toHaveCount(0)

    if (!(await dialog.isVisible())) await trigger.click()
    await expect(dialog).toBeVisible()
    const modelList = page.getByRole('list', { name: 'Models grouped by provider', exact: true })
    const codexGroup = modelList.getByRole('region', { name: 'Codex 1', exact: true })
    const search = page.getByRole('textbox', { name: 'Search models and providers', exact: true })
    await search.fill('gpt-5.3-codex-spark')
    const spark = codexGroup.getByRole('button', { name: /gpt-5.3-codex-spark/ })
    await expect(spark).toBeVisible()
    await spark.click()
    if ((await dialog.count()) === 0) await trigger.click()
    await expect(dialog.getByRole('switch', { name: 'Fast mode; may cost more', exact: true })).toHaveCount(0)
    await expect(page.locator('[data-model-fast-mode-enabled]')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('two Command Code accounts offer the same model in a new thread', async ({ page }: { page: Page }) => {
  await startFakeCommandCode(page)
  const accounts = globalPanelLink(page, 'AI Accounts: Accounts')
  await accounts.click()
  const panel = page.getByRole('complementary', { name: 'Provider accounts', exact: true })
  await expect(panel).toBeVisible()
  for (const [name, key] of [
    ['Command Code 1', 'e2e-fake-key-ALPHA1'],
    ['Command Code 2', 'e2e-fake-key-BRAVO2'],
  ]) {
    await page.getByRole('button', { name: 'Add account', exact: true }).first().click()
    await page.getByRole('dialog', { name: 'Add account', exact: true }).getByRole('button', { name: 'Command Code account', exact: true }).click()
    const initialKey = page.getByRole('dialog', { name: `Configure ${name} key`, exact: true })
    await initialKey.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(initialKey).toBeHidden()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    const detail = page.getByRole('region', { name: 'Selected account', exact: true })
    await detail.getByRole('tab', { name: 'Settings', exact: true }).click()
    await detail
      .locator('summary')
      .filter({ hasText: /^Advanced$/ })
      .click()
    const baseUrl = page.getByRole('textbox', { name: 'API base URL', exact: true })
    await baseUrl.fill(fakeCommandCodeFor(page).baseUrl)
    await baseUrl.blur()
    await expect(page.getByRole('status').filter({ hasText: /^(Saved|Changes save automatically)$/ })).toBeVisible()
    await page.getByRole('button', { name: 'Set up key…', exact: true }).click()
    const keyDialog = page.getByRole('dialog', { name: `Configure ${name} key`, exact: true })
    await keyDialog.getByRole('textbox', { name: 'API key value', exact: true }).fill(key)
    await keyDialog.getByRole('button', { name: 'Store key', exact: true }).click()
    await expect(keyDialog).toBeHidden()
    await detail.getByRole('switch', { name: 'Hidden from model picker', exact: true }).click()
    await expect(detail.getByRole('switch', { name: 'Enabled in model picker', exact: true })).toBeChecked()
  }
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  const picker = page.getByRole('button', { name: /, reasoning / })
  await expect(picker).toBeVisible()
  await picker.click()
  const list = page.getByRole('list', { name: 'Models grouped by provider', exact: true })
  const search = page.getByRole('textbox', { name: 'Search models and providers', exact: true })
  const firstAccount = list.getByRole('region', { name: 'Command Code 1', exact: true })
  await search.fill('gpt-6-luna')
  await firstAccount.getByRole('button', { name: /gpt-6-luna/ }).click()
  const selectedModel = page.locator('[data-model-picker-text]')
  await expect(selectedModel).toHaveText('gpt-6-luna')
  await selectedModel.hover()
  await expect(page.getByRole('tooltip')).toContainText('Command Code 1')
})

Then('swapping accounts keeps the model and selects the next account', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'model-effort-picker-account-swap-preserves-selection', async () => {
    const model = page.locator('[data-model-picker-text]')
    const effort = page.locator('[data-model-picker-effort]')
    const initialEffort = await effort.innerText()
    await expect(model).toHaveText('gpt-6-luna')
    await model.hover()
    await expect(page.getByRole('tooltip')).toContainText('Command Code 1')
    await expect(page.getByRole('button', { name: 'Switch to Command Code 2', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Switch to Command Code 2', exact: true }).click()
    await expect(model).toHaveText('gpt-6-luna')
    await model.hover()
    await expect(page.getByRole('tooltip')).toContainText('Command Code 2')
    await expect(effort).toHaveText(initialEffort)
    await expect(page.getByRole('button', { name: 'Switch to Command Code 1', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  await stopFakeCommandCode(page)
})
