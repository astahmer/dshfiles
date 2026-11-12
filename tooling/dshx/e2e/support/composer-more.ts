import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The composer bar's More (⋯) menu (rich-composer `ComposerMoreItems`, polish pass b:r4et): undo, rewind, redo, saved
 * prompts and the side question are its rows by default. Without rich-composer (the stock composer of an isolated
 * profile) or with `dshfiles-rich-composer.showComposerExtras` on, each plugin keeps its own button in the bar, so a
 * journey takes whichever the composer on screen offers: the menu row, or the bar button named `bar`.
 */
export const composerMoreButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'More composer actions', exact: true }).filter({ visible: true }).first()

const barButton = (page: Page, name: string): Locator => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()

/** Which form the composer on screen offers, once either is visible. */
const placement = async (page: Page, bar: string, timeout: number): Promise<'menu' | 'bar'> => {
  const more = composerMoreButton(page)
  await expect(more.or(barButton(page, bar)).first()).toBeVisible({ timeout })
  return (await more.isVisible()) ? 'menu' : 'bar'
}

/** Open the More menu and return the row whose text starts with `label`. */
export const composerMoreRow = async (page: Page, label: string): Promise<Locator> => {
  await composerMoreButton(page).click()
  const row = page.getByRole('menuitem').filter({ hasText: label }).first()
  await expect(row).toBeVisible()
  return row
}

/** Run a composer verb: its More row, or its bar button `bar` where the bar keeps it. */
export const chooseComposerMore = async (page: Page, label: string, bar: string = label, options: { readonly timeout?: number } = {}): Promise<void> => {
  if ((await placement(page, bar, options.timeout ?? 15_000)) === 'bar') {
    await barButton(page, bar).click()
    return
  }
  await (await composerMoreRow(page, label)).click()
}

/** The verb is offered and enabled for this thread: an enabled More row (checked, then closed), or a visible bar button. */
export const expectComposerMoreEnabled = async (page: Page, label: string, bar: string = label, options: { readonly timeout?: number } = {}): Promise<void> => {
  const timeout = options.timeout ?? 15_000
  await expect(async () => {
    if ((await placement(page, bar, 2_000)) === 'bar') return
    const row = await composerMoreRow(page, label)
    const disabled = await row.getAttribute('data-disabled')
    await page.keyboard.press('Escape')
    expect(disabled).toBeNull()
  }).toPass({ timeout })
}

/** The composer is ready to offer a verb in either form. */
export const waitForComposerVerb = async (page: Page, bar: string, timeout = 30_000): Promise<void> => {
  await placement(page, bar, timeout)
}
