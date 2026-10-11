import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, recordAssertion } from '../steps.js'

const settingsPageSearch = (page: Page) => page.getByRole('main').getByRole('searchbox', { name: 'Search settings' })
const maxResultsEditor = (page: Page) => page.getByRole('region', { name: 'maxResults' }).last().getByRole('spinbutton', { name: 'Current value' })

When('the Settings Search section is opened', async ({ page }: { page: Page }) => {
  const settingsButton = page.getByRole('button', { name: 'Settings', exact: true })
  try {
    await settingsButton.click({ timeout: 10_000 })
  } catch (error) {
    const browserState = await page.evaluate(() => {
      const isVisible = (element: HTMLElement): boolean => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .filter(isVisible)
        .map(dialog => ({
          title: dialog.querySelector<HTMLElement>('[role="heading"]')?.innerText.trim() ?? '',
          alerts: Array.from(dialog.querySelectorAll<HTMLElement>('[role="alert"]'), alert => alert.innerText.trim()),
          buttons: Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'), button => button.innerText.trim()),
        }))
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')
      const rect = button?.getBoundingClientRect()
      const target = rect === undefined ? null : document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return {
        dialogs,
        settingsTarget: target === null ? null : { tag: target.tagName, role: target.getAttribute('role'), className: String(target.className) },
        reconnectButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label*="reconnect" i]'), item =>
          item.getAttribute('aria-label'),
        ),
      }
    })
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\nDOM state: ${JSON.stringify(browserState)}\nBrowser events: ${browserDiagnosticsFor(page).join(' | ')}`)
  }
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(settingsPageSearch(page)).toBeVisible()
})

When('the Settings navigation search opens and receives focus', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const navigationSearch = page.getByRole('dialog').getByRole('navigation').getByRole('searchbox', { name: 'Search settings' })
  await expect(navigationSearch).toBeFocused()
})

When('the maxResults setting is opened with Enter', async ({ page }: { page: Page }) => {
  const navigationSearch = page.getByRole('dialog').getByRole('navigation').getByRole('searchbox', { name: 'Search settings' })
  await navigationSearch.fill('Most results listed under the navigation search field')
  await expect(page.getByRole('dialog').getByRole('button', { name: /maxResults/ })).toHaveAttribute('aria-current', 'true')
  await navigationSearch.press('Enter')
})

When('the ui-theme preference is opened from navigation results', async ({ page }: { page: Page }) => {
  const navigation = page.getByRole('dialog').getByRole('navigation')
  const navigationSearch = navigation.getByRole('searchbox', { name: 'Search settings' })
  await navigationSearch.fill('light')
  const preferenceResult = navigation.getByRole('button', { name: /preference.*ui-theme/i }).first()
  await expect(preferenceResult).toBeVisible()
  await preferenceResult.click()
})

When('the Editor openFileLinks setting is opened from navigation results', async ({ page }: { page: Page }) => {
  const navigation = page.getByRole('dialog').getByRole('navigation')
  const navigationSearch = navigation.getByRole('searchbox', { name: 'Search settings' })
  await navigationSearch.fill('openFileLinks')
  const settingResult = navigation.getByRole('button', { name: /openFileLinks/i }).first()
  await expect(settingResult).toBeVisible()
  await settingResult.click()
})

When('Settings are searched for {string}', async ({ page }: { page: Page }, settingName: string) => {
  await settingsPageSearch(page).fill(settingName)
})

When('the maxResults setting is opened', async ({ page }: { page: Page }) => {
  await page
    .getByRole('button', { name: /maxResults/ })
    .first()
    .click()
})

Then('the settings index shows the maxResults setting', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-index-shows-max-results', () => expect(page.getByRole('button', { name: /maxResults/ }).first()).toBeVisible())
  await finishJourneyAssertions(page)
})

Then('the selected navigation setting exposes its live typed editor', async ({ page }: { page: Page }) => {
  const region = page.getByRole('region', { name: 'maxResults' }).last()
  const editor = maxResultsEditor(page)
  await recordAssertion(page, 'navigation-search-opens-the-live-typed-editor', async () => {
    await expect(region).toBeVisible()
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue('30')
  })
  await page.keyboard.press('Escape')
  await recordAssertion(page, 'escape-closes-the-editor-and-restores-search-focus', async () => {
    await expect(region).toBeHidden()
    await expect(page.getByRole('dialog').getByRole('navigation').getByRole('searchbox', { name: 'Search settings' })).toBeFocused()
  })
  await finishJourneyAssertions(page)
})

Then('the Appearance preference uses its native owner or typed fallback', async ({ page }: { page: Page }) => {
  const dialog = page.getByRole('dialog')
  const fallback = dialog.getByRole('region', { name: /preference/i }).last()
  if ((await fallback.count()) > 0) {
    await recordAssertion(page, 'search-fallback-keeps-referenced-union-as-choice-control', async () => {
      await expect(fallback).toBeVisible()
      await expect(fallback.getByRole('combobox', { name: 'Current value' })).toBeVisible()
      await expect(fallback.getByRole('textbox')).toHaveCount(0)
    })
  } else {
    await recordAssertion(page, 'search-opens-native-appearance-controls', async () => {
      await expect(dialog.getByText('Appearance', { exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Light', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Dark', exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'System', exact: true })).toBeVisible()
      await expect(dialog.locator('button[aria-pressed="true"]')).toBeFocused()
    })
  }
  await finishJourneyAssertions(page)
})

Then('the Editor file-link preference uses its native General switch and is focused', async ({ page }: { page: Page }) => {
  const fileLinksSwitch = page.getByRole('dialog').getByRole('switch', { name: 'Open file links in Editor' })
  await recordAssertion(page, 'editor-file-links-search-opens-native-general-row', async () => {
    await expect(fileLinksSwitch).toBeVisible()
    await expect(fileLinksSwitch).toHaveAttribute('aria-checked', 'true')
    await expect(fileLinksSwitch).toBeFocused()
  })
  await fileLinksSwitch.click()
  await recordAssertion(page, 'editor-file-links-switch-persists-host-setting', () => expect(fileLinksSwitch).toHaveAttribute('aria-checked', 'false'))
  await fileLinksSwitch.click()
  await recordAssertion(page, 'editor-file-links-switch-restores-default', () => expect(fileLinksSwitch).toHaveAttribute('aria-checked', 'true'))
  await finishJourneyAssertions(page)
})

Then('a valid numeric value can be saved and its inherited value restored', async ({ page }: { page: Page }) => {
  const editor = maxResultsEditor(page)
  await recordAssertion(page, 'max-results-editor-starts-with-inherited-default', async () => {
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue('30')
    await expect(page.getByRole('region', { name: 'maxResults' }).getByText(/Host document · revision \d+ · Inherited value/)).toBeVisible()
  })

  await editor.fill('37')
  await page.getByRole('button', { name: 'Save setting', exact: true }).click()
  await recordAssertion(page, 'max-results-valid-number-is-saved', async () => {
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible()
    await expect(editor).toHaveValue('37')
    await expect(page.getByText('Custom value')).toBeVisible()
  })

  await page.getByRole('button', { name: 'Restore inherited value', exact: true }).click()
  await recordAssertion(page, 'max-results-inherited-default-is-restored', async () => {
    await expect(page.getByRole('status').filter({ hasText: 'Restored the inherited value.' })).toBeVisible()
    await expect(editor).toHaveValue('30')
    await expect(page.getByRole('region', { name: 'maxResults' }).getByText(/Host document · revision \d+ · Inherited value/)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
