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
        reconnectButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label*="reconnect" i]'), item => item.getAttribute('aria-label')),
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

When('Settings are searched for {string}', async ({ page }: { page: Page }, settingName: string) => {
  await settingsPageSearch(page).fill(settingName)
})

When('the maxResults setting is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: /maxResults/ }).first().click()
})

Then('the settings index shows the maxResults setting', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'settings-index-shows-max-results', () =>
    expect(page.getByRole('button', { name: /maxResults/ }).first()).toBeVisible(),
  )
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
