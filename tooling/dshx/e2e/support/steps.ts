import { expect, type Page } from '@playwright/test'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Before, Given, Then, readBootOutcome } from './bdd.js'
import { bootComposedPluginProfile, bootPluginProfile, bootProfile, type BootedProfile } from './boot.js'
import { redactHostOutput } from './scratch-profile.js'
import { clientEntryFailures, parseBootText } from '../../packages/dshx/src/project/client-boot-check.js'
import { StartupDialogs } from '../../packages/dshx/src/project/startup-dialogs.js'
import {
  capturePageEvidenceFrame,
  completeEvidenceStep,
  createEvidenceRun,
  finishEvidenceRun,
  recordEvidenceAssertion,
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

const browserOriginKey = (url: URL): string => {
  const protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol
  return `${protocol}//${url.host}`
}

/** Per-scenario state, keyed by the page playwright-bdd hands each scenario. */
const profiles = new WeakMap<Page, BootedProfile>()
const evidenceRuns = new WeakMap<Page, EvidenceRun>()
const browserDiagnostics = new WeakMap<Page, string[]>()
const allowedBrowserOrigins = new WeakMap<Page, Set<string>>()

const evidenceRunFor = (page: Page): EvidenceRun => {
  const run = evidenceRuns.get(page)
  if (run === undefined) throw new Error('the evidence run was not initialized for this scenario')
  return run
}

export const browserDiagnosticsFor = (page: Page): readonly string[] => browserDiagnostics.get(page) ?? []

const hostApiDiagnosticsFor = async (homeRoot: string): Promise<{ readonly files: readonly string[]; readonly lines: readonly string[] }> => {
  const logDirectories = ['logs', '.dsh/logs']
  const logFiles = (
    await Promise.all(
      logDirectories.map(async directory => {
        const entries = await readdir(join(homeRoot, directory), { withFileTypes: true }).catch(() => [])
        return entries.filter(entry => entry.isFile()).map(entry => ({ name: `${directory}/${entry.name}`, path: join(homeRoot, directory, entry.name) }))
      }),
    )
  ).flat()
  const logContents = await Promise.all(logFiles.map(file => readFile(file.path, 'utf8').catch(() => '')))
  return {
    files: logFiles.map(file => file.name),
    lines: logContents
      .flatMap(content => content.split(/\r?\n/))
      .filter(line => line.includes('API handler') || line.includes('dshx:api'))
      .slice(-20)
      .map(redactHostOutput),
  }
}
export const recordAssertion = async (page: Page, assertionId: string, assertion: () => void | Promise<void>): Promise<void> => {
  const run = evidenceRunFor(page)
  try {
    await assertion()
  } catch (error) {
    recordEvidenceAssertion(run, assertionId, 'failed')
    throw error
  }
  recordEvidenceAssertion(run, assertionId, 'passed')
}

export const finishJourneyAssertions = async (page: Page): Promise<void> => {
  const run = evidenceRunFor(page)
  completeEvidenceStep(run, 'assertion-complete')
  await capturePageEvidenceFrame(run, page, 'assertion-complete')
}

const evidenceStatus = (status: string | undefined): EvidenceStatus => {
  if (status === 'passed') return 'passed'
  if (status === 'failed') return 'failed'
  if (status === 'skipped') return 'skipped'
  return 'interrupted'
}

Before(async ({ page, $testInfo }) => {
  const run = await createEvidenceRun({
    suiteId: 'client-plugin-boot',
    scenarioPath: $testInfo.titlePath,
    expectedStepIds: ['profile-booted', 'assertion-complete', 'host-cleanup'],
  })
  evidenceRuns.set(page, run)
  const diagnostics: string[] = []
  const allowedOrigins = new Set<string>()
  browserDiagnostics.set(page, diagnostics)
  allowedBrowserOrigins.set(page, allowedOrigins)
  page.context().on('page', newPage => {
    void StartupDialogs.registerProviderSetupDismissal(newPage).catch(() => {
      diagnostics.push('provider onboarding handler registration failed')
    })
  })
  page.on('console', message => {
    if (message.type() === 'error') diagnostics.push(`console.error: ${message.text().replaceAll(PRIVATE_URL, '<private-url>')}`)
  })
  page.on('pageerror', error => diagnostics.push(`pageerror: ${error.message.replaceAll(PRIVATE_URL, '<private-url>')}`))
  page.on('requestfailed', request => diagnostics.push(`requestfailed: ${request.resourceType()} ${request.failure()?.errorText ?? 'unknown'}`))
  page.on('response', response => {
    if (response.status() >= 400) diagnostics.push(`http ${response.status()}: ${response.request().resourceType()}`)
  })
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url())
    if (allowedOrigins.has(browserOriginKey(url)) || url.protocol === 'data:' || url.protocol === 'blob:') {
      await route.continue()
      return
    }
    diagnostics.push(`blocked outbound browser request: ${route.request().resourceType()}`)
    await route.abort('blockedbyclient')
  })
  await page.context().routeWebSocket(
    url => !allowedOrigins.has(browserOriginKey(url)),
    async route => {
      diagnostics.push('blocked outbound browser websocket')
      await route.close({ code: 1008, reason: 'External network is blocked in E2E' })
    },
  )
})

/** Admit one loopback fake (an OAuth provider page) through the browser network boundary for this scenario. */
export const allowLoopbackBrowserOrigin = (page: Page, origin: string): void => {
  const url = new URL(origin)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('Only a loopback fake may pass the E2E network boundary.')
  const allowedOrigins = allowedBrowserOrigins.get(page)
  if (allowedOrigins === undefined) throw new Error('the browser network boundary was not initialized')
  allowedOrigins.add(browserOriginKey(url))
}

/** The scratch profile a scenario booted, for journeys that configure it the way an operator edits its patch file. */
export const profileFor = (page: Page): BootedProfile => {
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
    // Collected from before the first navigation, so a Slot entry that abdicated onto a fallback survivor still counts.
    consoleMessages: browserDiagnosticsFor(page),
  })

const visitScratchProfile = async (page: Page, profile: BootedProfile, url = profile.url): Promise<void> => {
  const allowedOrigins = allowedBrowserOrigins.get(page)
  if (allowedOrigins === undefined) throw new Error('the browser network boundary was not initialized')
  allowedOrigins.add(browserOriginKey(new URL(url)))
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not open the ${profile.profile} scratch profile: ${message.replaceAll(PRIVATE_URL, '<private-url>')}`)
  }
}

export const restartScratchProfileInBrowser = async (page: Page): Promise<string> => {
  const profile = profileFor(page)
  await page.goto('about:blank')
  const freshUrl = await profile.restart()
  if (freshUrl !== profile.url) throw new Error('The scratch Host restart returned a stale URL.')
  await visitScratchProfile(page, profile, freshUrl)
  const previewNotice = page.getByRole('dialog', { name: 'Preview Notice', exact: true })
  if (await previewNotice.isVisible()) await previewNotice.getByRole('button', { name: 'Continue', exact: true }).click()
  await StartupDialogs.dismissProviderSetupDuringStartup(page)
  assertClientBootReady(await readProfileOutcome(page, profile), profile, 'The restarted scratch profile did not boot cleanly.')
  return freshUrl
}

export const visitIsolatedPluginProfile = async (page: Page, profile: BootedProfile): Promise<void> => {
  profiles.set(page, profile)
  try {
    await visitScratchProfile(page, profile)
    const previewNotice = page.getByRole('dialog', { name: 'Preview Notice', exact: true })
    await expect(previewNotice).toBeVisible()
    await previewNotice.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(previewNotice).toBeHidden()
    await StartupDialogs.dismissProviderSetupDuringStartup(page)
    completeEvidenceStep(evidenceRunFor(page), 'profile-booted')
    await capturePageEvidenceFrame(evidenceRunFor(page), page, 'profile-booted')
  } catch (error) {
    await profile.close()
    profiles.delete(page)
    throw error
  }
}

Given('the web profile is booted', async ({ page }: { page: Page }) => {
  const profile = await bootProfile('web')
  profiles.set(page, profile)
  try {
    await visitScratchProfile(page, profile)
    await StartupDialogs.dismissProviderSetupDuringStartup(page)
    completeEvidenceStep(evidenceRunFor(page), 'profile-booted')
    await capturePageEvidenceFrame(evidenceRunFor(page), page, 'profile-booted')
  } catch (error) {
    await profile.close()
    profiles.delete(page)
    throw error
  }
})

Given('the isolated plugin profile {string} is booted', async ({ page }: { page: Page }, packageId: string) => {
  await visitIsolatedPluginProfile(page, await bootPluginProfile(packageId))
})

const privacyControlsDefaults = `- id: command-feedback
  disabled: true
- id: message-feedback
  disabled: true
- id: ui-message-feedback
  disabled: true
- id: session-telemetry-otel
  disabled: true
- id: session-log-deepseek
  disabled: true
- id: ui-settings-session-log
  disabled: true
- id: session-log-download
  disabled: false
`

Given('the privacy-controls profile is booted with feedback and uploads off', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/privacy-controls', '@dshfiles/settings-shell'],
    profileLabel: 'privacy-controls',
    cordisPatch: privacyControlsDefaults,
  })
  await visitIsolatedPluginProfile(page, profile)
})

const seedAutocompleteSkill = async (homeRoot: string): Promise<void> => {
  const skillDirectory = join(homeRoot, 'skills', 'e2e-skill-mentions')
  await mkdir(skillDirectory, { recursive: true })
  await writeFile(
    join(skillDirectory, 'SKILL.md'),
    `---\nname: e2e-skill-mentions\ndescription: Deterministic fixture for @ skill autocomplete.\nuser-invocable: true\ndisable-model-invocation: true\n---\nUsed only by the autocomplete browser journey.\n`,
  )
}

Given('the isolated plugin profile {string} is booted with the autocomplete skill fixture', async ({ page }: { page: Page }, packageId: string) => {
  const profile = await bootComposedPluginProfile({ packageIds: [packageId], profileLabel: `${packageId}-skill-mentions`, seedHome: seedAutocompleteSkill })
  await visitIsolatedPluginProfile(page, profile)
})

Given('the isolated plugin composition of {string} is booted with the autocomplete skill fixture', async ({ page }: { page: Page }, packageList: string) => {
  const [packageId, ...companionPackageIds] = packageList.split(',').map(listed => listed.trim())
  if (packageId === undefined || packageId === '') throw new Error('The plugin composition names no package.')
  const profile = await bootComposedPluginProfile({
    packageIds: [packageId, ...companionPackageIds],
    profileLabel: `${packageList}-skill-mentions`,
    seedHome: seedAutocompleteSkill,
  })
  await visitIsolatedPluginProfile(page, profile)
})

// The web profile seed enables the file-backed session-content index through its patch layer; no bundle composes it.
const sessionContentIndexPatch = `- id: session-query-sqlite
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: !!js (process.env.DSH_HOME || process.env.HOME + '/.dsh') + '/plugins/session-query-sqlite/index.sqlite'
    openAt: first-search
`

Given('the isolated plugin profile {string} is booted with the session-content index', async ({ page }: { page: Page }, packageId: string) => {
  const profile = await bootComposedPluginProfile({ packageIds: [packageId], profileLabel: packageId, cordisPatch: sessionContentIndexPatch })
  await visitIsolatedPluginProfile(page, profile)
})

Then('the content-search index exists under the isolated DSH home', async ({ page }: { page: Page }) => {
  const indexPath = join(profileFor(page).homeRoot, 'plugins', 'session-query-sqlite', 'index.sqlite')
  await recordAssertion(page, 'command-palette-content-index-is-under-the-isolated-home', () =>
    expect.poll(async () => (await stat(indexPath).catch(() => undefined))?.isFile() ?? false).toBe(true),
  )
})

Given('the isolated plugin composition {string} and {string} is booted', async ({ page }: { page: Page }, packageId: string, companionPackageId: string) => {
  const profile = await bootComposedPluginProfile({
    packageIds: [packageId, companionPackageId],
    profileLabel: `${packageId}+${companionPackageId}`,
  })
  await visitIsolatedPluginProfile(page, profile)
})

Given('the isolated plugin composition of {string} is booted', async ({ page }: { page: Page }, packageList: string) => {
  const [packageId, ...companionPackageIds] = packageList.split(',').map(packageId => packageId.trim())
  if (packageId === undefined || packageId === '') throw new Error('The plugin composition names no package.')
  const profile = await bootComposedPluginProfile({ packageIds: [packageId, ...companionPackageIds], profileLabel: packageList })
  await visitIsolatedPluginProfile(page, profile)
})

Given(
  'the isolated plugin composition {string} and {string} with external bundle {string} is booted',
  async ({ page }: { page: Page }, packageId: string, companionPackageId: string, externalBundleId: string) => {
    const profile = await bootComposedPluginProfile({
      packageIds: [packageId, companionPackageId],
      profileLabel: `${packageId}+${companionPackageId}+${externalBundleId}`,
      additionalBundleIds: [externalBundleId],
    })
    await visitIsolatedPluginProfile(page, profile)
  },
)

Then('the Web UI mounts without a plugin failure card', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const outcome = await readProfileOutcome(page, profile)
  await recordAssertion(page, 'web-ui-has-no-failed-client-entry', () =>
    assertClientBootReady(outcome, profile, 'The composed scratch profile did not reach a clean Client boot.'),
  )
  completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
  await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
})

Then('every client entry that failed to activate is reported by id', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const outcome = await readProfileOutcome(page, profile)
  if (outcome.text === '') {
    await recordAssertion(page, 'failure-card-has-no-unreported-entry', () => expect(outcome.text).toBe(''))
    completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
    await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
    return
  }
  const failures = clientEntryFailures(parseBootText(outcome.text), profile.expectedClientEntries)
  await recordAssertion(page, 'failed-client-entry-ids-are-reported', () => {
    for (const entry of failures) {
      expect(outcome.text).toContain(`${entry.id}:`)
      if (entry.state === 'failed') expect(outcome.text).toContain(`${entry.id}: failed`)
    }
  })
  await recordAssertion(page, 'failure-card-identifies-boot-state', () => expect(failures.length > 0 || /web boot: \d+ entr/.test(outcome.text)).toBe(true))
  await recordAssertion(page, 'scratch-host-port-is-available', () => expect(profile.output()).not.toContain('EADDRINUSE'))
  completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
  await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
})

Then('no Slot fell back to its error boundary', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const outcome = await readProfileOutcome(page, profile)
  await recordAssertion(page, 'no-slot-render-failures', () => expect(outcome.slotFailures).toEqual([]))
  completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
  await capturePageEvidenceFrame(evidenceRunFor(page), page, 'assertion-complete')
})

Then('the Web UI is torn down cleanly', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  await profile.close()
  profiles.delete(page)
  completeEvidenceStep(evidenceRunFor(page), 'host-cleanup')
})

// A scenario that fails mid-way must not leave its scratch Host running.
After(async ({ page, $testInfo }) => {
  const run = evidenceRuns.get(page)
  let cleanupError: unknown
  if ($testInfo.status !== 'passed') {
    const browserState = await page
      .evaluate(() => {
        const isVisible = (element: HTMLElement): boolean => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        }
        const settingsButton = document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')
        const settingsTarget =
          settingsButton === null
            ? null
            : document.elementFromPoint(
                settingsButton.getBoundingClientRect().x + settingsButton.getBoundingClientRect().width / 2,
                settingsButton.getBoundingClientRect().y + settingsButton.getBoundingClientRect().height / 2,
              )
        return {
          dialogs: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
            .filter(isVisible)
            .map(dialog => ({
              title: dialog.querySelector<HTMLElement>('[role="heading"]')?.innerText.trim() ?? '',
              alerts: Array.from(dialog.querySelectorAll<HTMLElement>('[role="alert"]'), alert => alert.innerText.trim()),
              buttons: Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'), button => button.getAttribute('aria-label') ?? button.innerText.trim()),
            })),
          settingsTarget:
            settingsTarget === null
              ? null
              : { tag: settingsTarget.tagName, role: settingsTarget.getAttribute('role'), className: String(settingsTarget.className) },
        }
      })
      .catch(error => ({ evaluationError: error instanceof Error ? error.message : String(error) }))
    const profile = profiles.get(page)
    const diagnostics = {
      browserState,
      events: browserDiagnostics.get(page) ?? [],
      hostOutput: profile?.output() ?? null,
      hostApiDiagnostics: profile === undefined ? [] : await hostApiDiagnosticsFor(profile.homeRoot),
    }
    await $testInfo.attach('browser-diagnostics.json', {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: 'application/json',
    })
  }
  if (run !== undefined) await capturePageEvidenceFrame(run, page, 'final-state').catch(error => (cleanupError = error))
  try {
    await profiles.get(page)?.close()
  } catch (error) {
    cleanupError ??= error
  }
  profiles.delete(page)
  if (run !== undefined) {
    if (cleanupError === undefined) completeEvidenceStep(run, 'host-cleanup')
    await finishEvidenceRun(run, cleanupError === undefined ? evidenceStatus($testInfo.status) : 'failed')
    evidenceRuns.delete(page)
  }
  if (cleanupError !== undefined) throw cleanupError
})

Then('exactly one shared plugin stylesheet is injected', async ({ page }: { page: Page }) => {
  await page.locator('[data-plugin-css="@dshfiles/ui-styles/client.css"]').waitFor({ state: 'attached', timeout: OUTCOME_TIMEOUT_MS })
  const sheets = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLStyleElement>('style[data-plugin^="@dshfiles/"], style[data-plugin="dshx:shared-css"]')]
      // The budget guards copies of the Tailwind sheet; a plugin's small hand-written CSS (agent-questions, mentions) is not one.
      .filter(style => (style.textContent ?? '').includes('tailwindcss'))
      .map(style => style.dataset.plugin ?? ''),
  )
  await recordAssertion(page, 'one-shared-plugin-stylesheet', () => expect(sheets).toEqual(['dshx:shared-css']))
  completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
})

Then(
  'the command palette opens within {int} ms and filters each keystroke within {int} ms',
  async ({ page }: { page: Page }, openBudgetMs: number, keystrokeBudgetMs: number) => {
    await page.locator('[data-plugin-css="@dshfiles/ui-styles/client.css"]').waitFor({ state: 'attached', timeout: OUTCOME_TIMEOUT_MS })
    // Commit latency, measured in-page so Playwright's own round trips do not count: dispatch → DOM mutation.
    const timings = await page.evaluate(async () => {
      const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
      const settled = (): Promise<void> =>
        new Promise(resolve => {
          const channel = new MessageChannel()
          channel.port1.onmessage = () => resolve()
          channel.port2.postMessage(0)
        })
      const appears = (selector: string): Promise<number> =>
        new Promise(resolve => {
          const started = performance.now()
          const observer = new MutationObserver(() => {
            if (document.querySelector(selector) === null) return
            observer.disconnect()
            resolve(performance.now() - started)
          })
          observer.observe(document.body, { childList: true, subtree: true })
          setTimeout(() => {
            observer.disconnect()
            resolve(Number.POSITIVE_INFINITY)
          }, 3_000)
        })
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      const opens: number[] = []
      const keystrokes: number[] = []
      for (let run = 0; run < 5; run++) {
        const opened = appears('[cmdk-input]')
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            code: 'KeyK',
            key: 'k',
            metaKey: true,
            ctrlKey: !navigator.platform.startsWith('Mac'),
            bubbles: true,
            cancelable: true,
          }),
        )
        opens.push(await opened)
        const input = document.querySelector<HTMLInputElement>('[cmdk-input]')
        if (input === null || valueSetter === undefined) break
        await sleep(50)
        let value = ''
        for (const character of 'thread') {
          value += character
          const started = performance.now()
          valueSetter.call(input, value)
          input.dispatchEvent(new Event('input', { bubbles: true }))
          await sleep(0)
          await settled()
          keystrokes.push(performance.now() - started)
        }
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
        await sleep(250)
      }
      const percentile = (values: number[], quantile: number): number =>
        [...values].sort((left, right) => left - right)[Math.min(values.length - 1, Math.floor(quantile * values.length))] ?? Number.POSITIVE_INFINITY
      return { openP50: percentile(opens, 0.5), keystrokeP95: percentile(keystrokes, 0.95) }
    })
    await recordAssertion(page, 'palette-open-budget', () => expect(timings.openP50).toBeLessThan(openBudgetMs))
    await recordAssertion(page, 'palette-keystroke-budget', () => expect(timings.keystrokeP95).toBeLessThan(keystrokeBudgetMs))
    completeEvidenceStep(evidenceRunFor(page), 'assertion-complete')
  },
)
