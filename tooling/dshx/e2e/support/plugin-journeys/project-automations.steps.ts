import { createHmac } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page, type TestInfo } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder } from '../threads.js'

/** The fake secret CLI's synthetic value behind the global GITHUB_TOKEN alias (secret-catalog.steps.ts seeds it). */
const FAKE_SECRET_VALUE = 'gh-e2e-global-value'
const SCHEDULED_ANSWER = 'Answered by the minute schedule'

const webhookUrls = new WeakMap<Page, string>()

const automationsPage = (page: Page) => page.getByRole('main', { name: 'Automations', exact: true })
const rowOf = (page: Page, title: string) => automationsPage(page).getByRole('listitem', { name: title, exact: true })

const openAutomations = async (page: Page): Promise<void> => {
  await openGlobalPanel(page, 'Automations')
  await expect(automationsPage(page).getByRole('heading', { name: 'Automations', exact: true })).toBeVisible()
}

/** Fill the fields every automation shares; the trigger fields are set by the caller first. */
const fillCommon = async (page: Page, input: { readonly title: string; readonly prompt: string }): Promise<void> => {
  const dialog = page.getByRole('dialog', { name: 'New automation', exact: true })
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(input.title)
  await dialog.getByRole('textbox', { name: 'Prompt', exact: true }).fill(input.prompt)
  await dialog.getByRole('textbox', { name: 'Provider (optional)', exact: true }).fill('commandcode_work')
  await dialog.getByRole('textbox', { name: 'Model (optional)', exact: true }).fill('gpt-6-luna')
  await dialog.getByRole('button', { name: 'Create automation', exact: true }).click()
  await expect(dialog).toBeHidden()
}

const chooseOption = async (page: Page, combobox: string, option: string): Promise<void> => {
  const dialog = page.getByRole('dialog', { name: 'New automation', exact: true })
  await dialog.getByRole('combobox', { name: combobox, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

const startNew = async (page: Page): Promise<void> => {
  await openAutomations(page)
  await automationsPage(page).getByRole('button', { name: 'New automation', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'New automation', exact: true })).toBeVisible()
}

When('a scratch project {string} is registered', async ({ page }: { page: Page }, name: string) => {
  const root = await createScratchDirectory('dshx-project-automations-e2e-')
  const workspace = join(root, name)
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
})

When('a schedule automation {string} that runs every minute on the fake model is created', async ({ page }: { page: Page }, title: string) => {
  await startNew(page)
  await chooseOption(page, 'Repeat', 'Every few minutes')
  await page.getByRole('dialog', { name: 'New automation', exact: true }).getByRole('textbox', { name: 'Every (minutes)', exact: true }).fill('1')
  await fillCommon(page, { title, prompt: `[[answer ${SCHEDULED_ANSWER}]]` })
  await expect(rowOf(page, title)).toContainText('every 1 min')
  await expect(rowOf(page, title)).toContainText('Next run')
})

Then('the automation starts a thread on its own and the thread opens on its answer', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  // The first target is up to a minute away and the page refreshes every 15 s.
  $testInfo.setTimeout($testInfo.timeout + 120_000)
  const row = rowOf(page, 'Minute check')
  await recordAssertion(page, 'project-automations-schedule-starts-thread', async () => {
    await expect(row.locator('[data-run-outcome="started"]')).toBeVisible({ timeout: 110_000 })
    await expect(row.locator('[data-run-outcome="started"]')).toContainText('schedule')
  })
  await recordAssertion(page, 'project-automations-run-opens-thread', async () => {
    await row.getByRole('button', { name: 'Open thread', exact: true }).click()
    await expect(page.getByText(SCHEDULED_ANSWER, { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  })
})

Then('pausing the automation shows that no run is planned', async ({ page }: { page: Page }) => {
  await openAutomations(page)
  const row = rowOf(page, 'Minute check')
  await recordAssertion(page, 'project-automations-pause-and-resume', async () => {
    await row.getByRole('switch', { name: 'Minute check enabled', exact: true }).click()
    await expect(row).toContainText('Paused')
    await row.getByRole('switch', { name: 'Minute check enabled', exact: true }).click()
    await expect(row).toContainText('Next run')
  })
  await finishJourneyAssertions(page)
})

When('a webhook automation {string} signed with {string} is created', async ({ page }: { page: Page }, title: string, reference: string) => {
  await startNew(page)
  await chooseOption(page, 'Trigger', 'Webhook')
  const dialog = page.getByRole('dialog', { name: 'New automation', exact: true })
  await dialog.getByRole('textbox', { name: 'Signing secret', exact: true }).fill(reference)
  await fillCommon(page, { title, prompt: '[[answer Webhook for {{body.ref}}]]' })
  const url = await rowOf(page, title).getByLabel('Webhook URL', { exact: true }).textContent()
  const path = url === null ? undefined : new URL(url).pathname
  if (path === undefined || !path.startsWith('/automations/webhook/auto_')) throw new Error(`The automation showed no webhook URL: ${String(url)}`)
  webhookUrls.set(page, `${new URL(page.url()).origin}${path}`)
})

const webhookUrlOf = (page: Page): string => {
  const url = webhookUrls.get(page)
  if (url === undefined) throw new Error('No webhook automation was created in this scenario.')
  return url
}

Then('an unsigned request to its webhook URL is refused', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'project-automations-webhook-refuses-unsigned', async () => {
    const response = await fetch(webhookUrlOf(page), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ref":"main"}' })
    expect(response.status).toBe(401)
    expect(await response.text()).toContain('x-dsh-signature')
  })
})

When('a request signed with that secret posts a payload to its webhook URL', async ({ page }: { page: Page }) => {
  const body = JSON.stringify({ ref: 'release-7' })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = createHmac('sha256', FAKE_SECRET_VALUE).update(`${timestamp}.${body}`).digest('hex')
  await recordAssertion(page, 'project-automations-webhook-accepts-signed', async () => {
    const response = await fetch(webhookUrlOf(page), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-timestamp': timestamp, 'x-dsh-signature': `sha256=${signature}` },
      body,
    })
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ ok: true, sessionId: expect.stringMatching(/^session-/u) })
  })
})

Then("the webhook run's thread answers with the value from the payload", async ({ page }: { page: Page }) => {
  await openAutomations(page)
  const row = rowOf(page, 'CI failed')
  await recordAssertion(page, 'project-automations-webhook-thread-answers', async () => {
    await expect(row.locator('[data-run-outcome="started"]')).toBeVisible({ timeout: 30_000 })
    await row.getByRole('button', { name: 'Open thread', exact: true }).click()
    await expect(page.getByText('Webhook for release-7', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  })
  await finishJourneyAssertions(page)
})
