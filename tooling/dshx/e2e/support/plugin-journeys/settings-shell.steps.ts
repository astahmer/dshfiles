import { expect, test, type Page, type Request, type Response, type Route } from '@playwright/test'
import { globalPanelLink } from '../plugin-view-names.js'
import { realpath } from 'node:fs/promises'
import { Then, When } from '../bdd.js'
import { z } from 'zod'
import { finishJourneyAssertions, openSettingsDialog, profileFor, recordAssertion } from '../steps.js'
import { registerWorkspaceFolder } from '../threads.js'

const settingsView = (page: Page) => page.locator('[data-settings-view]')
const searchField = (page: Page) => page.getByRole('searchbox', { name: 'Search settings', exact: true })
const settingRow = (page: Page, path: string) => page.locator(`[data-setting-path="${path}"]`)
const primary = (): string => (process.platform === 'darwin' ? 'Meta' : 'Control')

const openSettings = async (page: Page): Promise<void> => {
  await openSettingsDialog(page)
  await expect(settingsView(page)).toBeVisible()
}

When('Settings is opened from the sidebar', async ({ page }: { page: Page }) => {
  await openSettings(page)
})

Then('Settings remain usable at narrow and wide widths', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-compact-navigation', async () => {
    const sections = page.getByRole('combobox', { name: 'Sections', exact: true })
    const navigation = page.getByRole('navigation', { name: 'Settings', exact: true })
    for (const width of [360, 480, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(settingsView(page)).toBeVisible()
      expect(await settingsView(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      expect(await searchField(page).evaluate(element => element.clientWidth)).toBeGreaterThan(60)
      await expect(page.getByRole('button', { name: 'Open configuration file', exact: true })).toBeVisible()
      if (width <= 480) {
        await expect(navigation).toBeHidden()
        await expect(sections).toBeVisible()
        await sections.click()
        await page.getByRole('option', { name: 'Models', exact: true }).click()
        await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0)
        await expect(sections).toHaveText('Models')
        await expect(page.getByRole('switch', { name: 'Show coding view', exact: true })).toBeHidden()
        await sections.click()
        await page.getByRole('option', { name: 'General', exact: true }).click()
        await expect(page.getByRole('listbox', { includeHidden: true })).toHaveCount(0)
        await expect(page.getByRole('switch', { name: 'Show coding view', exact: true })).toBeVisible()
      } else {
        await expect(navigation).toBeVisible()
        await expect(sections).toBeHidden()
      }
      if (width === 360) await page.screenshot({ path: test.info().outputPath('settings-shell-compact-navigation.png') })
    }
  })
  await finishJourneyAssertions(page)
})

Then('the DSH release status and manual check action are available', async ({ page }: { page: Page }) => {
  const notice = page.locator('[data-dsh-release-notice]')
  await recordAssertion(page, 'settings-shell-shows-release-check', async () => {
    await expect(notice).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Check for DSH updates', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the native sections and General rows show in the Settings dialog', async ({ page }: { page: Page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await recordAssertion(page, 'settings-shell-port-keeps-native-sections', async () => {
    await expect(dialog).toBeVisible()
    for (const section of ['General', 'Models', 'Built-in plugins']) await expect(dialog.getByRole('button', { name: section, exact: true })).toBeVisible()
    await expect(dialog.getByRole('switch', { name: 'Show coding view', exact: true })).toBeVisible()
    await expect(dialog.getByText(/^Current version: \d/)).toBeVisible()
  })
})

Then('the Settings shortcut closes and reopens the dialog', async ({ page }: { page: Page }) => {
  // The native command binds Web Mod+Alt+, on macOS and Windows only; Linux Web has no default to press.
  if (process.platform === 'linux') {
    await finishJourneyAssertions(page)
    return
  }
  await recordAssertion(page, 'settings-shell-port-keeps-the-shortcut', async () => {
    await page.keyboard.press(`${primary()}+Alt+Comma`)
    await expect(settingsView(page)).toHaveCount(0)
    await page.keyboard.press(`${primary()}+Alt+Comma`)
    await expect(settingsView(page)).toHaveAttribute('data-settings-view', 'modal')
  })
  await finishJourneyAssertions(page)
})

Then('Settings fills the main view under its own tab', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-opens-as-a-main-tab', async () => {
    await expect(page.getByRole('tablist', { name: 'Open views', exact: true }).getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(settingsView(page)).toHaveAttribute('data-settings-view', 'tab')
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
    await expect(page.locator('[data-slot="main"] [data-settings-panel-host] [data-settings-view="tab"]')).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Settings dialog is expanded', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Expand to the full window', exact: true }).click()
})

Then('the dialog fills the window and can be restored', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-dialog-expands', async () => {
    await expect(settingsView(page)).toHaveAttribute('data-settings-view', 'expanded')
    const viewport = page.viewportSize()
    const box = await settingsView(page).boundingBox()
    expect(box?.width).toBe(viewport?.width)
    await page.getByRole('button', { name: 'Restore the dialog size', exact: true }).click()
    await expect(settingsView(page)).toHaveAttribute('data-settings-view', 'modal')
  })
})

When('the Settings dialog is moved into a tab', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Open in a tab', exact: true }).click()
})

Then('Settings fills the main view', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-dialog-moves-into-the-main-view', async () => {
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
    await expect(page.locator('[data-slot="main"] [data-settings-view="tab"]')).toBeVisible()
    await expect(searchField(page)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('Settings are searched for {string}', async ({ page }: { page: Page }, query: string) => {
  await searchField(page).fill(query)
})

Then('the Main tabs settings are listed with highlights, a count and a tree count', async ({ page }: { page: Page }) => {
  const results = page.locator('[data-settings-results]')
  await recordAssertion(page, 'settings-shell-search-lists-grouped-matches', async () => {
    await expect(page.getByRole('status').filter({ hasText: /\d+ Settings? Found/ })).toBeVisible()
    await expect(results.getByRole('region', { name: 'Main tabs', exact: true })).toBeVisible()
    await expect(results.locator('[data-setting-path="maxTabs"]')).toBeVisible()
    await expect(results.locator('[data-setting-path="maxTabs"] mark').first()).toHaveText(/tabs/i)
    await expect(page.getByRole('group', { name: 'Plugins' }).getByRole('button', { name: /^Main tabs \d+$/ })).toBeVisible()
  })
})

When('Escape is pressed in the search field', async ({ page }: { page: Page }) => {
  await searchField(page).press('Escape')
})

Then('the query is cleared and the General section shows again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-escape-clears-the-query', async () => {
    await expect(searchField(page)).toHaveValue('')
    await expect(page.locator('[data-settings-results]')).toHaveCount(0)
    await expect(page.getByRole('switch', { name: 'Show coding view', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const codingViewEntry = (page: Page) => page.locator('[data-settings-results] [data-settings-result-entry="developer-tools"]')

Then('the coding view switch is listed under General', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-search-lists-section-entries', async () => {
    await expect(page.locator('[data-settings-results]').getByRole('region', { name: 'General', exact: true })).toBeVisible()
    await expect(codingViewEntry(page)).toContainText('Show coding view')
    await expect(page.getByRole('switch', { name: 'Show coding view', exact: true })).toHaveCount(0)
  })
})

When('that search entry is picked', async ({ page }: { page: Page }) => {
  await codingViewEntry(page).click()
})

Then('the General section shows with the coding view switch focused', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-search-entry-opens-at-its-control', async () => {
    await expect(searchField(page)).toHaveValue('')
    await expect(page.getByRole('switch', { name: 'Show coding view', exact: true })).toBeFocused()
  })
  await finishJourneyAssertions(page)
})

When('the Main tabs page is opened in Settings', async ({ page }: { page: Page }) => {
  await openSettings(page)
  await page.getByRole('group', { name: 'Plugins' }).getByRole('button', { name: 'Main tabs', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Main tabs', exact: true })).toBeVisible()
})

const expectRichMainTabsControls = async (scope: ReturnType<Page['locator']>): Promise<void> => {
  await expect(scope.getByText('Enabled', { exact: true })).toBeVisible()
  await expect(scope.getByText('Show browser-like tabs above the main view for threads and panels.')).toBeVisible()
  await expect(scope.getByRole('switch', { name: 'Enabled', exact: true })).toBeVisible()
  const maxTabs = scope.getByRole('spinbutton', { name: 'Max tabs', exact: true })
  await expect(maxTabs).toHaveValue('12')
  await expect(maxTabs).toHaveAttribute('min', '2')
  await expect(maxTabs).toHaveAttribute('max', '50')
  await expect(scope.getByRole('radio', { name: 'Preview', exact: true })).toBeVisible()
  await expect(scope.getByRole('radio', { name: 'Per project', exact: true })).toBeVisible()
  await expect(scope.getByRole('textbox')).toHaveCount(0)
}

Then('its settings show a titled switch, a bounded number input and segmented choices', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-plugin-page-has-real-controls', () =>
    expectRichMainTabsControls(page.getByRole('region', { name: 'Main tabs', exact: true })),
  )
})

When('the Main tabs plugin page is opened from the Plugins panel', async ({ page }: { page: Page }) => {
  await globalPanelLink(page, 'Plugins').click()
  await page.getByRole('button', { name: 'View @dshfiles/main-tabs', exact: true }).click()
})

Then('the same controls render on the plugin page', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-plugins-page-uses-the-same-renderer', () =>
    expectRichMainTabsControls(page.locator('[data-settings-shell-plugin-page="@dshfiles/main-tabs"]')),
  )
  await finishJourneyAssertions(page)
})

When('Max tabs is set to {int}', async ({ page }: { page: Page }, value: number) => {
  const input = settingRow(page, 'maxTabs').getByRole('spinbutton', { name: 'Max tabs', exact: true })
  await input.fill(String(value))
  await input.press('Enter')
})

Then('the Max tabs row is marked modified and offers Reset to default', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-modified-row', async () => {
    await expect(settingRow(page, 'maxTabs')).toHaveAttribute('data-modified', '')
    await settingRow(page, 'maxTabs').hover()
    await expect(settingRow(page, 'maxTabs').getByRole('button', { name: 'Reset to default', exact: true })).toBeVisible()
    await expect(settingRow(page, 'enabled')).not.toHaveAttribute('data-modified')
  })
})

When('Max tabs is reset to its default', async ({ page }: { page: Page }) => {
  await settingRow(page, 'maxTabs').hover()
  await settingRow(page, 'maxTabs').getByRole('button', { name: 'Reset to default', exact: true }).click()
})

Then('Max tabs is back to {int} and no longer marked modified', async ({ page }: { page: Page }, value: number) => {
  await recordAssertion(page, 'settings-shell-reset-to-default', async () => {
    await expect(settingRow(page, 'maxTabs').getByRole('spinbutton', { name: 'Max tabs', exact: true })).toHaveValue(String(value))
    await expect(settingRow(page, 'maxTabs')).not.toHaveAttribute('data-modified')
    await expect(settingRow(page, 'maxTabs').getByRole('button', { name: 'Reset to default', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

const SETTINGS_MUTATE = /settings[./]mutate/
const isSettingsWrite = (request: Request): boolean => request.method() === 'POST' && SETTINGS_MUTATE.test(`${request.url()} ${request.postData() ?? ''}`)
const heldSettingsWrites = new Map<Page, Route[]>()
const settledSettingsWrites = new Map<Page, Response[]>()

// A Host write persists the profile and reloads the entry, so a user can act while one is in flight; holding it makes
// that window deterministic instead of depending on machine load.
When('settings writes are held', async ({ page }: { page: Page }) => {
  heldSettingsWrites.set(page, [])
  await page.route('**/*', async route => {
    const held = heldSettingsWrites.get(page)
    if (held === undefined || !isSettingsWrite(route.request())) {
      await route.fallback()
      return
    }
    held.push(route)
  })
})

When('the held settings writes finish', async ({ page }: { page: Page }) => {
  await expect.poll(() => heldSettingsWrites.get(page)?.length).toBe(1)
  const settled: Response[] = []
  settledSettingsWrites.set(page, settled)
  page.on('response', response => {
    if (isSettingsWrite(response.request())) settled.push(response)
  })
  const held = heldSettingsWrites.get(page) ?? []
  heldSettingsWrites.delete(page)
  for (const route of held) await route.fallback()
  // Set, then reset: the form queues the reset behind the held set, so both reach the Host one after the other.
  await expect.poll(() => settled.length).toBe(2)
})

Then('the Host accepted both writes and Max tabs is back to {int}', async ({ page }: { page: Page }, value: number) => {
  await recordAssertion(page, 'settings-shell-reset-while-saving', async () => {
    const accepted = await Promise.all(
      (settledSettingsWrites.get(page) ?? []).map(async response => z.object({ result: z.object({ ok: z.boolean() }) }).parse(await response.json()).result.ok),
    )
    expect(accepted).toEqual([true, true])
    await expect(settingRow(page, 'maxTabs').getByRole('spinbutton', { name: 'Max tabs', exact: true })).toHaveValue(String(value))
    await expect(settingRow(page, 'maxTabs')).not.toHaveAttribute('data-modified')
    await expect(settingRow(page, 'maxTabs').getByRole('alert')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('the configuration file menu is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'More ways to open the configuration file', exact: true }).click()
})

Then('it offers to copy the configuration file path', async ({ page }: { page: Page }) => {
  // Opening an app or revealing the file would act on the machine's desktop, so the journey stops at the offer.
  await recordAssertion(page, 'settings-shell-config-menu-offers-the-path', async () => {
    await expect(page.getByRole('menuitem', { name: 'Copy path', exact: true })).toBeVisible()
    // The open menu hides the rest of the page from the accessibility tree, so the button is checked once it closes.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open configuration file', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const fileLinksRow = (page: Page) => page.locator('[data-settings-results] [data-setting-path="openFileLinks"]')

Then('the Editor file-link preference is found switched on', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'editor-file-links-search-finds-the-setting', () =>
    expect(fileLinksRow(page).getByRole('switch', { name: 'Open file links', exact: true })).toHaveAttribute('aria-checked', 'true'),
  )
})

When('the Editor file-link preference is switched off in the General section', async ({ page }: { page: Page }) => {
  await searchField(page).fill('')
  await page.getByRole('button', { name: 'General', exact: true }).click()
  const fileLinksSwitch = page.getByRole('dialog').getByRole('switch', { name: 'Open file links in Editor' })
  await recordAssertion(page, 'editor-file-links-native-general-row', () => expect(fileLinksSwitch).toHaveAttribute('aria-checked', 'true'))
  await fileLinksSwitch.click()
  await expect(fileLinksSwitch).toHaveAttribute('aria-checked', 'false')
})

Then('Settings search shows the Editor file-link preference switched off', async ({ page }: { page: Page }) => {
  await searchField(page).fill('open file links')
  await recordAssertion(page, 'editor-file-links-native-row-writes-the-host-setting', () =>
    expect(fileLinksRow(page).getByRole('switch', { name: 'Open file links', exact: true })).toHaveAttribute('aria-checked', 'false'),
  )
  await finishJourneyAssertions(page)
})

const sidePanelSettings = (page: Page) => page.locator('[data-settings-view="sidebar"]')

When('the side panel opens Settings', async ({ page }: { page: Page }) => {
  const openPanel = page.getByRole('button', { name: 'Open right sidebar', exact: true })
  // The empty isolated profile has no selected project, so New session alone cannot expose the thread's side panel.
  if (!(await openPanel.isVisible())) await registerWorkspaceFolder(page, await realpath(profileFor(page).homeRoot))
  await expect(openPanel).toBeVisible()
  await openPanel.click()
  await page.getByText('Edit Settings in this panel.', { exact: true }).click()
  await expect(sidePanelSettings(page)).toBeVisible()
})

Then('the side panel shows a Settings tab with its sections', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-side-panel-opens', async () => {
    const panel = sidePanelSettings(page)
    await expect(panel).toHaveAttribute('data-settings-view', 'sidebar')
    await expect(panel.getByRole('searchbox', { name: 'Search settings', exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'General', exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Models', exact: true })).toBeVisible()
    // The side panel is not the dialog and not a main-view tab: Settings lives in the panel alone.
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
    await expect(page.locator('[data-slot="main"] [data-settings-view="tab"]')).toHaveCount(0)
  })
})

When('a section is picked in the side panel', async ({ page }: { page: Page }) => {
  await sidePanelSettings(page).getByRole('button', { name: 'General', exact: true }).click()
})

Then('the section fills the panel and Back returns to the section list', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-shell-side-panel-drills-in', async () => {
    const panel = sidePanelSettings(page)
    await expect(panel.getByRole('switch', { name: 'Show coding view', exact: true })).toBeVisible()
    const back = panel.getByRole('button', { name: 'Back to all settings', exact: true })
    // A wide panel keeps the dialog's two columns, where the section list never leaves the screen.
    if (!(await back.isVisible())) return
    await back.click()
    await expect(panel.getByRole('button', { name: 'Models', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
