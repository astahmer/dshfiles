import { randomBytes } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

const hex = (bytes: number): string => randomBytes(bytes).toString('hex')

const receiverEndpoint = async (page: Page): Promise<string> => {
  const badge = page.getByTestId('traces-receiver-state')
  await expect(badge).toHaveAttribute('data-state', 'listening', { timeout: 30_000 })
  return (await badge.getAttribute('title')) ?? ''
}

const alertsView = (page: Page) => page.getByTestId('traces-alerts-view')
const ruleRow = (page: Page, name: string) => page.getByRole('table', { name: 'Alert rules' }).getByRole('row').filter({ hasText: name })
const RULE_NAME = 'e2e checkout errors'

When('an error-rate alert rule for {string} is created in the Alerts tab', async ({ page }: { page: Page }, service: string) => {
  await page.getByRole('tab', { name: /^Alerts/ }).click()
  await expect(alertsView(page)).toBeVisible()
  await recordAssertion(page, 'traces-alerts-ship-builtin-rules', async () => {
    await expect(ruleRow(page, 'Model call error rate')).toHaveAttribute('data-status', 'ok')
    await expect(ruleRow(page, 'Plugin API error rate')).toHaveAttribute('data-status', 'off')
  })
  await alertsView(page).getByRole('button', { name: 'New rule', exact: true }).click()
  const form = page.getByRole('form', { name: 'New alert rule' })
  await form.getByLabel('Rule name').fill(RULE_NAME)
  await form.getByLabel('Service').fill(service)
  await form.getByLabel('Minimum spans').fill('1')
  await form.getByRole('button', { name: 'Save rule', exact: true }).click()
  await expect(form).toBeHidden()
  await recordAssertion(page, 'traces-alerts-rule-created', () => expect(ruleRow(page, RULE_NAME)).toHaveAttribute('data-status', 'ok'))
})

When('the alert rules are evaluated now', async ({ page }: { page: Page }) => {
  await alertsView(page).getByRole('button', { name: 'Evaluate now' }).click()
})

Then('the rule fires with its value and its sample trace', async ({ page }: { page: Page }) => {
  const firing = page.getByRole('list', { name: 'Firing alerts' }).getByRole('listitem').filter({ hasText: RULE_NAME })
  await recordAssertion(page, 'traces-alerts-rule-fires', async () => {
    await expect(firing).toBeVisible({ timeout: 15_000 })
    await expect(firing).toContainText('100%')
    await expect(firing).toContainText('error rate > 20%')
    await expect(firing.getByRole('button', { name: 'Open sample trace' })).toBeVisible()
    await expect(ruleRow(page, RULE_NAME)).toHaveAttribute('data-status', 'firing')
  })
})

Then('the Alerts tab and the panel banner mark the firing alert', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Traces', exact: true }).click()
  await recordAssertion(page, 'traces-alerts-attention-marker', async () => {
    await expect(page.getByTestId('traces-alerts-firing-count')).toHaveText('1')
    await expect(page.getByTestId('traces-alerts-banner')).toContainText('1 firing')
  })
  await page.getByTestId('traces-alerts-banner').getByRole('button', { name: 'Show alerts' }).click()
  await expect(alertsView(page)).toBeVisible()
})

Then('an in-app banner announces the firing alert', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'traces-alerts-in-app-announcement', () =>
    expect(page.getByText(`Alert firing: ${RULE_NAME}`, { exact: false }).first()).toBeVisible({ timeout: 20_000 }),
  )
})

When('the firing rule is muted for one hour', async ({ page }: { page: Page }) => {
  await ruleRow(page, RULE_NAME)
    .getByRole('button', { name: `Edit ${RULE_NAME}` })
    .click()
  await page.getByRole('menuitem', { name: 'Mute for 1 hour' }).click()
})

Then('the rule shows that it is muted', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'traces-alerts-rule-muted', () => expect(ruleRow(page, RULE_NAME)).toContainText('Muted until'))
})

When('the firing rule is deleted after confirming', async ({ page }: { page: Page }) => {
  await ruleRow(page, RULE_NAME)
    .getByRole('button', { name: `Edit ${RULE_NAME}` })
    .click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Delete this alert rule?' })
  await expect(confirm).toContainText(RULE_NAME)
  await confirm.getByRole('button', { name: 'Delete rule' }).click()
})

Then('the history shows the alert fired and was resolved by the removal', async ({ page }: { page: Page }) => {
  const history = page.getByRole('list', { name: 'Alert history' }).getByRole('listitem').filter({ hasText: RULE_NAME })
  await recordAssertion(page, 'traces-alerts-history', async () => {
    await expect(ruleRow(page, RULE_NAME)).toHaveCount(0)
    await expect(history.and(page.locator('[data-event-kind="resolved"]'))).toContainText('rule removed')
    await expect(history.and(page.locator('[data-event-kind="firing"]'))).toContainText('Fired')
    await expect(page.getByRole('list', { name: 'Firing alerts' })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

const toolSpans = () => {
  const traceId = hex(16)
  const rootId = hex(8)
  const startNs = BigInt(Date.now() - 20_000) * 1_000_000n
  const at = (offsetMs: number): string => (startNs + BigInt(offsetMs) * 1_000_000n).toString()
  const text = (key: string, value: string) => ({ key, value: { stringValue: value } })
  const tool = (name: string, from: number, to: number, failed = false) => ({
    traceId,
    spanId: hex(8),
    parentSpanId: rootId,
    name: `execute_tool ${name}`,
    kind: 1,
    startTimeUnixNano: at(from),
    endTimeUnixNano: at(to),
    attributes: [text('gen_ai.operation.name', 'execute_tool'), text('gen_ai.tool.name', name)],
    status: { code: failed ? 2 : 0 },
  })
  return {
    resourceSpans: [
      {
        resource: { attributes: [text('service.name', 'e2e-agent')] },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId: rootId,
                name: 'invoke_agent e2e',
                kind: 1,
                startTimeUnixNano: at(0),
                endTimeUnixNano: at(9_000),
                attributes: [text('gen_ai.operation.name', 'invoke_agent')],
                status: { code: 0 },
              },
              tool('bash', 100, 4_100),
              tool('bash', 4_200, 6_200, true),
              tool('read', 6_300, 6_310),
            ],
          },
        ],
      },
    ],
  }
}

When('synthetic tool call spans are posted to the receiver', async ({ page }: { page: Page }) => {
  const endpoint = await receiverEndpoint(page)
  const response = await fetch(`${endpoint}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toolSpans()) })
  expect(response.status).toBe(200)
})

const boardTable = (page: Page) => page.getByRole('table', { name: 'Slow tools' })

Then('the Slow tools board lists each tool with its count and p95', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Boards', exact: true }).click()
  await page.getByRole('radio', { name: 'Slow tools', exact: true }).click()
  await recordAssertion(page, 'traces-boards-slow-tools', async () => {
    const rows = boardTable(page).locator('tr[data-group]')
    await expect(rows).toHaveCount(2, { timeout: 15_000 })
    await expect(rows.nth(0)).toHaveAttribute('data-group', 'bash')
    await expect(rows.nth(0)).toContainText('50%')
    await expect(rows.nth(0)).toContainText('4.00 s')
    await expect(rows.nth(1)).toHaveAttribute('data-group', 'read')
  })
})

Then('a board row opens the trace list filtered to that tool', async ({ page }: { page: Page }) => {
  await boardTable(page).locator('tr[data-group="bash"]').click()
  await recordAssertion(page, 'traces-boards-drill-down', async () => {
    await expect(page.getByRole('tab', { name: 'Traces', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('textbox', { name: 'Search traces' })).toHaveValue('"gen_ai.tool.name":"bash"')
    await expect(page.locator('tr[aria-label="e2e-agent invoke_agent e2e"]')).toBeVisible({ timeout: 15_000 })
  })
})

When('the current view is saved as {string}', async ({ page }: { page: Page }, name: string) => {
  await page.getByRole('button', { name: 'Views', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Save current view…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save this view' })
  await dialog.getByLabel('View name').fill(name)
  await dialog.getByRole('button', { name: 'Save view' }).click()
  await expect(dialog).toBeHidden()
})

When('the trace filters are cleared', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('textbox', { name: 'Search traces' })).toHaveValue('')
})

When('the saved view {string} is applied', async ({ page }: { page: Page }, name: string) => {
  await page.getByRole('button', { name: 'Views', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
})

Then('the trace list is filtered to that tool again', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'traces-saved-view-restores-filters', () =>
    expect(page.getByRole('textbox', { name: 'Search traces' })).toHaveValue('"gen_ai.tool.name":"bash"'),
  )
  await finishJourneyAssertions(page)
})
