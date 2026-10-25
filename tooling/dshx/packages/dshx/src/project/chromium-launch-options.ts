import type { LaunchOptions } from 'playwright'
import { resolveExecutableOverride } from './executable-override.js'

/** Preserve Playwright's bundled browser default unless an installed Chromium is explicitly selected. */
export const chromiumLaunchOptions = async (environment: NodeJS.ProcessEnv = process.env): Promise<Pick<LaunchOptions, 'executablePath'>> => {
  const executablePath = await resolveExecutableOverride('DSHX_CHROMIUM_EXECUTABLE', environment)
  return executablePath === undefined ? {} : { executablePath }
}
