import { expect, type Page } from '@playwright/test'
import { readBootOutcome, Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'

const feedbackSwitchNames = ['Answer feedback UI', 'Session feedback capture', 'OpenTelemetry session upload', 'Official DeepSeek session-log upload'] as const

const switchFor = (page: Page, name: string) => page.getByRole('switch', { name, exact: true })

const setSwitch = async (page: Page, name: string, enabled: boolean): Promise<void> => {
  const control = switchFor(page, name)
  const current = await control.getAttribute('aria-checked')
  if (current !== String(enabled)) await control.click()
  await expect(control).toHaveAttribute('aria-checked', String(enabled))
}

const setMaster = async (page: Page, enabled: boolean): Promise<void> => {
  const label = `${enabled ? 'Enable' : 'Disable'} all feedback & uploads`
  await page.getByRole('button', { name: label, exact: true }).click()
  if (enabled) {
    const confirmation = page.getByRole('alertdialog', { name: 'Enable all feedback and uploads?', exact: true })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Enable all', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Disable all feedback & uploads', exact: true })).toBeVisible()
    return
  }
  await expect(page.getByRole('button', { name: 'Enable all feedback & uploads', exact: true })).toBeVisible()
}

const expectSwitches = async (page: Page, feedbackEnabled: boolean, downloadsEnabled: boolean): Promise<void> => {
  for (const name of feedbackSwitchNames) await expect(switchFor(page, name)).toHaveAttribute('aria-checked', String(feedbackEnabled))
  await expect(switchFor(page, 'Download session logs')).toHaveAttribute('aria-checked', String(downloadsEnabled))
}

When('the Feedback & privacy section is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Feedback & privacy', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Feedback & privacy', exact: true })).toBeVisible()
})

When('Session feedback capture is enabled', async ({ page }: { page: Page }) => {
  await setSwitch(page, 'Session feedback capture', true)
})

When('Session feedback capture is disabled', async ({ page }: { page: Page }) => {
  await setSwitch(page, 'Session feedback capture', false)
})

When('Answer feedback UI is enabled', async ({ page }: { page: Page }) => {
  await setSwitch(page, 'Answer feedback UI', true)
})

When('Answer feedback UI is disabled', async ({ page }: { page: Page }) => {
  await setSwitch(page, 'Answer feedback UI', false)
})

When('OpenTelemetry session upload is enabled', async ({ page }: { page: Page }) => {
  await setSwitch(page, 'OpenTelemetry session upload', true)
})

When('Official DeepSeek session-log upload is enabled', async ({ page }: { page: Page }) => {
  await setSwitch(page, 'Official DeepSeek session-log upload', true)
})

When('session-log downloads are disabled', async ({ page }: { page: Page }) => {
  await setSwitch(page, 'Download session logs', false)
})

When('session-log downloads are enabled', async ({ page }: { page: Page }) => {
  await setSwitch(page, 'Download session logs', true)
})

When('all feedback and uploads are disabled', async ({ page }: { page: Page }) => {
  await setMaster(page, false)
})

When('all feedback and uploads are enabled', async ({ page }: { page: Page }) => {
  await setMaster(page, true)
})

Then('all feedback and upload switches are off and downloads are on', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'privacy-controls-default-off-download-on', () => expectSwitches(page, false, true))
})

Then('disabling all leaves session-log downloads on', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'privacy-controls-master-off-preserves-download-on', () => expectSwitches(page, false, true))
})

Then('enabling session-log downloads leaves feedback and uploads off', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'privacy-controls-download-on-does-not-enable-sharing', () => expectSwitches(page, false, true))
})

Then('all feedback and upload switches are on and downloads are off', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'privacy-controls-master-on-keeps-download-off', () => expectSwitches(page, true, false))
})

Then('all feedback and upload switches are off and downloads are off', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'privacy-controls-master-off-keeps-download-off', () => expectSwitches(page, false, false))
})

Then('Answer feedback UI requires Session feedback capture', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'privacy-controls-answer-feedback-requires-session-service', async () => {
    await expect(switchFor(page, 'Answer feedback UI')).toBeDisabled()
    await expect(switchFor(page, 'Session feedback capture')).toBeEnabled()
  })
})

Then('Session feedback capture cannot be disabled while Answer feedback UI is on', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'privacy-controls-session-service-protected', async () => {
    await expect(switchFor(page, 'Answer feedback UI')).toHaveAttribute('aria-checked', 'true')
    await expect(switchFor(page, 'Session feedback capture')).toBeDisabled()
  })
})

Then('the privacy controls page stays mounted without client or Slot errors', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const outcome = await readBootOutcome(page, {
    expectedClientEntries: profile.expectedClientEntries,
    timeoutMs: 20_000,
    inspectSlotFailures: true,
  })
  await recordAssertion(page, 'privacy-controls-no-client-or-slot-errors', async () => {
    expect(outcome.ready).toBe(true)
    expect(outcome.missingClientEntries).toEqual([])
    expect(outcome.failureCardVisible).toBe(false)
    expect(outcome.slotFailures).toEqual([])
    await expect(page.getByRole('heading', { name: 'Feedback & privacy', exact: true })).toBeVisible()
    const originalViewport = page.viewportSize()
    for (const width of [360, 480, 768, 1024]) {
      await page.setViewportSize({ width, height: originalViewport?.height ?? 900 })
      await expect(page.getByRole('heading', { name: 'Feedback & privacy', exact: true })).toBeVisible()
      await expect(switchFor(page, 'Answer feedback UI')).toBeVisible()
      await expect(switchFor(page, 'Download session logs')).toBeVisible()
    }
    if (originalViewport !== null) await page.setViewportSize(originalViewport)
  })
  await finishJourneyAssertions(page)
})
