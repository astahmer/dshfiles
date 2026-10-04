import { expect, type Page } from '@playwright/test'
import { After, Given, Then, When, readBootOutcome } from './bdd.js'
import { defineParameterType } from 'playwright-bdd'
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

Then('the Web UI mounts without a failure card', async ({ page }: { page: Page }) => {
  const boots = isolatedBoots.get(page)
  const pluginId = [...(boots?.keys() ?? [])][0] ?? 'the isolated plugin'
  const text = await readBootOutcome(page, OUTCOME_TIMEOUT_MS)
  // An entry left pending on a live-host service is expected: this scenario runs
  // no Host conversation, so nothing can unblock those. Only "failed" is a defect.
  const failed = [...text.matchAll(/^(?<id>@[^:\n]+): failed\b/gm)].map(match => match.groups?.id)
  expect(
    failed,
    `${pluginId} left ${String(failed.length)} client entry/entries that failed to activate:\n${text}`,
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

/**
 * Steps for booting each plugin on its own.
 *
 * These are the only steps that build a disposable profile, and they live beside
 * the boot ones because the failure they guard is the same class: a client entry
 * that throws during apply and is only visible in a browser.
 */

/** Plugin boots still running for this page, so a scenario can close them all. */
const isolatedBoots = new WeakMap<Page, Map<string, { close(): Promise<void>; output(): string }>>()

Given('each plugin is booted on its own', async ({ page }: { page: Page }) => {
  isolatedBoots.set(page, new Map())
})

When('the plugin "{pluginId}" is opened', async ({ page }: { page: Page }, pluginId: string) => {
  const { bootPluginAlone } = await import('./plugin-boot.js')
  const boot = await bootPluginAlone(pluginId)
  isolatedBoots.get(page)?.set(pluginId, boot)
  await page.goto(boot.url, { waitUntil: 'domcontentloaded' })
  await readBootOutcome(page, OUTCOME_TIMEOUT_MS)
})

Then('no Slot fell back to its error boundary', async ({ page }: { page: Page }) => {
  const slots = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot-error]')].map(element => element.getAttribute('data-slot-error') ?? ''),
  )
  const failures = slots.filter((slot): slot is string => slot !== '')
  expect(
    failures,
    'these Slots mounted an error boundary instead of their entry, so their panel is blank even though every client entry activated:',
  ).toEqual([])
})

Then('the plugin shuts down', async ({ page }: { page: Page }) => {
  const boots = isolatedBoots.get(page)
  if (boots === undefined) return
  for (const boot of boots.values()) await boot.close()
  boots.clear()
})

// A scenario that fails mid-way must not leave a Host running, so every isolated
// boot is torn down after each scenario regardless of how it ended.
After(async ({ page }: { page: Page }) => {
  await profiles.get(page)?.close()
  profiles.delete(page)
  const boots = isolatedBoots.get(page)
  if (boots === undefined) return
  for (const boot of boots.values()) await boot.close()
  boots.clear()
})

// The scenario outline interpolates a package id, so the parameter type has to be
// declared before any step that uses {pluginId} can match.
defineParameterType({ name: 'pluginId', regexp: /@dshfiles\/[a-z-]+/ })
