import { randomBytes } from 'node:crypto'
import { globalPanelLink } from '../plugin-view-names.js'
import { expect, type Locator, type Page } from '@playwright/test'
import { bootComposedPluginProfile } from '../boot.js'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'

// Port 0 lets every scenario bind its own receiver port; the receiver publishes it to dshx tracing in-process.
const freePortPatch = `- id: dshfiles-traces
  config:
    port: 0
`

const bashDirective = '[[once call bash {"command":"echo traced-turn","description":"Traced turn"}]]'

const sessionView = (page: Page): Locator => page.getByTestId('traces-session-view')
const conversationTab = (page: Page, name: string): Locator => page.locator('[data-conversation-tabs]').getByRole('tab', { name, exact: true })
const waterfall = (scope: Page | Locator): Locator => scope.getByRole('tree', { name: 'Span waterfall' })
const turnOf = new WeakMap<Page, number>()

const hex = (bytes: number): string => randomBytes(bytes).toString('hex')

Given('the isolated trace-link profile is booted with agent telemetry, Chat and the Traces receiver', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/agent-telemetry', '@dshfiles/traces', '@dshfiles/ai-accounts', '@dshfiles/chat'],
    profileLabel: 'trace-transcript-links',
    cordisPatch: freePortPatch,
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('a new thread asks the fake model to run a bash command', async ({ page }: { page: Page }) => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New session', exact: true }).first().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await page.getByRole('menuitemradio', { name: 'commandcode_work/gpt-6-luna', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await composer.fill(bashDirective)
  await composer.press('Enter')
  await expect(page.getByText('Tool finished.').first()).toBeVisible({ timeout: 60_000 })
})

When("the turn footer's Trace button is clicked", async ({ page }: { page: Page }) => {
  const footer = page.locator('[data-dshfiles-turn-trace]').last()
  const turn = Number(await footer.getAttribute('data-dshfiles-turn-trace'))
  const turnSummary = page.locator(`[data-turn-tail="${String(turn)}"]`)
  const traceButtons = turnSummary.getByRole('button', { name: `Open the trace of turn ${String(turn)}`, exact: true })
  await recordAssertion(page, 'traces-turn-footer-trace-button', async () => {
    await expect(traceButtons).toHaveCount(1)
    await expect(turnSummary.locator('[data-clock="end"] [data-dshfiles-turn-trace]')).toHaveCount(1)
  })
  turnOf.set(page, turn)
  await traceButtons.click()
})

Then("the thread Traces tab opens the waterfall of that turn's trace", async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'traces-turn-button-opens-its-trace', async () => {
    await expect(conversationTab(page, 'Traces')).toHaveAttribute('aria-selected', 'true')
    // Agent telemetry exports the turn a moment after it ends; the tab retries until the trace holds the turn.
    await expect(waterfall(sessionView(page)).getByRole('treeitem').filter({ hasText: 'execute_tool bash' })).toHaveCount(1, { timeout: 30_000 })
    await expect(waterfall(sessionView(page)).getByRole('treeitem', { level: 2 })).toContainText('invoke_agent')
  })
})

When('Show in chat is clicked on the bash tool span', async ({ page }: { page: Page }) => {
  await waterfall(sessionView(page)).getByRole('treeitem').filter({ hasText: 'execute_tool bash' }).click()
  const button = sessionView(page).getByTestId('span-open-thread')
  await recordAssertion(page, 'traces-span-says-show-in-chat', async () => {
    await expect(button).toHaveText('Show in chat')
    await expect(button).toHaveAttribute('data-focus-turn', String(turnOf.get(page)))
    await expect(button).toHaveAttribute('data-focus-tool-call', /.+/)
  })
  await button.click()
})

Then('Chat scrolls to the bash tool call and highlights it', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-focus-highlights-the-tool-call', async () => {
    await expect(conversationTab(page, 'Chat')).toHaveAttribute('aria-selected', 'true')
    const highlighted = page.locator('[data-chat-call-id][data-chat-focus]')
    await expect(highlighted).toHaveCount(1, { timeout: 10_000 })
    await expect(highlighted.locator('xpath=ancestor-or-self::*[@data-chat-turn][1]')).toHaveAttribute('data-chat-turn', String(turnOf.get(page)))
    await expect(highlighted).toBeInViewport()
  })
})

When("the Traces panel opens the turn's trace and Open thread is clicked on its model call", async ({ page }: { page: Page }) => {
  await globalPanelLink(page, 'Traces: Explorer').click()
  await page.getByRole('textbox', { name: 'Search traces', exact: true }).fill('execute_tool bash')
  await page.getByRole('row', { name: 'dshfiles enter_ai_application_system', exact: true }).first().click()
  await waterfall(page).getByRole('treeitem').filter({ hasText: 'chat gpt-6-luna' }).first().click()
  const button = page.getByTestId('span-open-thread')
  await recordAssertion(page, 'traces-panel-span-opens-its-thread', () => expect(button).toHaveText('Open thread'))
  await button.click()
})

Then('the thread opens in Chat with that turn highlighted', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'chat-focus-from-another-panel', async () => {
    await expect(conversationTab(page, 'Chat')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator(`[data-chat-turn="${String(turnOf.get(page))}"][data-chat-focus]`)).toHaveCount(1, { timeout: 10_000 })
  })
  await finishJourneyAssertions(page)
})

When('priced synthetic turn spans tagged with this thread are posted to the receiver', async ({ page }: { page: Page }) => {
  await expect(sessionView(page)).toHaveAttribute('data-receiver-endpoint', /^http:\/\/127\.0\.0\.1:\d+$/, { timeout: 30_000 })
  const sessionId = (await sessionView(page).getAttribute('data-session-id')) ?? ''
  const endpoint = (await sessionView(page).getAttribute('data-receiver-endpoint')) ?? ''
  const startNs = BigInt(Date.now() - 20_000) * 1_000_000n
  const at = (offsetMs: number): string => (startNs + BigInt(offsetMs) * 1_000_000n).toString()
  const text = (key: string, value: string) => ({ key, value: { stringValue: value } })
  const int = (key: string, value: number) => ({ key, value: { intValue: String(value) } })
  const usd = (key: string, value: number) => ({ key, value: { doubleValue: value } })
  const turnSpans = (turn: number, cost: number, from: number) => {
    const traceId = hex(16)
    const root = hex(8)
    const base = [text('dsh.session.id', sessionId), int('dsh.turn', turn)]
    return [
      {
        traceId,
        spanId: root,
        name: 'invoke_agent deepseek-harness',
        kind: 3,
        startTimeUnixNano: at(from),
        endTimeUnixNano: at(from + 2_000),
        attributes: [...base, text('gen_ai.operation.name', 'invoke_agent'), usd('dshx.cost.usd', cost)],
        status: { code: 1 },
      },
      {
        traceId,
        spanId: hex(8),
        parentSpanId: root,
        name: 'chat gpt-test',
        kind: 3,
        startTimeUnixNano: at(from + 10),
        endTimeUnixNano: at(from + 1_500),
        attributes: [
          ...base,
          int('dsh.step', 1),
          text('gen_ai.operation.name', 'chat'),
          text('gen_ai.provider.name', 'openai'),
          text('gen_ai.request.model', 'gpt-test'),
          int('gen_ai.usage.input_tokens', 12_000),
          int('gen_ai.usage.output_tokens', 400),
          usd('dshx.cost.usd', cost),
          text('dshx.cost.price_id', 'openai/gpt-test'),
        ],
        status: { code: 1 },
      },
    ]
  }
  const body = {
    resourceSpans: [
      {
        resource: { attributes: [text('service.name', 'deepseek-harness')] },
        scopeSpans: [{ spans: [...turnSpans(1, 0.0125, 0), ...turnSpans(2, 1.5, 5_000)] }],
      },
    ],
  }
  const response = await fetch(`${endpoint}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  expect(response.status).toBe(200)
})

Then("the thread Traces tab shows the thread's total cost and each turn's cost", async ({ page }: { page: Page }) => {
  const summary = page.getByRole('region', { name: 'Thread telemetry summary', exact: true })
  await recordAssertion(page, 'traces-thread-total-cost', () => expect(summary.locator('[data-stat="statCost"]')).toContainText('$1.51', { timeout: 15_000 }))
  await recordAssertion(page, 'traces-turn-costs', async () => {
    const costs = sessionView(page).locator('tr[data-trace-id] td[data-trace-cost]')
    await expect(costs).toHaveCount(2)
    await expect(costs).toHaveText(['$1.50', '$0.0125'])
  })
})

Then('the model call span shows its own cost', async ({ page }: { page: Page }) => {
  await sessionView(page).locator('tr[data-trace-id]').first().click()
  await waterfall(sessionView(page)).getByRole('treeitem').filter({ hasText: 'chat gpt-test' }).click()
  await recordAssertion(page, 'traces-span-cost-badge', () => expect(sessionView(page).locator('[data-span-cost]')).toHaveText('$1.50'))
})

Then("the Traces panel overview lists the model's calls, tokens and cost", async ({ page }: { page: Page }) => {
  await globalPanelLink(page, 'Traces: Explorer').click()
  await page.getByRole('tab', { name: 'Operations', exact: true }).click()
  const table = page.getByTestId('traces-model-costs')
  await recordAssertion(page, 'traces-overview-model-costs', async () => {
    await expect(table.getByRole('row').filter({ hasText: 'gpt-test' })).toContainText('2', { timeout: 15_000 })
    await expect(table.getByRole('row').filter({ hasText: 'gpt-test' })).toContainText('$1.51')
    await expect(table.locator('[data-stat="modelCostTotal"]')).toHaveText('$1.51')
  })
  await finishJourneyAssertions(page)
})
