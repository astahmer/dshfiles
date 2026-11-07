import type { Page } from '@playwright/test'

export type ModifierKey = 'Control' | 'Meta'

/** The modifier `primary` resolves to for the platform the browser reports — the same rule the app applies. */
export const primaryModifierFor = async (page: Page): Promise<ModifierKey> => {
  const platform = await page.evaluate(() => navigator.platform)
  return platform === 'macOS' || platform.startsWith('Mac') ? 'Meta' : 'Control'
}

export const alternateModifierFor = async (page: Page): Promise<ModifierKey> => ((await primaryModifierFor(page)) === 'Meta' ? 'Control' : 'Meta')
