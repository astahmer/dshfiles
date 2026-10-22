import { expect, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { After, Before, Given, Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

/**
 * The Host resolves the `secret` executable from the PATH it was launched with, so a tagged scenario puts the
 * fake CLI first on PATH before its Given step boots the Host, and seeds the store with synthetic values.
 */
interface SecretFixturePaths {
  readonly root: string
  readonly bin: string
  readonly project: string
  readonly storePath: string
}
interface SecretFixture extends SecretFixturePaths {
  readonly previousPath: string | undefined
  readonly previousJevKey: string | undefined
  readonly previousPrewarm: string | undefined
}

const StoreRow = { alias: '', scope: '', root: null as string | null, environment: '', item: '', field: 'password', source: '' }
type StoreRow = typeof StoreRow & { readonly name?: string }
interface Store {
  rows: StoreRow[]
  vault: Record<string, string>
  clipboard?: string
}

const fixtures = new WeakMap<Page, SecretFixture>()
const chatOfferAssertionCounts = new WeakMap<Page, number>()
const fakeCli = join(dirname(fileURLToPath(import.meta.url)), '..', 'fake-secret-cli.mjs')
// Keep PATH stable for prewarmed Hosts; reset the store per scenario and remove it when the worker exits.
let sharedFakeCliFixture: Promise<SecretFixturePaths> | undefined

const fakeCliFixtureForWorker = (): Promise<SecretFixturePaths> => {
  if (sharedFakeCliFixture !== undefined) return sharedFakeCliFixture
  sharedFakeCliFixture = (async () => {
    const root = await createScratchDirectory('dshx-secret-catalog-e2e-')
    const bin = join(root, 'bin')
    const project = join(root, 'secret-project')
    await mkdir(bin)
    await mkdir(project)
    await copyFile(fakeCli, join(bin, 'secret'))
    await chmod(join(bin, 'secret'), 0o755)
    const paths = { root, bin, project, storePath: join(bin, 'store.json') }
    process.once('exit', () => rmSync(root, { recursive: true, force: true }))
    return paths
  })()
  return sharedFakeCliFixture
}

const fixtureFor = (page: Page): SecretFixture => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) throw new Error('The fake secret CLI was not installed; tag the scenario @fake-secret-cli.')
  return fixture
}

const readStore = async (page: Page): Promise<Store> => JSON.parse(await readFile(fixtureFor(page).storePath, 'utf8'))

Before({ tags: '@fake-secret-cli' }, async ({ page }: { page: Page }) => {
  const previousPrewarm = process.env.DSHX_E2E_PREWARM
  const previousJevKey = process.env.TYPESAFE_API_KEY
  process.env.DSHX_E2E_PREWARM = '0'
  process.env.TYPESAFE_API_KEY = ''
  const paths = await fakeCliFixtureForWorker()
  const row = (fields: Partial<StoreRow>): StoreRow => ({ ...StoreRow, ...fields })
  const store: Store = {
    rows: [
      row({ alias: 'GITHUB_TOKEN', scope: 'global', environment: 'prod', item: 'item-github', source: 'github' }),
      row({ alias: 'DB_PASSWORD', scope: 'project', root: paths.project, environment: 'prod', item: 'item-db-prod', source: 'postgres' }),
      row({ alias: 'DB_PASSWORD', scope: 'project', root: paths.project, environment: 'dev', item: 'item-db-dev', source: 'postgres' }),
      row({ alias: 'LOCAL_TOKEN', scope: 'local', root: paths.project, environment: 'prod', item: 'item-local', source: 'laptop' }),
    ],
    vault: { 'item-github': 'gh-e2e-global-value', 'item-db-prod': 'db-e2e-prod-value', 'item-db-dev': 'db-e2e-dev-value', 'item-local': 'local-e2e-value' },
  }
  await writeFile(paths.storePath, JSON.stringify(store))
  fixtures.set(page, { ...paths, previousPath: process.env.PATH, previousJevKey, previousPrewarm })
  process.env.PATH = `${paths.bin}${delimiter}${process.env.PATH ?? ''}`
})

After({ tags: '@fake-secret-cli' }, async ({ page }: { page: Page }) => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) return
  fixtures.delete(page)
  if (fixture.previousPath === undefined) delete process.env.PATH
  else process.env.PATH = fixture.previousPath
  if (fixture.previousJevKey === undefined) delete process.env.TYPESAFE_API_KEY
  else process.env.TYPESAFE_API_KEY = fixture.previousJevKey
  if (fixture.previousPrewarm === undefined) delete process.env.DSHX_E2E_PREWARM
  else process.env.DSHX_E2E_PREWARM = fixture.previousPrewarm
})

const catalog = (page: Page) => page.getByRole('main')
const aliasRows = (page: Page) => catalog(page).getByRole('rowgroup').nth(1).getByRole('row')
const rowFor = (page: Page, alias: string, environment: string) => aliasRows(page).filter({ hasText: new RegExp(`${alias} · \\w+ · ${environment} ·`) })

const openCatalog = async (page: Page): Promise<void> => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Secret Catalog', exact: true }).click()
  await expect(catalog(page).getByRole('heading', { name: 'Secret Catalog', exact: true })).toBeVisible()
}

const openBacklogSettings = async (page: Page): Promise<void> => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'View @dshfiles/backlog', exact: true }).click()
  await expect(page.locator('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="jevSecret"]')).toBeVisible()
}

When('the Secret Catalog is opened', async ({ page }: { page: Page }) => {
  await openCatalog(page)
})

Given('Backlog Jev triage is enabled without a resolvable key', async ({ page }: { page: Page }) => {
  await openBacklogSettings(page)
  const enabled = page.getByRole('switch', { name: 'Jev enabled', exact: true })
  if (!(await enabled.isChecked())) await enabled.click()
  await expect(enabled).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Auto triage', exact: true })).not.toBeChecked()
  const globalKey = (await readStore(page)).rows.filter(row => row.alias === 'jev-api-key-optmem' && row.scope === 'global')
  expect(globalKey).toHaveLength(0)
})

When('the Backlog Jev secret setup is opened from Settings', async ({ page }: { page: Page }) => {
  await openBacklogSettings(page)
  const jevRow = page.locator('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="jevSecret"]')
  await expect(jevRow).toBeVisible()
  await jevRow.locator('input[data-secret-input="reference"]').focus()
  const addSecret = page.getByTestId('secret-input-jev-setup')
  await expect(addSecret).toBeVisible()
  await addSecret.click()
  const setup = page.getByTestId('jev-secret-setup')
  await expect(setup).toBeVisible()
  await expect(setup.getByLabel('TypeSafe API key', { exact: true })).toHaveAttribute('type', 'password')
})

const jevProjectValue = 'jev-e2e-project-scoped-value'

const seedProjectJevAlias = async (page: Page): Promise<void> => {
  const fixture = fixtureFor(page)
  const store = await readStore(page)
  store.rows.push({
    alias: 'jev-api-key-optmem',
    scope: 'project',
    root: fixture.project,
    environment: 'prod',
    item: 'item-jev-project',
    field: 'password',
    source: 'Typesafe project',
  })
  store.vault['item-jev-project'] = jevProjectValue
  await writeFile(fixture.storePath, JSON.stringify(store))
}

Given('a project-scoped Jev key is stored for the seeded project folder', async ({ page }: { page: Page }) => {
  await seedProjectJevAlias(page)
})

Given('a global Jev key with value {string} is already stored', async ({ page }: { page: Page }, value: string) => {
  const fixture = fixtureFor(page)
  await seedProjectJevAlias(page)
  const store = await readStore(page)
  store.rows.push({
    alias: 'jev-api-key-optmem',
    scope: 'global',
    root: null,
    environment: 'prod',
    item: 'item-jev-existing',
    field: 'password',
    source: 'Typesafe',
  })
  store.vault['item-jev-existing'] = value
  await writeFile(fixture.storePath, JSON.stringify(store))
})

Then('the replacement warning is shown before saving the Jev key', async ({ page }: { page: Page }) => {
  const setup = page.getByTestId('jev-secret-setup')
  await expect(setup.getByText('This replaces the existing global Jev key.', { exact: true })).toBeVisible()
  await expect(setup.getByRole('button', { name: 'Replace and bind', exact: true })).toBeVisible()
})

When('the Jev API key {string} is entered and saved', async ({ page }: { page: Page }, value: string) => {
  const setup = page.getByTestId('jev-secret-setup')
  await setup.getByLabel('TypeSafe API key', { exact: true }).fill(value)
  const store = await readStore(page)
  const existingJevKey = store.rows.some(row => row.alias === 'jev-api-key-optmem' && row.scope === 'global' && row.environment === 'prod')
  const saveButton = existingJevKey ? 'Replace and bind' : 'Add and bind'
  await setup.getByRole('button', { name: saveButton, exact: true }).click()
  const jevRow = page.locator('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="jevSecret"]')
  await expect(jevRow.locator('input[data-secret-input="reference"]')).toHaveValue('secret:jev-api-key-optmem')
  await expect(setup).toHaveCount(0)
  await page.reload()
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'View @dshfiles/backlog', exact: true }).click()
  await expect(page.locator('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="jevSecret"] input[data-secret-input="reference"]')).toHaveValue(
    'secret:jev-api-key-optmem',
  )
  expect(await page.locator('body').innerText()).not.toContain(value)
})

Then('the global Jev secret is stored with value {string} without exposing it in the UI', async ({ page }: { page: Page }, value: string) => {
  const store = await readStore(page)
  const matches = store.rows.filter(row => row.alias === 'jev-api-key-optmem' && row.scope === 'global' && row.environment === 'prod')
  await recordAssertion(page, 'secret-catalog-backlog-jev-key-is-global', async () => {
    expect(matches).toHaveLength(1)
    const match = matches[0]
    expect(match).toBeDefined()
    expect(store.vault[match?.item ?? '']).toBe(value)
    const projectMatches = store.rows.filter(row => row.alias === 'jev-api-key-optmem' && row.scope === 'project' && row.environment === 'prod')
    expect(projectMatches).toHaveLength(1)
    expect(store.vault[projectMatches[0]?.item ?? '']).toBe(jevProjectValue)
    await expect(page.getByRole('switch', { name: 'Jev enabled', exact: true })).not.toBeChecked()
    await expect(page.getByRole('switch', { name: 'Auto triage', exact: true })).not.toBeChecked()
  })
  await finishJourneyAssertions(page)
})

Then('the Jev setup offer appears on the latest completed turn only', async ({ page }: { page: Page }) => {
  const assertionNumber = (chatOfferAssertionCounts.get(page) ?? 0) + 1
  chatOfferAssertionCounts.set(page, assertionNumber)
  await recordAssertion(page, `secret-catalog-jev-chat-offer-latest-turn-only-${assertionNumber}`, async () => {
    const offers = page.getByTestId('jev-inline-setup-offer')
    await expect(offers).toHaveCount(1)
    await expect(page.getByTestId('secret-setup-offer')).toHaveCount(1)
    await expect(offers.getByRole('button', { name: 'Set up missing secrets', exact: true })).toBeVisible()
  })
})

Then('the Jev setup offer is absent while Jev is disabled', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'secret-catalog-jev-chat-offer-disabled', async () => {
    await expect(page.getByTestId('jev-inline-setup-offer')).toHaveCount(0)
    await expect(page.getByTestId('secret-setup-offer')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('the inline Jev setup is opened', async ({ page }: { page: Page }) => {
  await page.getByTestId('jev-inline-setup-offer').getByRole('button', { name: 'Set up missing secrets', exact: true }).click()
  await expect(page.getByTestId('secret-setup-offer').getByRole('textbox', { name: 'Secret value', exact: true })).toBeVisible()
})

Then('the inline Jev key input is masked', async ({ page }: { page: Page }) => {
  await expect(page.getByTestId('secret-setup-offer').getByRole('textbox', { name: 'Secret value', exact: true })).toHaveAttribute('type', 'password')
})

When('the Jev API key {string} is entered and saved in chat', async ({ page }: { page: Page }, value: string) => {
  const setup = page.getByTestId('secret-setup-offer')
  await setup.getByRole('textbox', { name: 'Secret value', exact: true }).fill(value)
  await setup.getByRole('button', { name: 'Create and bind', exact: true }).click()
  await expect(setup).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('status').filter({ hasText: 'Jev key stored; only its reference was saved to Backlog.' })).toBeVisible()
})

Then('the chat Jev setup stores a global key and binds only its reference', async ({ page }: { page: Page }) => {
  const value = 'jev-e2e-chat-sensitive-value'
  const store = await readStore(page)
  const globalMatches = store.rows.filter(row => row.alias === 'TYPESAFE_API_KEY' && row.scope === 'global' && row.environment === 'prod')
  const projectMatches = store.rows.filter(row => row.alias === 'jev-api-key-optmem' && row.scope === 'project' && row.environment === 'prod')
  await recordAssertion(page, 'secret-catalog-jev-chat-key-is-global-reference-only', async () => {
    expect(globalMatches).toHaveLength(1)
    expect(store.vault[globalMatches[0]?.item ?? '']).toBe(value)
    expect(projectMatches).toHaveLength(1)
    expect(store.vault[projectMatches[0]?.item ?? '']).toBe(jevProjectValue)
    await expect(page.getByTestId('jev-inline-setup-offer')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText(value)
    const inputValues = await page
      .locator('input, textarea')
      .evaluateAll(elements => elements.map(element => ('value' in element ? String(element.value) : '')).join('\\n'))
    expect(inputValues).not.toContain(value)
    const chatTurns = fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn')
    expect(JSON.stringify(chatTurns)).not.toContain(value)
  })
  await openBacklogSettings(page)
  await expect(page.locator('[data-settings-namespace="dshfiles-backlog"] [data-setting-path="jevSecret"] input[data-secret-input="reference"]')).toHaveValue(
    'secret:TYPESAFE_API_KEY',
  )
  await expect(page.getByRole('switch', { name: 'Jev enabled', exact: true })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Auto triage', exact: true })).not.toBeChecked()
  await expect(page.locator('body')).not.toContainText(value)
  await finishJourneyAssertions(page)
})

When('the seeded project folder is chosen in the Secret Catalog', async ({ page }: { page: Page }) => {
  const project = fixtureFor(page).project
  await catalog(page).getByRole('button', { name: 'Choose a project folder…', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a project folder', exact: true })
  const path = picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
  await path.fill(project)
  await path.press('Enter')
  await expect(picker.locator('p').filter({ hasText: project }).first()).toBeVisible()
  await picker.getByRole('button', { name: 'Select this folder', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(catalog(page).getByRole('button', { name: new RegExp(`^secret-project · ${project}`) })).toBeVisible()
})

When('the fake secret CLI store is unreadable', async ({ page }: { page: Page }) => {
  await writeFile(fixtureFor(page).storePath, 'not json\n')
})

When('the Secret Catalog reveals values for {int} seconds', async ({ page }: { page: Page }, seconds: number) => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'View @dshfiles/secret-catalog', exact: true }).click()
  await page.getByRole('textbox', { name: 'Reveal seconds', exact: true }).fill(String(seconds))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

When('the scope filter is set to {string}', async ({ page }: { page: Page }, scope: string) => {
  await catalog(page).getByRole('radio', { name: scope, exact: true }).click()
})

const evidenceSlug = (alias: string): string => alias.toLowerCase().replaceAll('_', '-')

const openAddDialog = async (page: Page) => {
  await catalog(page).getByRole('button', { name: 'More ways to add a secret', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add with details…', exact: true }).click()
  return page.getByRole('dialog', { name: 'Add secret', exact: true })
}

const draftRow = (page: Page) => aliasRows(page).filter({ has: page.getByRole('textbox', { name: 'New secret name', exact: true }) })

When('the alias {string} is added to the project with the value {string}', async ({ page }: { page: Page }, alias: string, value: string) => {
  const dialog = await openAddDialog(page)
  await dialog.getByRole('textbox', { name: 'Alias', exact: true }).fill(alias)
  await expect(dialog.getByRole('combobox', { name: 'Save to', exact: true })).toHaveText('This project')
  await expect(dialog.getByRole('textbox', { name: 'Environment', exact: true })).toHaveValue('prod')
  await dialog.getByRole('radio', { name: /^Enter a value/ }).click()
  await dialog.getByRole('textbox', { name: 'Secret value', exact: true }).fill(value)
  await dialog.getByRole('button', { name: /^Advanced/ }).click()
  await expect(dialog.getByRole('textbox', { name: 'Field', exact: true })).toHaveValue('password')
  await dialog.getByRole('textbox', { name: 'Source URL', exact: true }).fill('https://api.example.test')
  await dialog.getByRole('button', { name: 'Add secret', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('{string} is typed into a new inline row with the value {string} and saved with Enter', async ({ page }: { page: Page }, name: string, value: string) => {
  await catalog(page).getByRole('button', { name: 'Add secret', exact: true }).click()
  const row = draftRow(page).last()
  await row.getByRole('textbox', { name: 'New secret name', exact: true }).pressSequentially(name)
  await row.getByRole('textbox', { name: 'New secret value', exact: true }).fill(value)
  await row.getByRole('textbox', { name: 'New secret value', exact: true }).press('Enter')
})

When('an inline row named {string} is left by clicking elsewhere', async ({ page }: { page: Page }, name: string) => {
  await catalog(page).getByRole('button', { name: 'Add secret', exact: true }).click()
  await draftRow(page).last().getByRole('textbox', { name: 'New secret name', exact: true }).pressSequentially(name)
  await catalog(page).getByRole('heading', { name: 'Secret Catalog', exact: true }).click()
})

When('the inline row is renamed {string}, set to Generate, and left by clicking elsewhere', async ({ page }: { page: Page }, name: string) => {
  const row = draftRow(page).last()
  await row.getByRole('textbox', { name: 'New secret name', exact: true }).fill(name)
  await row.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Generate on this Host', exact: true }).click()
  await expect(row.getByText('Generated on this Host when saved', { exact: true })).toBeVisible()
  await catalog(page).getByRole('heading', { name: 'Secret Catalog', exact: true }).click()
})

When('a new inline row is deleted from its row menu', async ({ page }: { page: Page }) => {
  await catalog(page).getByRole('button', { name: 'Add secret', exact: true }).click()
  await draftRow(page).last().getByRole('button', { name: 'Actions for the new secret', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete row', exact: true }).click()
})

When('the add dialog is opened from the Add secret menu', async ({ page }: { page: Page }) => {
  await openAddDialog(page)
})

When('{string} is added to the global scope with a generated value', async ({ page }: { page: Page }, alias: string) => {
  const dialog = page.getByRole('dialog', { name: 'Add secret', exact: true })
  await dialog.getByRole('textbox', { name: 'Alias', exact: true }).fill(alias)
  await dialog.getByRole('combobox', { name: 'Save to', exact: true }).click()
  await page.getByRole('option', { name: 'Global (every project)', exact: true }).click()
  await expect(dialog.getByRole('radio', { name: /^Generate on this Host/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Add secret', exact: true }).click()
  await expect(dialog).toBeHidden()
})

Then('the inline row says {string}', async ({ page }: { page: Page }, message: string) => {
  await recordAssertion(page, 'secret-catalog-inline-row-explains-why-it-was-not-saved', async () => {
    await expect(draftRow(page).last().getByText(message, { exact: true })).toBeVisible()
  })
})

Then(
  'the store holds {string} in the {string} scope with the value {string}',
  async ({ page }: { page: Page }, alias: string, scope: string, value: string) => {
    await recordAssertion(page, `secret-catalog-store-holds-${evidenceSlug(alias)}-in-${scope}`, async () => {
      await expect(rowFor(page, alias, 'prod')).toBeVisible()
      const store = await readStore(page)
      const row = store.rows.find(candidate => candidate.alias === alias && candidate.environment === 'prod')
      expect(row?.scope).toBe(scope)
      expect(store.vault[row?.item ?? '']).toBe(value)
      await expect(page.getByText(value)).toHaveCount(0)
    })
  },
)

Then(
  'the store holds a generated value for {string} in the {string} scope that the page never showed',
  async ({ page }: { page: Page }, alias: string, scope: string) => {
    await recordAssertion(page, `secret-catalog-generated-${evidenceSlug(alias)}-stays-on-the-host`, async () => {
      await expect(rowFor(page, alias, 'prod')).toBeVisible()
      const store = await readStore(page)
      const row = store.rows.find(candidate => candidate.alias === alias && candidate.environment === 'prod')
      expect(row?.scope).toBe(scope)
      const generated = store.vault[row?.item ?? ''] ?? ''
      expect(generated).toMatch(/^generated-/)
      await expect(page.getByText(generated)).toHaveCount(0)
    })
  },
)

Then('no inline row is left', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'secret-catalog-inline-rows-are-gone', () => expect(draftRow(page)).toHaveCount(0))
  await finishJourneyAssertions(page)
})

Then('the dialog flags {string} as {string} and keeps Advanced folded', async ({ page }: { page: Page }, alias: string, message: string) => {
  const dialog = page.getByRole('dialog', { name: 'Add secret', exact: true })
  const aliasField = dialog.getByRole('textbox', { name: 'Alias', exact: true })
  await aliasField.fill(alias)
  await aliasField.blur()
  await recordAssertion(page, `secret-catalog-dialog-flags-${evidenceSlug(alias)}`, async () => {
    await expect(dialog.getByText(message, { exact: true })).toBeVisible()
    await expect(aliasField).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByRole('textbox', { name: 'Item name', exact: true })).toBeHidden()
  })
})

Then('the dialog journey is complete', async ({ page }: { page: Page }) => {
  await finishJourneyAssertions(page)
})

When('{string} gets the source {string} and the value {string}', async ({ page }: { page: Page }, alias: string, source: string, value: string) => {
  await rowFor(page, alias, 'prod')
    .getByRole('button', { name: `Edit ${alias}`, exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: `Edit ${alias}`, exact: true })
  await dialog.getByRole('textbox', { name: 'Source URL', exact: true }).fill(source)
  await dialog.getByRole('textbox', { name: 'Replace value (optional)', exact: true }).fill(value)
  await dialog.getByRole('button', { name: 'Review replacement', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm replacement', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('{string} is renamed to {string}', async ({ page }: { page: Page }, alias: string, renamed: string) => {
  await rowFor(page, alias, 'prod')
    .getByRole('button', { name: `Edit ${alias}`, exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: `Edit ${alias}`, exact: true })
  await dialog.getByRole('textbox', { name: 'Alias', exact: true }).fill(renamed)
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('the alias {string} is removed while its vault item stays', async ({ page }: { page: Page }, alias: string) => {
  await rowFor(page, alias, 'prod')
    .getByRole('button', { name: `Remove ${alias}`, exact: true })
    .click()
  const dialog = page.getByRole('alertdialog', { name: `Remove ${alias}`, exact: true })
  await dialog.getByRole('button', { name: 'Remove alias and all environment overrides', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm remove alias', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('the vault item behind {string} in {string} is deleted', async ({ page }: { page: Page }, alias: string, environment: string) => {
  await rowFor(page, alias, environment)
    .getByRole('button', { name: `Remove ${alias}`, exact: true })
    .click()
  const dialog = page.getByRole('alertdialog', { name: `Remove ${alias}`, exact: true })
  await dialog.getByRole('button', { name: 'Delete the Bitwarden item…', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm delete item', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('a thread in the seeded project asks the fake model to {string}', async ({ page }: { page: Page }, directive: string) => {
  const project = fixtureFor(page).project
  if ((await page.getByRole('treeitem', { name: 'secret-project', exact: true }).count()) === 0) await registerWorkspaceFolder(page, project)
  if ((await page.getByRole('navigation', { name: 'Session hierarchy', exact: true }).count()) === 0) {
    await startThreadWithModel(page, { project: 'secret-project', model: 'commandcode_work/gpt-6-luna' })
  }
  await sendMessage(page, directive)
})

Then('only global aliases are listed until a project folder is chosen', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'secret-catalog-global-only-without-a-folder', async () => {
    await expect(catalog(page).getByRole('status').filter({ hasText: 'Global aliases are shown. Choose a project folder' })).toBeVisible()
    await expect(aliasRows(page)).toHaveCount(1)
    await expect(rowFor(page, 'GITHUB_TOKEN', 'prod')).toBeVisible()
  })
})

Then('only the load error is shown, without an empty catalog', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'secret-catalog-load-error-replaces-the-empty-catalog', async () => {
    await expect(catalog(page).getByText('Secret metadata could not be loaded. Check the secret CLI and refresh.', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(catalog(page).getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
    await expect(catalog(page).getByText('No secrets yet', { exact: true })).toHaveCount(0)
    await expect(catalog(page).getByText('0 aliases', { exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the {string} scope lists {int} aliases', async ({ page }: { page: Page }, scope: string, count: number) => {
  await recordAssertion(page, `secret-catalog-${scope}-scope-lists-${String(count)}`, async () => {
    await expect(aliasRows(page)).toHaveCount(count)
    if (scope !== 'all') for (const row of await aliasRows(page).all()) await expect(row).toContainText(` · ${scope} · `)
  })
})

Then('filtering by {string} keeps only the matching alias', async ({ page }: { page: Page }, text: string) => {
  await catalog(page).getByRole('textbox', { name: 'Filter aliases', exact: true }).fill(text)
  await recordAssertion(page, 'secret-catalog-text-filter-narrows-aliases', async () => {
    await expect(aliasRows(page)).toHaveCount(1)
    await expect(aliasRows(page).first()).toContainText(text)
  })
  await finishJourneyAssertions(page)
})

Then('the dev DB_PASSWORD reveals on click, hides on timeout and blur, and copies without revealing', async ({ page }: { page: Page }) => {
  const row = rowFor(page, 'DB_PASSWORD', 'dev')
  const reveal = row.getByRole('button', { name: 'Reveal DB_PASSWORD', exact: true })
  const revealed = row.getByRole('status', { name: 'Value of DB_PASSWORD', exact: true })
  await reveal.hover()
  await recordAssertion(page, 'secret-catalog-hover-offers-click-to-reveal', async () => {
    await expect(row.getByText('Click to reveal', { exact: true })).toHaveCSS('opacity', '1')
    await expect(page.getByText('db-e2e-dev-value')).toHaveCount(0)
  })
  await reveal.click()
  await recordAssertion(page, 'secret-catalog-click-reveals-the-exact-value', () => expect(revealed).toHaveText('db-e2e-dev-value'))
  await recordAssertion(page, 'secret-catalog-revealed-value-expires', async () => {
    await expect(revealed).toHaveCount(0, { timeout: 10_000 })
    await expect(reveal).toBeVisible()
  })
  await reveal.click()
  await expect(revealed).toHaveText('db-e2e-dev-value')
  await catalog(page).getByRole('heading', { name: 'Secret Catalog', exact: true }).click()
  await recordAssertion(page, 'secret-catalog-revealed-value-hides-on-blur', async () => {
    await expect(revealed).toHaveCount(0)
    await expect(page.getByText('db-e2e-dev-value')).toHaveCount(0)
  })
  await row.getByRole('button', { name: 'Copy DB_PASSWORD', exact: true }).click()
  await recordAssertion(page, 'secret-catalog-copy-reads-the-exact-alias', async () => {
    await expect(page.getByText('Copied DB_PASSWORD to the clipboard.', { exact: true })).toBeVisible()
    expect((await readStore(page)).clipboard).toBe('db-e2e-dev-value')
    await expect(page.getByText('db-e2e-dev-value')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then(
  'the store holds {string} with the value {string} and the source {string}',
  async ({ page }: { page: Page }, alias: string, value: string, source: string) => {
    await recordAssertion(page, `secret-catalog-store-holds-${value}`, async () => {
      await expect(rowFor(page, alias, 'prod')).toBeVisible()
      const store = await readStore(page)
      const row = store.rows.find(candidate => candidate.alias === alias && candidate.environment === 'prod')
      expect(row?.scope).toBe('project')
      expect(row?.source).toBe(source)
      expect(store.vault[row?.item ?? '']).toBe(value)
    })
    if (value.includes('edited')) await finishJourneyAssertions(page)
  },
)

Then('the store renamed the alias, dropped GITHUB_TOKEN but kept its item, and deleted the dev item', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'secret-catalog-rename-remove-and-delete-reach-the-cli', async () => {
    await expect(rowFor(page, 'DATABASE_PASSWORD', 'prod')).toBeVisible()
    await expect(aliasRows(page).filter({ hasText: 'GITHUB_TOKEN' })).toHaveCount(0)
    const store = await readStore(page)
    expect(store.rows.map(row => `${row.alias}/${row.environment}`).sort()).toEqual(['DATABASE_PASSWORD/prod', 'LOCAL_TOKEN/prod'])
    expect(Object.keys(store.vault).sort()).toEqual(['item-db-prod', 'item-github', 'item-local'])
  })
  await finishJourneyAssertions(page)
})

Then('the tool result {string} {string}', async ({ page }: { page: Page }, expectation: string, text: string) => {
  const turns = fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn')
  const result = turns
    .at(-1)
    ?.messages.filter(message => message.role === 'tool')
    .at(-1)?.text
  await recordAssertion(page, `secret-catalog-tool-result-${expectation}-after-turn-${String(turns.length)}`, () => {
    if (expectation === 'contains') expect(result).toContain(text)
    else expect(result ?? '').not.toContain(text)
  })
})

Then('the secret tools journey is complete', async ({ page }: { page: Page }) => {
  await finishJourneyAssertions(page)
})

When('the Memory Jev secret-reference setting is focused', async ({ page }: { page: Page }) => {
  const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  if (!(await settingsDialog.isVisible())) await openSettingsDialog(page)
  await settingsDialog.getByRole('group', { name: 'Plugins', exact: true }).getByRole('button', { name: 'Memory', exact: true }).click()
  const field = page.locator('[data-settings-namespace="dshfiles-memory"] [data-setting-path="jevSecret"] input[data-secret-input="reference"]')
  await expect(field).toBeVisible()
  await field.focus()
  await expect(page.getByRole('button', { name: 'Bind a secret', exact: true })).toBeVisible()
})

When('the create-and-bind form is cancelled and reopened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Bind a secret', exact: true }).click()
  await page.getByRole('button', { name: 'Add a new secret', exact: true }).click()
  const panel = page.getByTestId('secret-input-panel')
  const secretValue = panel.getByRole('textbox', { name: 'Secret value', exact: true })
  await expect(secretValue).toBeVisible()
  await secretValue.fill('synthetic-cancelled-setup-value')
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Add a new secret', exact: true }).click()
})

Then('the cancelled setup writes no alias and reopens with a blank masked value', async ({ page }: { page: Page }) => {
  const store = await readStore(page)
  const panel = page.getByTestId('secret-input-panel')
  const secretValue = panel.getByRole('textbox', { name: 'Secret value', exact: true })
  await recordAssertion(page, 'secret-catalog-setup-cancel-keeps-value-transient', async () => {
    expect(store.rows.some(row => row.alias === 'SYNTHETIC_SETUP_TOKEN')).toBe(false)
    await expect(secretValue).toHaveValue('')
    await expect(secretValue).toHaveAttribute('type', 'password')
  })
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Bind a secret', exact: true }).click()
})

When('a secret is created and bound with the value {string}', async ({ page }: { page: Page }, value: string) => {
  await page.getByRole('button', { name: 'Bind a secret', exact: true }).click()
  await page.getByRole('button', { name: 'Add a new secret', exact: true }).click()
  const panel = page.getByTestId('secret-input-panel')
  await panel.getByRole('textbox', { name: 'Alias', exact: true }).fill('SYNTHETIC_SETUP_TOKEN')
  await panel.getByRole('textbox', { name: 'Environment', exact: true }).fill('staging')
  const secretValue = panel.getByRole('textbox', { name: 'Secret value', exact: true })
  await expect(secretValue).toHaveAttribute('type', 'password')
  await secretValue.fill(value)
  await panel.getByRole('button', { name: 'Create and bind', exact: true }).click()
  await expect(page.getByTestId('secret-input-panel')).toHaveCount(0)
  const field = page.locator('[data-settings-namespace="dshfiles-memory"] [data-setting-path="jevSecret"] input[data-secret-input="reference"]')
  await expect(field).toHaveValue('secret:SYNTHETIC_SETUP_TOKEN@staging')
  await field.press('Enter')
})

Then('the field stores only {string} while the fake CLI stores the synthetic value', async ({ page }: { page: Page }, reference: string) => {
  const store = await readStore(page)
  const entry = store.rows.find(row => row.alias === 'SYNTHETIC_SETUP_TOKEN')
  const field = page.locator('[data-settings-namespace="dshfiles-memory"] [data-setting-path="jevSecret"] input[data-secret-input="reference"]')
  await recordAssertion(page, 'secret-catalog-setup-stores-value-on-host-and-reference-in-field', async () => {
    expect(entry?.scope).toBe('global')
    expect(entry?.environment).toBe('staging')
    expect(entry).toBeDefined()
    expect(store.vault[entry?.item ?? '']).toBe('synthetic-inline-setup-value')
    await expect(field).toHaveValue(reference)
    expect(await page.locator('body').innerText()).not.toContain('synthetic-inline-setup-value')
  })
})

Then('the secret setup journey is complete', async ({ page }: { page: Page }) => {
  await finishJourneyAssertions(page)
})
