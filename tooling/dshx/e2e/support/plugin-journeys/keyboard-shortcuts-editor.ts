import { expect, type Locator, type Page } from '@playwright/test'
import { primaryModifierFor } from './platform-modifier.js'

/** A shortcut sheet a plugin may open on primary+/ in front of the Host's editor. */
export const shortcutCheatSheet = (page: Page): Locator => page.locator('[data-shortcut-cheat-sheet]')

/**
 * Opens the Host's "Keyboard shortcuts" rebinding editor and returns it. In the stock composition primary+/ opens that
 * editor directly. A composition that puts a shortcut sheet on primary+/ (a fork of `@dshfiles/shortcuts` does) keeps
 * the editor behind the sheet's Customize keys button. One helper takes either route, so these journeys pass in both.
 */
export const openKeyboardShortcutsEditor = async (page: Page): Promise<Locator> => {
  const primary = await primaryModifierFor(page)
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  const sheet = shortcutCheatSheet(page)
  await page.keyboard.press(`${primary}+Slash`)
  await expect(sheet.or(dialog).first()).toBeVisible()
  if (await sheet.isVisible()) {
    await sheet.getByRole('button', { name: 'Customize keys' }).click()
    await expect(sheet).toHaveCount(0)
  }
  await expect(dialog).toBeVisible()
  return dialog
}
