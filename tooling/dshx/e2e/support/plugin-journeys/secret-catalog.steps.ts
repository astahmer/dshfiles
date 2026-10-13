import { expect, type Page } from '@playwright/test'
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { After, Before, Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

/**
 * The Host resolves the `secret` executable from the PATH it was launched with, so a tagged scenario puts the
 * fake CLI first on PATH before its Given step boots the Host, and seeds the store with synthetic values.
 */
interface SecretFixture {
  readonly root: string
  readonly project: string
  readonly storePath: string
  readonly previousPath: string | undefined
}

const StoreRow = { alias: '', scope: '', root: null as string | null, environment: '', item: '', field: 'password', source: '' }
type StoreRow = typeof StoreRow & { readonly name?: string }
interface Store {
  rows: StoreRow[]
  vault: Record<string, string>
  clipboard?: string
}

const fixtures = new WeakMap<Page, SecretFixture>()
const fakeCli = join(dirname(fileURLToPath(import.meta.url)), '..', 'fake-secret-cli.mjs')

const fixtureFor = (page: Page): SecretFixture => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) throw new Error('The fake secret CLI was not installed; tag the scenario @fake-secret-cli.')
  return fixture
}

const readStore = async (page: Page): Promise<Store> => JSON.parse(await readFile(fixtureFor(page).storePath, 'utf8'))

Before({ tags: '@fake-secret-cli' }, async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-secret-catalog-e2e-')
  const bin = join(root, 'bin')
  const project = join(root, 'secret-project')
  await mkdir(bin)
  await mkdir(project)
  await copyFile(fakeCli, join(bin, 'secret'))
  await chmod(join(bin, 'secret'), 0o755)
  const row = (fields: Partial<StoreRow>): StoreRow => ({ ...StoreRow, ...fields })
  const store: Store = {
    rows: [
      row({ alias: 'GITHUB_TOKEN', scope: 'global', environment: 'prod', item: 'item-github', source: 'github' }),
      row({ alias: 'DB_PASSWORD', scope: 'project', root: project, environment: 'prod', item: 'item-db-prod', source: 'postgres' }),
      row({ alias: 'DB_PASSWORD', scope: 'project', root: project, environment: 'dev', item: 'item-db-dev', source: 'postgres' }),
      row({ alias: 'LOCAL_TOKEN', scope: 'local', root: project, environment: 'prod', item: 'item-local', source: 'laptop' }),
    ],
    vault: { 'item-github': 'gh-e2e-global-value', 'item-db-prod': 'db-e2e-prod-value', 'item-db-dev': 'db-e2e-dev-value', 'item-local': 'local-e2e-value' },
  }
  const storePath = join(bin, 'store.json')
  await writeFile(storePath, JSON.stringify(store))
  fixtures.set(page, { root, project, storePath, previousPath: process.env.PATH })
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`
})

After({ tags: '@fake-secret-cli' }, async ({ page }: { page: Page }) => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) return
  fixtures.delete(page)
  process.env.PATH = fixture.previousPath
  await rm(fixture.root, { recursive: true, force: true })
})

const catalog = (page: Page) => page.getByRole('main')
const aliasRows = (page: Page) => catalog(page).getByRole('rowgroup').nth(1).getByRole('row')
const rowFor = (page: Page, alias: string, environment: string) => aliasRows(page).filter({ hasText: new RegExp(`${alias} · \\w+ · ${environment} ·`) })

const openCatalog = async (page: Page): Promise<void> => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Secret Catalog', exact: true }).click()
  await expect(catalog(page).getByRole('heading', { name: 'Secret Catalog', exact: true })).toBeVisible()
}

When('the Secret Catalog is opened', async ({ page }: { page: Page }) => {
  await openCatalog(page)
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

When('the alias {string} is added to the project with the value {string}', async ({ page }: { page: Page }, alias: string, value: string) => {
  await catalog(page).getByRole('button', { name: '+ Add Secret', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add secret alias', exact: true })
  await dialog.getByRole('textbox', { name: 'Alias', exact: true }).fill(alias)
  await dialog.getByRole('combobox', { name: 'Value creation', exact: true }).click()
  await page.getByRole('option', { name: 'Enter value', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Secret value', exact: true }).fill(value)
  await dialog.getByRole('textbox', { name: 'Source URL', exact: true }).fill('https://api.example.test')
  await dialog.getByRole('button', { name: 'Add alias', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('{string} gets the source {string} and the value {string}', async ({ page }: { page: Page }, alias: string, source: string, value: string) => {
  await rowFor(page, alias, 'prod').getByRole('button', { name: `Edit ${alias}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Edit ${alias}`, exact: true })
  await dialog.getByRole('textbox', { name: 'Source URL', exact: true }).fill(source)
  await dialog.getByRole('textbox', { name: 'Replace value (optional)', exact: true }).fill(value)
  await dialog.getByRole('button', { name: 'Review replacement', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm replacement', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('{string} is renamed to {string}', async ({ page }: { page: Page }, alias: string, renamed: string) => {
  await rowFor(page, alias, 'prod').getByRole('button', { name: `Edit ${alias}`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Edit ${alias}`, exact: true })
  await dialog.getByRole('textbox', { name: 'Alias', exact: true }).fill(renamed)
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('the alias {string} is removed while its vault item stays', async ({ page }: { page: Page }, alias: string) => {
  await rowFor(page, alias, 'prod').getByRole('button', { name: `Remove ${alias}`, exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: `Remove ${alias}`, exact: true })
  await dialog.getByRole('button', { name: 'Remove alias and all environment overrides', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm remove alias', exact: true }).click()
  await expect(dialog).toBeHidden()
})

When('the vault item behind {string} in {string} is deleted', async ({ page }: { page: Page }, alias: string, environment: string) => {
  await rowFor(page, alias, environment).getByRole('button', { name: `Remove ${alias}`, exact: true }).click()
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

Then('the dev DB_PASSWORD previews masked, reveals in full, then hides itself', async ({ page }: { page: Page }) => {
  const row = rowFor(page, 'DB_PASSWORD', 'dev')
  await row.getByRole('button', { name: 'Preview DB_PASSWORD', exact: true }).click()
  await recordAssertion(page, 'secret-catalog-preview-masks-the-middle', async () => {
    await expect(row.getByRole('status')).toHaveText('db-e…alue')
  })
  await row.getByRole('button', { name: 'Reveal full DB_PASSWORD', exact: true }).click()
  await recordAssertion(page, 'secret-catalog-full-reveal-shows-the-exact-value', () => expect(row.getByRole('status')).toHaveText('db-e2e-dev-value'))
  await recordAssertion(page, 'secret-catalog-revealed-value-expires', async () => {
    await expect(row.getByRole('status')).toHaveCount(0, { timeout: 10_000 })
    await expect(row.getByLabel('Hidden secret value', { exact: true })).toBeVisible()
  })
  await row.getByRole('button', { name: 'Copy DB_PASSWORD', exact: true }).click()
  await recordAssertion(page, 'secret-catalog-copy-reads-the-exact-alias', async () => {
    await expect(page.getByText('Copied DB_PASSWORD to the clipboard.', { exact: true })).toBeVisible()
    expect((await readStore(page)).clipboard).toBe('db-e2e-dev-value')
    await expect(page.getByText('db-e2e-dev-value')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the store holds {string} with the value {string} and the source {string}', async ({ page }: { page: Page }, alias: string, value: string, source: string) => {
  await recordAssertion(page, `secret-catalog-store-holds-${value}`, async () => {
    await expect(rowFor(page, alias, 'prod')).toBeVisible()
    const store = await readStore(page)
    const row = store.rows.find(candidate => candidate.alias === alias && candidate.environment === 'prod')
    expect(row?.scope).toBe('project')
    expect(row?.source).toBe(source)
    expect(store.vault[row?.item ?? '']).toBe(value)
  })
  if (value.includes('edited')) await finishJourneyAssertions(page)
})

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
