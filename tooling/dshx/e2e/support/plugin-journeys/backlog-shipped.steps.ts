import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { sendMessage, startThreadWithModel } from '../threads.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'
const toolDirective = (tool: string, input: object): string => `[[call ${tool} ${JSON.stringify(input)}]]`
const timeline = (page: Page) => page.getByRole('list', { name: 'Shipped timeline', exact: true })
const bucket = (page: Page, label: string) => timeline(page).getByRole('listitem', { name: new RegExp(`^${label}: \\d+ shipped$`, 'u') })
const shippedRow = (page: Page, label: string, title: string) => bucket(page, label).getByRole('listitem', { name: /^Item b:/u }).filter({ hasText: title })

When('the Shipped view is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('navigation', { name: 'Backlog views' }).getByRole('button', { name: 'Shipped', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Shipped', exact: true })).toBeVisible()
})

When('the Shipped period is set to {string}', async ({ page }: { page: Page }, period: string) => {
  const choice = page.getByRole('radiogroup', { name: 'Shipped period' }).getByRole('radio', { name: period, exact: true })
  await choice.click()
  await expect(choice).toHaveAttribute('aria-checked', 'true')
})

Then("today's Shipped bucket shows nothing shipped yet", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-shipped-today-empty', async () => {
    await expect(bucket(page, 'Today')).toHaveAccessibleName('Today: 0 shipped')
    await expect(bucket(page, 'Today')).toContainText('Nothing shipped yet.')
  })
})

Then("today's Shipped bucket lists {string} without an agent badge", async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-shipped-today-lists-done-item', async () => {
    await expect(bucket(page, 'Today')).toHaveAccessibleName('Today: 1 shipped')
    await expect(shippedRow(page, 'Today', title)).toBeVisible()
    await expect(shippedRow(page, 'Today', title)).not.toContainText('Agent')
  })
})

When('an agent thread captures {string} as done', async ({ page }: { page: Page }, text: string) => {
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, toolDirective('backlog_capture', { text, status: 'done' }))
})

Then("today's Shipped bucket lists {string} with an agent badge", async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-shipped-agent-badge', async () => {
    await expect(shippedRow(page, 'Today', title)).toContainText('Agent')
  })
})

Then("this week's Shipped bucket counts {int} shipped", async ({ page }: { page: Page }, count: number) => {
  await recordAssertion(page, 'backlog-shipped-week-count', async () => {
    await expect(bucket(page, 'This week')).toHaveAccessibleName(`This week: ${String(count)} shipped`)
  })
  await finishJourneyAssertions(page)
})

When("today's shipped period is summarized", async ({ page }: { page: Page }) => {
  await bucket(page, 'Today').getByRole('button', { name: 'Summarize', exact: true }).click()
})

Then('the summary asks for a triage model and opens the Backlog settings', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-shipped-summary-unconfigured', async () => {
    const alert = bucket(page, 'Today').getByRole('alert')
    await expect(alert).toContainText('Backlog settings › Triage')
    await alert.getByRole('button', { name: 'Backlog settings', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Jev triage', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
