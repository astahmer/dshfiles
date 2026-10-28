import type { Page } from '@playwright/test'
import { Before } from '../bdd.js'

/** Meta-key journeys explicitly emulate a macOS visitor, not the Linux CI Host's keyboard profile. */
Before({ tags: '@platform-macos' }, async ({ page }: { page: Page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'platform', { configurable: true, get: () => 'MacIntel' })
  })
})
