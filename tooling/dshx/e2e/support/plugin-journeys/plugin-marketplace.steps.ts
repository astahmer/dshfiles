import { expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { card, startFakeHub, type FakeHub } from '../fake-hub.js'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, profileFor, recordAssertion } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

/**
 * A loopback Framework Hub: the plugin-marketplace Host accepts loopback HTTP and an absolute local .tgz target from
 * one, so a journey can browse a catalog and install a freshly packed bundle without the network.
 */
const TARGET_PACKAGE = '@dshx-e2e/marketplace-target'
const hubs = new WeakMap<Page, FakeHub>()

const hubFor = (page: Page): FakeHub => {
  const hub = hubs.get(page)
  if (hub === undefined) throw new Error('The local Framework Hub was not started for this scenario.')
  return hub
}

const packTarget = async (root: string): Promise<string> => {
  const target = join(root, 'target')
  const packs = join(root, 'packs')
  await mkdir(target, { recursive: true })
  await mkdir(packs, { recursive: true })
  await writeFile(
    join(target, 'package.json'),
    JSON.stringify({
      name: TARGET_PACKAGE,
      version: '1.0.0',
      type: 'module',
      main: './index.js',
      files: ['index.js', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  )
  await writeFile(join(target, 'index.js'), "export const name = 'marketplace-e2e-target'\nexport function apply() {}\n")
  await writeFile(join(target, 'cordis.patch.yml'), `- insert:\n    - id: marketplace-e2e-target\n      name: "${TARGET_PACKAGE}"\n`)
  const pack = spawnSync('pnpm', ['pack', '--pack-destination', packs], { cwd: target, encoding: 'utf8', env: process.env })
  if (pack.status !== 0) throw new Error(`pnpm pack failed: ${pack.stderr}`)
  const archive = (await readdir(packs)).find(file => file.endsWith('.tgz'))
  if (archive === undefined) throw new Error('The target bundle did not pack.')
  return join(packs, archive)
}

When('a local Framework Hub lists three plugins and serves a packed target bundle', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-marketplace-e2e-')
  const tarball = await packTarget(root)
  const items = [
    card({ slug: 'marketplace-e2e-target', name: 'Target bundle', scope: TARGET_PACKAGE, compat: '>=0.2.0-rc.1 <0.3.0-0', stars: 3 }),
    card({ slug: 'starred-helper', name: 'Starred helper', scope: '@dshx-e2e/starred-helper', compat: '>=0.2.0-rc.1 <0.3.0-0', stars: 40 }),
    card({ slug: 'future-only', name: 'Future only', scope: '@dshx-e2e/future-only', compat: '>=9.0.0', stars: 1 }),
  ]
  const hub = await startFakeHub({ root, tarball, items })
  hubs.set(page, hub)
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.getByRole('button', { name: 'View @dshfiles/plugin-marketplace', exact: true }).click()
  await page.getByRole('textbox', { name: 'Hub base url', exact: true }).fill(hub.baseUrl)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

When('the Hub {string} fails', async ({ page }: { page: Page }, which: string) => {
  if (which === 'catalog') hubFor(page).failList = true
  else hubFor(page).failDetail = true
})

When('the Hub {string} recovers', async ({ page }: { page: Page }, which: string) => {
  if (which === 'catalog') hubFor(page).failList = false
  else hubFor(page).failDetail = false
})

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })
const pluginCards = (page: Page) => settingsDialog(page).getByRole('list', { name: 'Plugin list', exact: true }).getByRole('listitem')

When('the Framework Hub tab is opened in Settings', async ({ page }: { page: Page }) => {
  await openSettingsDialog(page)
  await settingsDialog(page).getByRole('button', { name: 'Built-in plugins', exact: true }).click()
  await settingsDialog(page).getByRole('tab', { name: 'Framework Hub', exact: true }).click()
  await expect(settingsDialog(page).getByText('Framework Hub plugins', { exact: true })).toBeVisible()
})

When('{string} is downloaded through both confirmations', async ({ page }: { page: Page }, name: string) => {
  await settingsDialog(page)
    .getByRole('button', { name: new RegExp(`^(Download|Retry download) ${name}$`) })
    .click()
  const dialog = page.getByRole('dialog', { name: /^(Install plugin|Confirm the risk)$/ })
  await expect(dialog).toContainText(TARGET_PACKAGE)
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Confirm the risk', exact: true })).toBeVisible()
  await page.getByRole('dialog', { name: 'Confirm the risk', exact: true }).getByRole('button', { name: 'Download and install', exact: true }).click()
})

Then('the catalog lists the Hub plugins and narrows by search, sort and compatibility', async ({ page }: { page: Page }) => {
  const hub = hubFor(page)
  await recordAssertion(page, 'plugin-marketplace-lists-the-hub-catalog', async () => {
    await expect(pluginCards(page)).toHaveCount(3)
    await expect(settingsDialog(page).getByText('3 plugins', { exact: true })).toBeVisible()
  })
  await settingsDialog(page)
    .getByRole('searchbox', { name: 'Search plugins', exact: true })
    .or(settingsDialog(page).getByRole('textbox', { name: 'Search plugins', exact: true }))
    .fill('starred')
  await recordAssertion(page, 'plugin-marketplace-searches-the-hub', async () => {
    await expect(pluginCards(page)).toHaveCount(1)
    await expect(pluginCards(page).first()).toContainText('Starred helper')
    expect(hub.queries.some(query => query.get('q') === 'starred')).toBe(true)
  })
  await settingsDialog(page).getByRole('button', { name: 'Clear search', exact: true }).click()
  await settingsDialog(page).getByRole('radio', { name: 'Most stars', exact: true }).click()
  await recordAssertion(page, 'plugin-marketplace-sorts-by-stars', async () => {
    await expect(pluginCards(page).first()).toContainText('Starred helper')
    expect(hub.queries.some(query => query.get('sort') === 'stars')).toBe(true)
  })
  await settingsDialog(page).getByRole('button', { name: 'Compatible only', exact: true }).click()
  await recordAssertion(page, 'plugin-marketplace-hides-incompatible-plugins', async () => {
    await expect(pluginCards(page)).toHaveCount(2)
    await expect(settingsDialog(page).getByText('1 incompatible hidden', { exact: true }).first()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the catalog reports the Hub failure and recovers on Retry without inventing plugins', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'plugin-marketplace-catalog-failure-has-a-retry', async () => {
    await expect(
      settingsDialog(page).getByText('The plugin marketplace is unavailable. Check the Framework Hub URL or network connection.', { exact: true }),
    ).toBeVisible()
    await expect(pluginCards(page)).toHaveCount(0)
  })
  hubFor(page).failList = false
  await settingsDialog(page).getByRole('button', { name: 'Retry', exact: true }).click()
  await recordAssertion(page, 'plugin-marketplace-retry-loads-the-catalog', async () => {
    await expect(pluginCards(page)).toHaveCount(3)
    await expect(settingsDialog(page).getByRole('button', { name: /^Uninstall/ })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the bundle is installed into the Profile with a restart notice', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await recordAssertion(page, 'plugin-marketplace-install-activates-the-bundle', async () => {
    await expect(page.getByText('The plugin was added to the current Profile. Restart the Profile to activate it.', { exact: true })).toBeVisible({
      timeout: 180_000,
    })
    const manifest: unknown = JSON.parse(await readFile(join(profile.homeRoot, 'profiles', profile.profile, 'package.json'), 'utf8'))
    expect(JSON.stringify(manifest)).toContain(TARGET_PACKAGE)
  })
  await finishJourneyAssertions(page)
})

Then('the install fails visibly and leaves the Profile unchanged', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await recordAssertion(page, 'plugin-marketplace-install-failure-is-retryable', async () => {
    await expect(page.getByText('The plugin install information could not be loaded from Framework Hub.', { exact: true })).toBeVisible()
    const manifest = await readFile(join(profile.homeRoot, 'profiles', profile.profile, 'package.json'), 'utf8')
    expect(manifest).not.toContain(TARGET_PACKAGE)
  })
})

When('the failed install is retried through both confirmations again', async ({ page }: { page: Page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Retry', exact: true }).click()
  await page
    .getByRole('dialog', { name: /^(Install plugin|Confirm the risk)$/ })
    .getByRole('button', { name: 'Continue', exact: true })
    .click()
  await page.getByRole('dialog', { name: 'Confirm the risk', exact: true }).getByRole('button', { name: 'Download and install', exact: true }).click()
})

After(async ({ page }: { page: Page }) => {
  const hub = hubs.get(page)
  if (hub === undefined) return
  hubs.delete(page)
  await hub.close()
  await rm(hub.root, { recursive: true, force: true })
})
