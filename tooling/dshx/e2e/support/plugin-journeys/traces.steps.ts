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

When('the Traces panel is opened', async ({ page }: { page: Page }) => {
  await openTraces(page)
})

Then('the receiver shows where it listens and how to send it telemetry', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'traces-receiver-listens-on-loopback', async () => {
    const endpoint = await receiverEndpoint(page)
    await expect(page.getByTestId('traces-empty-guide')).toContainText(`OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`)
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
