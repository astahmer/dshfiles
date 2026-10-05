import { expect, type Page } from '@playwright/test'
import { After, Before, Given, Then, When, readBootOutcome } from './bdd.js'
import { defineParameterType } from 'playwright-bdd'
import { bootProfile, type BootedProfile } from './boot.js'
import { clientEntryFailures, parseBootText } from '../../packages/dshx/src/project/client-boot-check.js'
import type { PluginBoot } from './plugin-boot.js'
import { redactHostOutput } from './scratch-profile.js'
import {
  capturePageEvidenceFrame,
  completeEvidenceStep,
  createEvidenceRun,
  finishEvidenceRun,
  type EvidenceRun,
  type EvidenceStatus,
} from './evidence-runs.js'

/**
 * Step definitions for the client boot scenarios.
 *
 * This is the only file that knows the boot card's wording, which is the reason
 * the journeys are written in Gherkin: a change to that card is absorbed here
 * rather than in every feature that depends on it.
 */

const OUTCOME_TIMEOUT_MS = 20_000
const PRIVATE_URL = /http:\/\/127\.0\.0\.1:\d+\/\S*/g

/** Per-scenario state, keyed by the page playwright-bdd hands each scenario. */
const profiles = new WeakMap<Page, BootedProfile>()
const evidenceRuns = new WeakMap<Page, EvidenceRun>()

const evidenceRunFor = (page: Page): EvidenceRun => {
  const run = evidenceRuns.get(page)
  if (run === undefined) throw new Error('the evidence run was not initialized for this scenario')
  return run
}

const evidenceStatus = (status: string | undefined): EvidenceStatus => {
  if (status === 'passed') return 'passed'
  if (status === 'failed') return 'failed'
  if (status === 'skipped') return 'skipped'
  return 'interrupted'
}

Before(async ({ page, $testInfo }) => {
  const isolatedPluginSuite = $testInfo.file.endsWith('every-plugin-boots.feature.spec.js')
  const run = await createEvidenceRun({
    suiteId: isolatedPluginSuite ? 'isolated-plugin-boot' : 'client-plugin-boot',
    scenarioPath: $testInfo.titlePath,
    expectedStepIds: isolatedPluginSuite
      ? ['plugin-opened', 'assertion-complete', 'host-cleanup']
      : ['profile-booted', 'assertion-complete', 'host-cleanup'],
  })
  evidenceRuns.set(page, run)
})

const profileFor = (page: Page): BootedProfile => {
  const profile = profiles.get(page)
  if (profile === undefined) throw new Error('the web profile is not booted; the Background step did not run')
  return profile
}

const assertClientBootReady = (outcome: Awaited<ReturnType<typeof readBootOutcome>>, profile: BootedProfile, label: string): void => {
  const failures = clientEntryFailures(parseBootText(outcome.text), profile.expectedClientEntries)
  const details = `${label}\n${outcome.text}\n\nHost output:\n${profile.output()}`
  expect(outcome.ready, `${details}\n\nReadiness: ${outcome.readinessError ?? 'not reported'}`).toBe(true)
  expect(outcome.missingClientEntries, details).toEqual([])
  expect(outcome.failureCardVisible, details).toBe(false)
  expect(failures, details).toEqual([])
}

const readProfileOutcome = (page: Page, profile: BootedProfile) =>
  readBootOutcome(page, {
    expectedClientEntries: profile.expectedClientEntries,
    timeoutMs: OUTCOME_TIMEOUT_MS,
    inspectSlotFailures: profile.expectedClientEntries.length > 0,
  })

const visitScratchProfile = async (page: Page, profile: BootedProfile): Promise<void> => {
  try {
    await page.goto(profile.url, { waitUntil: 'domcontentloaded' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not open the ${profile.profile} scratch profile: ${message.replaceAll(PRIVATE_URL, '<private-url>')}`)
  }
}

Given('the web profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootProfile('web')
  profiles.set(page, profile)
  try {
    await visitScratchProfile(page, profile)
    completeEvidenceStep(evidenceRunFor(page), 'profile-booted')
    await capturePageEvidenceFrame(evidenceRunFor(page), page, 'profile-booted')
  } catch (error) {
    await profile.close()
    profiles.delete(page)
    throw error
  }
})

Then('the Web UI mounts without a plugin failure card', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const outcome = await readProfileOutcome(page, profile)
  assertClientBootReady(outcome, profile, 'The composed scratch profile did not reach a clean Client boot.')
  completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
  await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
})

Then('the Web UI mounts without a failure card', async ({ page }: { page: Page }) => {
  const boots = isolatedBoots.get(page)
  const pluginBoot = [...(boots?.values() ?? [])][0]
  if (pluginBoot === undefined) throw new Error('No isolated plugin profile is running for this scenario.')
  const outcome = await readProfileOutcome(page, pluginBoot)
  assertClientBootReady(outcome, pluginBoot, `${pluginBoot.pluginId} did not reach a clean Client boot.`)
  completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
  await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
})

Then('every client entry that failed to activate is reported by id', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const outcome = await readProfileOutcome(page, profile)
  if (outcome.text === '') {
    completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
    await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
    return
  }
  const failures = clientEntryFailures(parseBootText(outcome.text), profile.expectedClientEntries)
  for (const entry of failures) {
    expect(outcome.text).toContain(`${entry.id}:`)
    if (entry.state === 'failed') expect(outcome.text).toContain(`${entry.id}: failed`)
  }
  expect(failures.length > 0 || /web boot: \d+ entr/.test(outcome.text)).toBe(true)
  expect(profile.output()).not.toContain('EADDRINUSE')
  completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
  await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
})

Then('the Web UI is torn down cleanly', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await profile.close()
  profiles.delete(page)
  completeEvidenceStep(evidenceRunFor(page), 'host-cleanup')
})

/**
 * Steps for booting each plugin on its own.
 *
 * These are the only steps that build a disposable profile, and they live beside
 * the boot ones because the failure they guard is the same class: a client entry
 * that throws during apply and is only visible in a browser.
 */

/** Plugin boots still running for this page, so a scenario can close them all. */
const isolatedBoots = new WeakMap<Page, Map<string, PluginBoot>>()

Given('each plugin is booted on its own', async ({ page }: { page: Page }) => {
  isolatedBoots.set(page, new Map())
})

When('the plugin "{pluginId}" is opened', async ({ page }: { page: Page }, pluginId: string) => {
  const { bootPluginAlone } = await import('./plugin-boot.js')
  const boot = await bootPluginAlone(pluginId)
  isolatedBoots.get(page)?.set(pluginId, boot)
  await visitScratchProfile(page, boot)
  completeEvidenceStep(evidenceRunFor(page), 'plugin-opened')
  await capturePageEvidenceFrame(evidenceRunFor(page), page, 'plugin-opened')
})

Then('no Slot fell back to its error boundary', async ({ page }: { page: Page }) => {
  const profile = profiles.get(page) ?? [...(isolatedBoots.get(page)?.values() ?? [])][0]
  if (profile === undefined) throw new Error('No DSH profile is running for this scenario.')
  const outcome = await readProfileOutcome(page, profile)
  expect(outcome.slotFailures, `these Slots mounted an error boundary instead of their entry:\n${profile.output()}`).toEqual([])
  completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
  await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
})

Then('the plugin shuts down', async ({ page }: { page: Page }) => {
  const boots = isolatedBoots.get(page)
  if (boots === undefined) return
  for (const boot of boots.values()) await boot.close()
  boots.clear()
  completeEvidenceStep(evidenceRunFor(page), 'host-cleanup')
})

// A scenario that fails mid-way must not leave a Host running, so every isolated
// boot is torn down after each scenario regardless of how it ended.
After(async ({ page, $testInfo }) => {
  const run = evidenceRuns.get(page)
  let cleanupError: unknown
  if (run !== undefined) await capturePageEvidenceFrame(run, page, 'final-state').catch(error => (cleanupError = error))
  try {
    await profiles.get(page)?.close()
  } catch (error) {
    cleanupError ??= error
  }
  profiles.delete(page)
  const boots = isolatedBoots.get(page)
  if (boots !== undefined) {
    for (const boot of boots.values()) {
      try {
        await boot.close()
      } catch (error) {
        cleanupError ??= error
      }
    }
    boots.clear()
  }
  if (run !== undefined) {
    if (cleanupError === undefined) completeEvidenceStep(run, 'host-cleanup')
    await finishEvidenceRun(run, cleanupError === undefined ? evidenceStatus($testInfo.status) : 'failed')
    evidenceRuns.delete(page)
  }
  if (cleanupError !== undefined) throw cleanupError
})

// The scenario outline interpolates a package id, so the parameter type has to be
// declared before any step that uses {pluginId} can match.
defineParameterType({ name: 'pluginId', regexp: /@dshfiles\/[a-z-]+/ })
