import { randomBytes } from 'node:crypto'
import { expect, type Page } from '@playwright/test'
import { bootComposedPluginProfile } from '../boot.js'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'

// Port 0 lets every scenario (and any parallel worker) bind its own free port; the panel shows which one it got.
const freePortPatch = `- id: dshfiles-traces
  config:
    port: 0
`

const exported = new WeakMap<Page, { readonly traceId: string; readonly clientSpanId: string }>()

const openTraces = async (page: Page): Promise<void> => {
  await page.getByRole('navigation', { name: 'Global panels', exact: true }).getByRole('button', { name: 'Traces', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Traces', exact: true, level: 1 })).toBeVisible()
}

const receiverEndpoint = async (page: Page): Promise<string> => {
  const badge = page.getByTestId('traces-receiver-state')
  await expect(badge).toHaveAttribute('data-state', 'listening', { timeout: 30_000 })
  const endpoint = await badge.getAttribute('title')
  expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  return endpoint ?? ''
}

const hex = (bytes: number): string => randomBytes(bytes).toString('hex')

const syntheticExport = (traceId: string, clientId: string) => {
  const startNs = BigInt(Date.now() - 5_000) * 1_000_000n
  const at = (offsetMs: number): string => (startNs + BigInt(offsetMs) * 1_000_000n).toString()
  const rootId = hex(8)
  const attribute = (key: string, value: string | number) =>
    typeof value === 'string' ? { key, value: { stringValue: value } } : { key, value: { intValue: String(value) } }
  return {
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', 'e2e-checkout'), attribute('deployment.environment', 'journey')] },
        scopeSpans: [
          {
            scope: { name: 'e2e-scope' },
            spans: [
              {
                traceId,
                spanId: rootId,
                name: 'POST /orders',
                kind: 2,
                startTimeUnixNano: at(0),
                endTimeUnixNano: at(120),
                attributes: [attribute('http.request.method', 'POST'), attribute('http.response.status_code', 500)],
                status: { code: 2, message: 'order failed' },
              },
              {
                traceId,
                spanId: clientId,
                parentSpanId: rootId,
                name: 'charge card',
                kind: 3,
                startTimeUnixNano: at(10),
                endTimeUnixNano: at(90),
                attributes: [attribute('peer.service', 'e2e-payments')],
                events: [{ name: 'exception', timeUnixNano: at(80), attributes: [attribute('exception.type', 'CardDeclined')] }],
                status: { code: 2, message: 'card declined 4012' },
              },
            ],
          },
        ],
      },
      {
        resource: { attributes: [attribute('service.name', 'e2e-payments')] },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId: hex(8),
                parentSpanId: clientId,
                name: 'authorize',
                kind: 2,
                startTimeUnixNano: at(20),
                endTimeUnixNano: at(70),
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  }
}

Given('the isolated Traces profile is booted with the receiver on a free port', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({ packageIds: ['@dshfiles/traces'], profileLabel: 'traces', cordisPatch: freePortPatch })
  await visitIsolatedPluginProfile(page, profile)
})

Given('the isolated Traces profile with {string} is booted with the receiver on a free port', async ({ page }: { page: Page }, companions: string) => {
  const companionIds = companions.split(',').map(packageId => packageId.trim())
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/traces', ...companionIds],
    profileLabel: `traces+${companionIds.join('+')}`,
    cordisPatch: freePortPatch,
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('the Traces panel is opened', async ({ page }: { page: Page }) => {
  await openTraces(page)
})

Then('the receiver shows where it listens and how to send it telemetry', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'traces-receiver-listens-on-loopback', async () => {
    const endpoint = await receiverEndpoint(page)
    const guide = page.getByTestId('traces-empty-guide')
    // The Host's own plugin spans need no environment variable and may already be stored, which retires the empty guide.
    await expect(guide.or(page.locator('tr[aria-label^="dshfiles "]').first())).toBeVisible()
    if (await guide.isVisible()) await expect(guide).toContainText(`OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`)
  })
})

When('a synthetic OTLP JSON export is posted to the receiver', async ({ page }: { page: Page }) => {
  const endpoint = await receiverEndpoint(page)
  const traceId = hex(16)
  const clientSpanId = hex(8)
  const response = await fetch(`${endpoint}/v1/traces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(syntheticExport(traceId, clientSpanId)),
  })
  expect(response.status).toBe(200)
  exported.set(page, { traceId, clientSpanId })
})

const exportedTraceId = (page: Page): string => {
  const traceId = exported.get(page)?.traceId
  if (traceId === undefined) throw new Error('No OTLP export was posted in this scenario.')
  return traceId
}

Then('the trace list shows the exported trace with its error count', async ({ page }: { page: Page }) => {
  const row = page.locator(`tr[data-trace-id="${exportedTraceId(page)}"]`)
  await recordAssertion(page, 'traces-list-shows-exported-trace', async () => {
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText('POST /orders')
    await expect(row).toContainText('120 ms')
    await expect(row.locator('[data-slot="badge"][data-variant="destructive"]')).toHaveText('2')
  })
})

Then('opening the trace renders the nested span waterfall with the failing span in red', async ({ page }: { page: Page }) => {
  await page.locator(`tr[data-trace-id="${exportedTraceId(page)}"]`).click()
  const waterfall = page.getByRole('tree', { name: 'Span waterfall' })
  await recordAssertion(page, 'traces-waterfall-nests-spans', async () => {
    await expect(waterfall.getByRole('treeitem')).toHaveCount(3)
    await expect(waterfall.getByRole('treeitem', { level: 1 })).toContainText('POST /orders')
    await expect(waterfall.getByRole('treeitem', { level: 2 })).toContainText('charge card')
    await expect(waterfall.getByRole('treeitem', { level: 3 })).toContainText('authorize')
    await expect(waterfall.locator('li[data-status="error"]')).toHaveCount(2)
    await expect(waterfall.locator('li[data-status="error"] [data-testid="span-bar"]').first()).toHaveClass(/bg-destructive/)
  })
  await waterfall.getByRole('button', { name: 'Collapse POST /orders' }).click()
  await recordAssertion(page, 'traces-waterfall-collapses', () => expect(waterfall.getByRole('treeitem')).toHaveCount(1))
  await waterfall.getByRole('button', { name: 'Expand POST /orders' }).click()
  await expect(waterfall.getByRole('treeitem')).toHaveCount(3)
})

Then('selecting a span shows its attributes and resource attributes', async ({ page }: { page: Page }) => {
  await page.getByRole('tree', { name: 'Span waterfall' }).getByRole('treeitem', { level: 2 }).click()
  const detail = page.getByRole('complementary', { name: 'Span detail' })
  await recordAssertion(page, 'traces-span-detail-shows-attributes', async () => {
    await expect(detail.getByRole('heading', { name: 'charge card' })).toBeVisible()
    await expect(detail.locator('[data-attribute="peer.service"]')).toHaveText('e2e-payments')
    await expect(detail.locator('[data-attribute="deployment.environment"]')).toHaveText('journey')
    await expect(detail).toContainText('card declined 4012')
    await expect(detail).toContainText('CardDeclined')
  })
  await finishJourneyAssertions(page)
})

Then('the span detail panel stays visible while scrolling the trace view', async ({ page }: { page: Page }) => {
  const main = page.locator('main.dshx-root')
  const detail = page.getByRole('complementary', { name: 'Span detail' })
  await page.getByRole('tree', { name: 'Span waterfall' }).evaluate(element => {
    element.style.minHeight = '1200px'
  })
  await main.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }))
  await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await recordAssertion(page, 'traces-span-detail-stays-visible-while-scrolling', async () => {
    await expect
      .poll(async () => {
        const mainTop = await main.evaluate(element => element.getBoundingClientRect().top)
        const detailTop = await detail.evaluate(element => element.getBoundingClientRect().top)
        return detailTop - mainTop
      })
      .toBeGreaterThanOrEqual(0)
    await expect
      .poll(async () => {
        const mainTop = await main.evaluate(element => element.getBoundingClientRect().top)
        const detailTop = await detail.evaluate(element => element.getBoundingClientRect().top)
        return detailTop - mainTop
      })
      .toBeLessThan(48)
  })
})

Then('the Operations tab lists each operation with its count and error rate', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Operations', exact: true }).click()
  const table = page.getByRole('table', { name: 'Operations' })
  await recordAssertion(page, 'traces-operations-summarize-spans', async () => {
    await expect(table.getByRole('row', { name: /charge card/ })).toContainText('100%', { timeout: 15_000 })
    await expect(table.getByRole('row', { name: /authorize/ })).toContainText('0%')
  })
})

Then('the Errors tab groups the failing span with a sample trace', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Errors', exact: true }).click()
  const groups = page.getByRole('list', { name: 'Errors' })
  await recordAssertion(page, 'traces-errors-group-failing-spans', async () => {
    await expect(groups.getByRole('listitem').filter({ hasText: 'charge card' })).toContainText('CardDeclined', { timeout: 15_000 })
  })
  await groups.getByRole('listitem').filter({ hasText: 'charge card' }).getByRole('button', { name: 'Open sample trace' }).click()
  await recordAssertion(page, 'traces-error-group-opens-sample-trace', () =>
    expect(page.getByRole('tree', { name: 'Span waterfall' }).getByRole('treeitem')).toHaveCount(3),
  )
  await finishJourneyAssertions(page)
})

When('synthetic OTLP JSON logs for that trace are posted to the receiver', async ({ page }: { page: Page }) => {
  const endpoint = await receiverEndpoint(page)
  const trace = exported.get(page)
  if (trace === undefined) throw new Error('No OTLP export was posted in this scenario.')
  const timeNs = (BigInt(Date.now() - 4_000) * 1_000_000n).toString()
  const record = (body: string, severityNumber: number, attributes: readonly { key: string; value: { stringValue: string } }[], spanId: string | null) => ({
    timeUnixNano: timeNs,
    severityNumber,
    body: { stringValue: body },
    attributes,
    traceId: trace.traceId,
    ...(spanId === null ? {} : { spanId }),
  })
  const response = await fetch(`${endpoint}/v1/logs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceLogs: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'e2e-checkout' } }] },
          scopeLogs: [
            {
              scope: { name: 'e2e-logger' },
              logRecords: [
                record('order received', 9, [{ key: 'order.id', value: { stringValue: 'o-7' } }], null),
                record('card declined by issuer', 17, [{ key: 'order.id', value: { stringValue: 'o-7' } }], trace.clientSpanId),
                record('unrelated heartbeat', 5, [{ key: 'order.id', value: { stringValue: 'o-8' } }], null),
              ],
            },
          ],
        },
      ],
    }),
  })
  expect(response.status).toBe(200)
})

const logRows = (page: Page) => page.getByRole('list', { name: 'Logs', exact: true }).getByRole('listitem')

Then('the Logs tab lists the records and filters them by severity and attribute', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Logs', exact: true }).click()
  await recordAssertion(page, 'traces-logs-list-records', async () => {
    await expect(logRows(page)).toHaveCount(3, { timeout: 15_000 })
    await expect(logRows(page).filter({ hasText: 'card declined by issuer' })).toContainText('ERROR')
  })
  await page.getByRole('combobox', { name: 'Severity', exact: true }).click()
  await page.getByRole('option', { name: 'Warn+', exact: true }).click()
  await recordAssertion(page, 'traces-logs-filter-by-severity', () => expect(logRows(page)).toHaveCount(1))
  await page.getByRole('combobox', { name: 'Severity', exact: true }).click()
  await page.getByRole('option', { name: 'All levels', exact: true }).click()
  await page.getByRole('textbox', { name: 'Attribute filter', exact: true }).fill('order.id=o-8')
  await recordAssertion(page, 'traces-logs-filter-by-attribute', async () => {
    await expect(logRows(page)).toHaveCount(1)
    await expect(logRows(page)).toContainText('unrelated heartbeat')
  })
  await page.getByRole('textbox', { name: 'Attribute filter', exact: true }).fill('')
  await expect(logRows(page)).toHaveCount(3)
})

Then('a log record opens its trace', async ({ page }: { page: Page }) => {
  const row = logRows(page).filter({ hasText: 'card declined by issuer' })
  await row.getByRole('button', { expanded: false }).click()
  await row.getByRole('button', { name: 'Open trace', exact: true }).click()
  await recordAssertion(page, 'traces-log-opens-its-trace', () =>
    expect(page.getByRole('tree', { name: 'Span waterfall' }).getByRole('treeitem')).toHaveCount(3),
  )
})

Then('the failing span shows only its own logs', async ({ page }: { page: Page }) => {
  await page.getByRole('tree', { name: 'Span waterfall' }).getByRole('treeitem', { level: 2 }).click()
  await page.getByRole('complementary', { name: 'Span detail' }).getByRole('button', { name: 'Logs for this span', exact: true }).click()
  await recordAssertion(page, 'traces-span-opens-its-logs', async () => {
    await expect(logRows(page)).toHaveCount(1)
    await expect(logRows(page)).toContainText('card declined by issuer')
  })
  await page.getByRole('button', { name: 'Show all logs', exact: true }).click()
  await expect(logRows(page)).toHaveCount(3)
  await finishJourneyAssertions(page)
})

Then('the service map shows both services and the call between them', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Service map', exact: true }).click()
  const map = page.getByRole('img', { name: 'Service map' })
  await recordAssertion(page, 'traces-service-map-draws-services-and-calls', async () => {
    await expect(map.locator('[data-service="e2e-checkout"]')).toBeVisible({ timeout: 15_000 })
    await expect(map.locator('[data-service="e2e-payments"]')).toBeVisible()
    await expect(map.locator('[data-edge="e2e-checkout->e2e-payments"]')).toHaveAttribute('data-errors', '0')
    await expect(map.locator('[data-edge="e2e-checkout->e2e-payments"]')).toContainText('1×')
  })
})

Then('picking a service on the map filters the trace list by it', async ({ page }: { page: Page }) => {
  await page.getByRole('img', { name: 'Service map' }).getByRole('button', { name: 'Service e2e-payments', exact: true }).click()
  await recordAssertion(page, 'traces-service-map-filters-traces', async () => {
    await expect(page.getByRole('tab', { name: 'Traces', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('combobox', { name: 'Service', exact: true })).toContainText('e2e-payments')
    await expect(page.locator(`tr[data-trace-id="${exportedTraceId(page)}"]`)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

const metricsExport = (offsetMs: number, requests: number) => {
  const timeNs = (BigInt(Date.now() - 30_000 + offsetMs) * 1_000_000n).toString()
  const route = [{ key: 'http.route', value: { stringValue: '/orders' } }]
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'e2e-checkout' } }] },
        scopeMetrics: [
          {
            scope: { name: 'e2e-meter' },
            metrics: [
              {
                name: 'http.server.requests',
                unit: '{request}',
                sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: [{ attributes: route, timeUnixNano: timeNs, asInt: String(requests) }] },
              },
              { name: 'process.cpu.utilization', unit: '1', gauge: { dataPoints: [{ attributes: [], timeUnixNano: timeNs, asDouble: 0.42 }] } },
              {
                name: 'http.server.duration',
                unit: 'ms',
                histogram: { aggregationTemporality: 2, dataPoints: [{ attributes: route, timeUnixNano: timeNs, count: '4', sum: 100 }] },
              },
            ],
          },
        ],
      },
    ],
  }
}

When('two synthetic OTLP JSON metric exports are posted to the receiver', async ({ page }: { page: Page }) => {
  const endpoint = await receiverEndpoint(page)
  for (const [offsetMs, requests] of [
    [0, 10],
    [10_000, 17],
  ] as const) {
    const response = await fetch(`${endpoint}/v1/metrics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(metricsExport(offsetMs, requests)),
    })
    expect(response.status).toBe(200)
  }
})

Then('the Metrics tab lists each metric with its type and last value', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Metrics', exact: true }).click()
  const table = page.getByRole('table', { name: 'Metrics' })
  await recordAssertion(page, 'traces-metrics-list', async () => {
    await expect(table.locator('tr[data-metric="http.server.requests"]')).toContainText('17', { timeout: 15_000 })
    await expect(table.locator('tr[data-metric="http.server.requests"]')).toContainText('sum')
    await expect(table.locator('tr[data-metric="process.cpu.utilization"]')).toContainText('0.420')
    await expect(table.locator('tr[data-metric="http.server.duration"]')).toContainText('25 ms')
  })
})

Then('selecting a counter charts its increase between exports', async ({ page }: { page: Page }) => {
  await page.getByRole('table', { name: 'Metrics' }).locator('tr[data-metric="http.server.requests"]').click()
  await recordAssertion(page, 'traces-metric-chart-shows-counter-increase', async () => {
    await expect(page.getByRole('img', { name: 'Chart of http.server.requests' })).toBeVisible()
    await expect(page.locator('figcaption').getByText('increase between exports (cumulative counter)', { exact: false })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then("this Host's own plugin spans arrive without any OTEL environment variable", async ({ page }: { page: Page }) => {
  // The scratch Host environment is an allowlist without OTEL_*, so only the in-process hand-off can deliver these.
  await recordAssertion(page, 'traces-self-telemetry-without-env', async () => {
    await expect(page.locator('tr[aria-label^="dshfiles "]').first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('traces-store-summary')).not.toContainText(/^0 traces/)
  })
  await finishJourneyAssertions(page)
})

const sessionView = (page: Page) => page.getByTestId('traces-session-view')
const conversationTab = (page: Page, name: string) => page.locator('[data-conversation-tabs]').getByRole('tab', { name, exact: true })

When('the thread Traces tab is opened', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'traces-thread-tab-follows-trajectory', async () => {
    const names = await page.locator('[data-conversation-tabs]').getByRole('tab').allTextContents()
    expect(names.indexOf('Traces')).toBeGreaterThan(names.indexOf('Chat'))
    if (names.includes('Trajectory')) expect(names.indexOf('Traces')).toBe(names.indexOf('Trajectory') + 1)
  })
  await conversationTab(page, 'Traces').click()
  await expect(sessionView(page)).toBeVisible()
})

Then('the thread Traces tab says nothing was exported for this thread yet', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'traces-thread-tab-empty-state', async () => {
    await expect(page.getByTestId('traces-session-empty')).toContainText('No telemetry for this thread yet')
    await expect(page.getByTestId('traces-session-empty').getByTestId('traces-empty-guide')).toBeVisible()
  })
})

const posted = new WeakMap<Page, { readonly traceId: string }>()

When('synthetic agent turn spans tagged with this thread are posted to the receiver', async ({ page }: { page: Page }) => {
  await expect(sessionView(page)).toHaveAttribute('data-receiver-endpoint', /^http:\/\/127\.0\.0\.1:\d+$/, { timeout: 30_000 })
  const sessionId = (await sessionView(page).getAttribute('data-session-id')) ?? ''
  const endpoint = (await sessionView(page).getAttribute('data-receiver-endpoint')) ?? ''
  const traceId = hex(16)
  const ids = { root: hex(8), chat: hex(8), tool: hex(8), plugin: hex(8) }
  const startNs = BigInt(Date.now() - 10_000) * 1_000_000n
  const at = (offsetMs: number): string => (startNs + BigInt(offsetMs) * 1_000_000n).toString()
  const attribute = (key: string, value: string | number) =>
    typeof value === 'string' ? { key, value: { stringValue: value } } : { key, value: { intValue: String(value) } }
  const agentSpan = (spanId: string, parentSpanId: string | null, name: string, from: number, to: number, extra: readonly ReturnType<typeof attribute>[]) => ({
    traceId,
    spanId,
    ...(parentSpanId === null ? {} : { parentSpanId }),
    name,
    kind: 1,
    startTimeUnixNano: at(from),
    endTimeUnixNano: at(to),
    attributes: [attribute('dsh.session.id', sessionId), ...extra],
    status: { code: 0 },
  })
  const traces = {
    resourceSpans: [
      {
        resource: { attributes: [attribute('service.name', 'deepseek-harness')] },
        scopeSpans: [
          {
            spans: [
              agentSpan(ids.root, null, 'invoke_agent deepseek-harness', 0, 3_000, [attribute('gen_ai.operation.name', 'invoke_agent')]),
              agentSpan(ids.chat, ids.root, 'chat fake-model', 10, 1_200, [
                attribute('gen_ai.operation.name', 'chat'),
                attribute('gen_ai.usage.input_tokens', 1_200),
                attribute('gen_ai.usage.output_tokens', 80),
              ]),
              agentSpan(ids.tool, ids.root, 'execute_tool bash', 1_300, 2_900, [attribute('gen_ai.operation.name', 'execute_tool')]),
              {
                ...agentSpan(hex(8), null, 'invoke_agent deepseek-harness', 0, 500, []),
                traceId: hex(16),
                attributes: [attribute('dsh.session.id', 'session-elsewhere')],
              },
            ],
          },
        ],
      },
      {
        resource: { attributes: [attribute('service.name', 'dshfiles')] },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId: ids.plugin,
                parentSpanId: ids.tool,
                name: 'jujutsu/status',
                kind: 2,
                startTimeUnixNano: at(1_400),
                endTimeUnixNano: at(1_600),
                attributes: [],
                status: { code: 0 },
              },
            ],
          },
        ],
      },
    ],
  }
  const logs = {
    resourceLogs: [
      {
        resource: { attributes: [attribute('service.name', 'dshfiles')] },
        scopeLogs: [
          {
            logRecords: [
              { timeUnixNano: at(1_500), severityNumber: 9, body: { stringValue: 'tool ran for this thread' }, attributes: [], traceId, spanId: ids.tool },
              { timeUnixNano: at(1_500), severityNumber: 9, body: { stringValue: 'another thread' }, attributes: [], traceId: hex(16) },
            ],
          },
        ],
      },
    ],
  }
  for (const [signal, body] of [
    ['traces', traces],
    ['logs', logs],
  ] as const) {
    const response = await fetch(`${endpoint}/v1/${signal}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(response.status).toBe(200)
  }
  posted.set(page, { traceId })
})

Then("the thread Traces tab summarizes only this thread's telemetry", async ({ page }: { page: Page }) => {
  const summary = page.getByRole('region', { name: 'Thread telemetry summary', exact: true })
  await recordAssertion(page, 'traces-thread-tab-summary', async () => {
    await expect(summary.locator('[data-stat="statTraces"]')).toContainText('1', { timeout: 15_000 })
    await expect(summary.locator('[data-stat="statSpans"]')).toContainText('4')
    await expect(summary.locator('[data-stat="statModelCalls"]')).toContainText('1')
    await expect(summary.locator('[data-stat="statToolCalls"]')).toContainText('1')
    await expect(summary.locator('[data-stat="statTokens"]')).toContainText('1.2K · 80')
    await expect(sessionView(page).locator('tr[data-trace-id]')).toHaveCount(1)
  })
})

Then('a turn opens its span waterfall with the plugin span nested under the tool call', async ({ page }: { page: Page }) => {
  const traceId = posted.get(page)?.traceId ?? ''
  await sessionView(page).locator(`tr[data-trace-id="${traceId}"]`).click()
  const waterfall = sessionView(page).getByRole('tree', { name: 'Span waterfall' })
  await recordAssertion(page, 'traces-thread-tab-waterfall', async () => {
    await expect(waterfall.getByRole('treeitem')).toHaveCount(4)
    await expect(waterfall.getByRole('treeitem', { level: 3 })).toContainText('jujutsu/status')
    await expect(sessionView(page).getByRole('button', { name: 'Open thread' })).toHaveCount(0)
  })
})

Then('the thread logs list only its own records', async ({ page }: { page: Page }) => {
  await sessionView(page).getByRole('radio', { name: 'Logs', exact: true }).click()
  const rows = sessionView(page).getByRole('list', { name: 'Logs', exact: true }).getByRole('listitem')
  await recordAssertion(page, 'traces-thread-tab-logs', async () => {
    await expect(rows).toHaveCount(1, { timeout: 15_000 })
    await expect(rows).toContainText('tool ran for this thread')
  })
})

Then('the thread Traces tab fits a 480 px wide window', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 480, height: 900 })
  await sessionView(page).getByRole('radio', { name: 'Turns', exact: true }).click()
  await recordAssertion(page, 'traces-thread-tab-narrow', async () => {
    await expect(page.getByRole('region', { name: 'Thread telemetry summary', exact: true })).toBeVisible()
    const overflow = await sessionView(page).evaluate(element => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
  await finishJourneyAssertions(page)
})
