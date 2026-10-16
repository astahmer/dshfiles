import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { restartScratchProfileInBrowser, finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { openActivity } from './activity-timeline.steps.js'

const projectChecksPanel = (page: Page) => page.getByRole('dialog', { name: 'Project checks', exact: true })
const receiptRows = (page: Page) => projectChecksPanel(page).getByRole('region', { name: 'Recent check receipts', exact: true }).getByRole('listitem')

const openProjectChecks = async (page: Page): Promise<void> => {
  const panel = projectChecksPanel(page)
  if (await panel.isVisible()) {
    await panel.getByRole('button', { name: 'Refresh project checks', exact: true }).click()
    return
  }
  const composer = page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
  await composer.pressSequentially('/project-checks')
  await expect(page.getByRole('option', { name: /^Project checks/ })).toBeVisible()
  await composer.press('Enter')
  await expect(panel).toBeVisible()
}

Then('the Activity Timeline shows safe receipt facts and current Project Checks freshness', async ({ page }: { page: Page }) => {
  await openActivity(page)
  const attentionOnly = page.getByRole('button', { name: 'Attention only', exact: true })
  await attentionOnly.click()
  await recordAssertion(page, 'verification-evidence-failure-and-timeout-use-attention', async () => {
    await expect(page.getByRole('button', { name: /Manual failure failed/ })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /Manual timeout timed out/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Manual pass passed/ })).toHaveCount(0)
  })
  await attentionOnly.click()
  await page.getByRole('button', { name: /^Detailed/ }).click()

  await recordAssertion(page, 'verification-evidence-safe-manual-projection', async () => {
    const pass = page.getByRole('button', { name: /Manual pass passed/ })
    const failure = page.getByRole('button', { name: /Manual failure failed/ })
    const timeout = page.getByRole('button', { name: /Manual timeout timed out/ })
    await expect(pass).toBeVisible({ timeout: 30_000 })
    await expect(failure).toBeVisible()
    await expect(timeout).toBeVisible()
    await expect(page.getByText(/PRIVATE_EVIDENCE_SENTINEL/)).toHaveCount(0)

    await failure.click()
    await expect(page.getByText(/Current source freshness is not asserted here/)).toBeVisible()
    await expect(page.getByText(/This bounded Project Checks receipt may have expired/)).toBeVisible()
    await expect(page.locator('pre').filter({ hasText: 'sourceRevisionBefore' })).toContainText('sourceRevisionAfter')
    await expect(page.locator('pre').filter({ hasText: 'sourceRevisionBefore' })).toContainText('configurationFreshness')
  })
})

Then('each failed attempt is projected exactly once with safe metadata', async ({ page }: { page: Page }) => {
  expect(profileFor(page).expectedClientEntries).toContain('@dshfiles/activity-timeline')
  await openActivity(page)
  await page.getByRole('button', { name: /^Detailed/ }).click()
  await page.getByRole('button', { name: 'Attention only', exact: true }).click()
  const completionRows = page.getByRole('button', { name: /Integration Completion check failed/ })

  await recordAssertion(page, 'verification-evidence-automatic-retry-projects-two-safe-receipts', async () => {
    await expect(completionRows).toHaveCount(2, { timeout: 30_000 })
    const rowTexts = await completionRows.allInnerTexts()
    expect(rowTexts.join('\n')).toContain('attempt 1')
    expect(rowTexts.join('\n')).toContain('attempt 2')
    const correlationIds = rowTexts.map(text => text.match(/correlation ([0-9a-f-]{36})/)?.[1])
    expect(correlationIds.every((correlationId): correlationId is string => correlationId !== undefined)).toBe(true)
    expect(new Set(correlationIds).size).toBe(2)
    await expect(page.getByText(/PRIVATE_EVIDENCE_SENTINEL/)).toHaveCount(0)

    for (const attempt of [1, 2]) {
      const attemptRow = completionRows.filter({ hasText: `attempt ${attempt}` })
      await expect(attemptRow).toHaveCount(1)
      await attemptRow.click()
      const metadata = page.locator('pre').filter({ hasText: 'verificationTurn' })
      await expect(metadata).toContainText(`"attempt": ${attempt}`)
      await expect(metadata).toContainText('"automatic": true')
      await expect(metadata).toContainText('"status": "failed"')
      await expect(metadata).toContainText('"configurationFreshness": "unknown"')
      await expect(page.getByText(/PRIVATE_EVIDENCE_SENTINEL/)).toHaveCount(0)
    }
  })
  await finishJourneyAssertions(page)
})

Then('the Activity Timeline labels cancellation as notable, not failure', async ({ page }: { page: Page }) => {
  expect(profileFor(page).expectedClientEntries).toContain('@dshfiles/activity-timeline')
  await openActivity(page)
  const cancelledRow = page.getByRole('button', { name: /Integration Interruptible check cancelled/ })

  await recordAssertion(page, 'verification-evidence-cancellation-is-not-a-failed-check', async () => {
    await expect(cancelledRow).toHaveCount(1, { timeout: 30_000 })
    await expect(cancelledRow.locator('span[aria-hidden="true"]')).toHaveClass(/dshx:bg-primary/)

    const attentionOnly = page.getByRole('button', { name: 'Attention only', exact: true })
    await attentionOnly.click()
    await expect(cancelledRow).toHaveCount(0)
    await attentionOnly.click()
    await expect(cancelledRow).toHaveCount(1)
    await cancelledRow.click()

    const metadata = page.locator('pre').filter({ hasText: 'verificationTurn' })
    await expect(metadata).toContainText('"status": "cancelled"')
    await expect(metadata).toContainText('"failure": null')
    await expect(metadata).toContainText('"automatic": true')
    await expect(metadata).toContainText('"attempt": 1')
    await expect(page.getByText(/PRIVATE_EVIDENCE_SENTINEL/)).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

When('the associated Session is opened from the Activity detail', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Open Session', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
})

Then('the receipt is backfilled once after restarting the scratch Host', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const previousUrl = profile.url
  const previousPort = profile.port
  const previousHome = profile.homeRoot
  const freshUrl = await restartScratchProfileInBrowser(page)

  await recordAssertion(page, 'verification-evidence-fresh-tokenized-host-restart', async () => {
    expect(freshUrl).not.toBe(previousUrl)
    expect(profile.url).toBe(freshUrl)
    expect(profile.port).toBe(previousPort)
    expect(profile.homeRoot).toBe(previousHome)
  })

  await openActivity(page)
  await page.getByRole('button', { name: /^Detailed/ }).click()
  await recordAssertion(page, 'verification-evidence-restart-backfill-deduplicates', async () => {
    await expect(page.getByRole('button', { name: /Manual pass passed/ })).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByRole('button', { name: /Manual failure failed/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Manual timeout timed out/ })).toHaveCount(1)
    await expect(page.getByText(/^[1-9]\d* duplicates$/)).toBeVisible({ timeout: 30_000 })
  })

  await page.getByRole('button', { name: /Manual pass passed/ }).click()
  await page.getByRole('button', { name: 'Open Session', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  await openProjectChecks(page)
  await recordAssertion(page, 'verification-evidence-manual-receipts-once', async () => {
    await expect(receiptRows(page)).toHaveCount(3)
    for (const label of ['Manual pass', 'Manual failure', 'Manual timeout']) {
      await expect(receiptRows(page).filter({ hasText: label })).toHaveCount(1)
    }
  })
  const stalePass = receiptRows(page).filter({ hasText: 'Manual pass' }).first()
  await expect(stalePass).toContainText('Stale: working copy changed after this check.')
  await expect(stalePass).toContainText('Action configuration equivalence: unknown')

  await finishJourneyAssertions(page)
})
