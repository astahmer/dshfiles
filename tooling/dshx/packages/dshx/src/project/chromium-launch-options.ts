import type { LaunchOptions } from 'playwright'
import { resolveExecutableOverride } from './executable-override.js'

/**
 * Preserve Playwright's bundled browser default unless an installed Chromium is explicitly selected.
 *
 * The browser context locale is pinned to English: DSH falls back to the browser's language, and every seed and reach
 * locator names English copy, so a French (or any other) macOS would leave the notice, the composer and the model
 * picker under names no step matches. `DSHX_LOCALE` overrides it for a locale-specific pass.
 */
export const chromiumLaunchOptions = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Pick<LaunchOptions, 'executablePath'> & { readonly locale: string }> => {
  const executablePath = await resolveExecutableOverride('DSHX_CHROMIUM_EXECUTABLE', environment)
  const locale = environment.DSHX_LOCALE === undefined || environment.DSHX_LOCALE === '' ? 'en-US' : environment.DSHX_LOCALE
  return executablePath === undefined ? { locale } : { locale, executablePath }
}
