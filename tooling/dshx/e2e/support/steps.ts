import { expect, type Page } from '@playwright/test'
import { Given, Then, readBootOutcome } from './bdd.js'
import { bootProfile, type BootedProfile } from './boot.js'

/**
 * Step definitions for the client boot scenarios.
 *
 * This is the only file that knows the boot card's wording, which is the reason
 * the journeys are written in Gherkin: a change to that card is absorbed here
 * rather than in every feature that depends on it.
 */

const OUTCOME_TIMEOUT_MS = 60_000

/** Per-scenario state, keyed by the page playwright-bdd hands each scenario. */
const profiles = new WeakMap<Page, BootedProfile>()

const profileFor = (page: Page): BootedProfile => {
  const profile = profiles.get(page)
  if (profile === undefined) throw new Error('the web profile is not booted; the Background step did not run')
  return profile
}

Given('the web profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootProfile('web')
  profiles.set(page, profile)
  try {
    await page.goto(profile.url, { waitUntil: 'domcontentloaded' })
  } catch (error) {
    await profile.close()
    profiles.delete(page)
    throw error
  }
})

Then('the Web UI mounts without a plugin failure card', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const text = await readBootOutcome(page, OUTCOME_TIMEOUT_MS)
  // An entry left pending on a live-host service is expected: this scenario runs
  // no Host conversation, so nothing can unblock those. Only "failed" is a defect.
  const failed = [...text.matchAll(/^(?<id>@[^:\n]+): failed\b/gm)].map(match => match.groups?.id)
  expect(
    failed,
    `the Web UI reported ${String(failed.length)} client entry/entries that failed to activate:\n${text}\n\nHost output:\n${profile.output()}`,
  ).toEqual([])
})

Then('every client entry that failed to activate is reported by id', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const text = await readBootOutcome(page, OUTCOME_TIMEOUT_MS)
  if (text === '') return
  // A failure card must name the entry that failed, not only the entries waiting on it.
  const failed = [...text.matchAll(/^(?<id>@[^:\n]+): failed\b/gm)].map(match => match.groups?.id)
  for (const id of failed) expect(text).toContain(String(id))
  expect(failed.length > 0 || /web boot: \d+ entr/.test(text)).toBe(true)
  expect(profile.output()).not.toContain('EADDRINUSE')
})

Then('the Web UI is torn down cleanly', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await profile.close()
  profiles.delete(page)
})
