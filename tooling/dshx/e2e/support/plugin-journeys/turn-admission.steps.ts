import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, openSettingsDialog, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const LONG_BASH_DIRECTIVE = `[[call bash ${JSON.stringify({ command: 'sleep 45 && echo admission-slot', description: 'Hold a slot' })}]]`
const projects = new WeakMap<Page, string>()
const waitingDock = (page: Page) => page.locator('[data-turn-admission-waiting]')

const send = async (page: Page, text: string): Promise<void> => {
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(text)
  await composer.press('Enter')
}

When('the running threads limit is set to {int} in Settings', async ({ page }: { page: Page }, limit: number) => {
  await openSettingsDialog(page)
  const row = page.locator('[data-settings-entry="running-threads-limit"]')
  const field = row.getByRole('spinbutton', { name: /^Running threads limit/ })
  await expect(field).toHaveValue('0', { timeout: 30_000 })
  await field.fill(String(limit))
  await field.press('Enter')
  await recordAssertion(page, 'turn-admission-settings-saves-the-limit', async () => {
    await expect(field).toHaveValue(String(limit))
    await expect(field).toBeEnabled()
    await expect(row.getByRole('switch', { name: 'Subagents take a slot', exact: true })).not.toBeChecked()
  })
  await page.screenshot({ path: test.info().outputPath('turn-admission-settings.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(row).toBeHidden()
})

When('one thread runs a long shell call', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-turn-admission-e2e-')
  const workspace = join(root, 'admission-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  projects.set(page, 'admission-project')
  await startThreadWithModel(page, { project: 'admission-project', model: 'commandcode_work/gpt-6-luna' })
  await send(page, LONG_BASH_DIRECTIVE)
  await expect(page.locator('[data-chat-call-id]').first()).toBeVisible({ timeout: 30_000 })
})

When('a second thread is sent a message', async ({ page }: { page: Page }) => {
  const project = projects.get(page)
  if (project === undefined) throw new Error('The admission project was not created.')
  await startThreadWithModel(page, { project, model: 'commandcode_work/gpt-6-luna' })
  await send(page, 'Second thread question')
})

Then('the second thread waits for a free slot with how many are ahead', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'turn-admission-shows-waiting-turn', async () => {
    await expect(waitingDock(page)).toHaveText(/^Waiting for a free slot · 0 ahead · 1\/1 running/, { timeout: 15_000 })
    await expect(waitingDock(page).getByRole('button', { name: 'Start now', exact: true })).toBeVisible()
  })
  await page.screenshot({ path: test.info().outputPath('turn-admission-waiting.png'), animations: 'disabled' })
  const wide = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  await recordAssertion(page, 'turn-admission-waiting-fits-a-phone', async () => {
    const button = waitingDock(page).getByRole('button', { name: 'Start now', exact: true })
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(box === null ? Number.POSITIVE_INFINITY : box.x + box.width).toBeLessThanOrEqual(390)
  })
  await page.screenshot({ path: test.info().outputPath('turn-admission-waiting-390.png'), animations: 'disabled' })
  if (wide !== null) await page.setViewportSize(wide)
})

When('the waiting turn is started now', async ({ page }: { page: Page }) => {
  await waitingDock(page).getByRole('button', { name: 'Start now', exact: true }).click()
})

Then('the second thread no longer waits', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'turn-admission-force-start', async () => {
    await expect(waitingDock(page)).toHaveCount(0, { timeout: 15_000 })
  })
  await finishJourneyAssertions(page)
})
