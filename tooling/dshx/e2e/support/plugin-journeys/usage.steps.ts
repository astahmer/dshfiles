import { cp, mkdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'

const FIXTURE_SESSIONS = fileURLToPath(new URL('../../../../../plugins/@dshfiles/usage/fixtures/sessions', import.meta.url))

/** The shape AI Accounts caches models.dev prices in (USD per million tokens). */
const PRICE_CACHE = {
  version: 1,
  fetchedAt: Date.UTC(2026, 9, 12),
  source: 'e2e',
  providers: { openai: { 'gpt-6.1-sol': { input: 1.25, output: 10, cacheRead: 0.125 } } },
}

const logRows = (page: Page) => page.getByRole('table').getByRole('row')
const requestButton = (page: Page, name: RegExp) => page.getByRole('table').getByRole('button', { name })

When('recorded session logs and a price catalog are seeded', async ({ page }: { page: Page }) => {
  const home = profileFor(page).homeRoot
  await mkdir(join(home, 'sessions'), { recursive: true })
  await cp(FIXTURE_SESSIONS, join(home, 'sessions'), { recursive: true })
  await mkdir(join(home, 'plugins', 'ai-accounts'), { recursive: true })
  await writeFile(join(home, 'plugins', 'ai-accounts', 'pricing.json'), JSON.stringify(PRICE_CACHE))
  await mkdir(join(home, 'plugins', 'usage'), { recursive: true })
  const jevDatabase = new DatabaseSync(join(home, 'plugins', 'usage', 'usage.db'))
  try {
    jevDatabase.prepare('DELETE FROM jev_requests').run()
    const insert = jevDatabase.prepare(
      'INSERT INTO jev_requests (request_id, source, started_at, duration_ms, outcome, input_tokens, output_tokens, credential) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const startedAt = Date.now() - 60_000
    insert.run('00000000-0000-4000-8000-000000000001', 'memory', startedAt, 320, 'success', 100_000, 30, 'secret:MEMORY_JEV')
    insert.run('00000000-0000-4000-8000-000000000002', 'backlog', startedAt + 1_000, 280, 'success', 50_000, 10, 'secret:BACKLOG_JEV')
    insert.run('00000000-0000-4000-8000-000000000003', 'backlog', startedAt + 2_000, 120, 'failure', null, null, 'secret:BACKLOG_JEV')
  } finally {
    jevDatabase.close()
  }
})

When('the Usage analytics panel is opened on the range since {string}', async ({ page }: { page: Page }, from: string) => {
  await page.getByRole('button', { name: 'Usage analytics', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Usage analytics', exact: true, level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: 'Custom', exact: true }).click()
  await page.getByLabel('From date', { exact: true }).fill(from)
  await page.getByRole('button', { name: 'Re-index session logs', exact: true }).click()
  await expect(page.getByText(/ of the latest \d+ requests$/)).toBeVisible()
  await expect.poll(async () => logRows(page).count(), { timeout: 30_000 }).toBeGreaterThan(200)
})

Then('the request log lists requests with tokens, list-price costs, timings and status', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'usage-log-counts-every-request', async () => {
    await expect(page.getByRole('button', { name: /^All \d+$/ })).toHaveAccessibleName(/^All 23[6-9]$/)
    await expect(page.getByText(/^200 of the latest 23\d requests$/)).toBeVisible()
  })
  await recordAssertion(page, 'usage-log-row-shows-tokens-cost-and-timings', async () => {
    const row = logRows(page)
      .filter({ has: page.getByRole('cell', { name: '368', exact: true }) })
      .filter({ has: page.getByRole('cell', { name: '62K', exact: true }) })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('gpt-6.1-sol')
    await expect(row).toContainText('Subagent')
    await expect(row).toContainText('3.5s')
    await expect(row).toContainText('2.6s')
    await expect(row).toContainText(/\$0\.0\d{3}/)
    await expect(row).toContainText('toolUse')
  })
})

Then('the status chips, the search and the purpose filter narrow the log', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: /^Failed \d+$/ }).click()
  await recordAssertion(page, 'usage-status-chip-keeps-failures', async () => {
    await expect(requestButton(page, /deepseek/)).toHaveCount(1)
    await expect(requestButton(page, /codex-alex2/)).toHaveCount(1)
    await expect(page.getByRole('table')).toContainText('MISSING_CREDENTIAL')
    await expect(page.getByRole('table')).toContainText('ACP_REQUEST')
  })
  await page.getByRole('button', { name: /^All \d+$/ }).click()
  await page.getByRole('textbox', { name: 'Search requests', exact: true }).fill('other')
  await recordAssertion(page, 'usage-search-narrows-by-project', () => expect.poll(async () => logRows(page).count()).toBe(4))
  await page.getByRole('textbox', { name: 'Search requests', exact: true }).fill('')
  await page.getByRole('group', { name: 'Purpose' }).getByRole('button', { name: 'Compaction', exact: true }).click()
  await recordAssertion(page, 'usage-purpose-filter-keeps-compactions', () => expect.poll(async () => logRows(page).count()).toBe(7))
  await page.getByRole('group', { name: 'Purpose' }).getByRole('button', { name: 'All', exact: true }).click()
})

Then('a failed request opens the thread that made it', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: /^Failed \d+$/ }).click()
  await requestButton(page, /deepseek.*: open /).click()
  await recordAssertion(page, 'usage-row-opens-its-thread', async () => {
    await expect(page.getByText('This turn failed', { exact: false })).toBeVisible()
    await expect(page.getByText('activity timeline journey turn', { exact: true }).first()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the Charts tab is opened', async ({ page }: { page: Page }) => {
  await page.getByRole('tab', { name: 'Charts', exact: true }).click()
  await expect(page.getByText('Cost over time', { exact: true })).toBeVisible()
})

Then('the headline tiles, the charts and the top threads show the indexed usage', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'usage-tiles-show-totals', async () => {
    await expect(page.getByText('Cost (estimate)', { exact: true })).toBeVisible()
    await expect(page.getByText(/^23\d$/).first()).toBeVisible()
  })
  await recordAssertion(page, 'usage-charts-render', async () => {
    for (const name of ['Cost over time', 'Tokens over time', 'Cache hit ratio over time', 'Requests over time', 'TTFT and duration percentiles'])
      await expect(
        page
          .getByRole('img', { name })
          .or(page.getByLabel(name, { exact: true }))
          .first(),
      ).toBeVisible()
  })
  await recordAssertion(page, 'usage-top-threads-by-cost', () =>
    expect(page.getByRole('button', { name: /^Sample thread · sample\s*\$\d/ }).first()).toBeVisible(),
  )
})

Then('the Jev usage card shows DSH-local token estimates', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'usage-jev-card-shows-scoped-estimate', async () => {
    const card = page.locator('[data-usage-jev-card]')
    await expect(card).toHaveCount(1)
    await expect(card.locator('[data-usage-jev-card-title]')).toHaveText('Jev API usage')
    await expect(
      card.getByText('DSH-local estimated usage · $0.042 per 1M input tokens · output free. Not provider account balance.', { exact: true }),
    ).toBeVisible()
    await expect(card.getByText('Jev calls this month', { exact: true })).toBeVisible()
    await expect(card.getByText('3', { exact: true })).toBeVisible()
    await expect(card.getByText('150K', { exact: true })).toBeVisible()
    await expect(card.getByText('$0.0063', { exact: true })).toBeVisible()
    await expect(card.getByText('secret:BACKLOG_JEV')).toBeVisible()
    await expect(card.getByText('secret:MEMORY_JEV')).toBeVisible()
    await expect(card.getByText('$0.0021 · 2 requests')).toBeVisible()
    await expect(card.getByText('$0.0042 · 1 request')).toBeVisible()
    await expect(card.getByText('Usage by API key · calendar month to date')).toBeVisible()
    await expect(card.getByLabel('secret:BACKLOG_JEV share of input tokens this month')).toHaveAttribute('aria-valuetext', /50K input tokens/u)
    await expect(card.getByLabel('secret:MEMORY_JEV share of input tokens this month')).toHaveAttribute('aria-valuetext', /100K input tokens/u)
    await expect(card.getByText(/DSH-observed requests only; does not include outside DSH/u)).toBeVisible()
  })
})

Then('selecting a model in the cost breakdown shows its requests in the log', async ({ page }: { page: Page }) => {
  await page
    .getByRole('button', { name: /^gpt-6\.1-sol\s*\$/ })
    .first()
    .click()
  await recordAssertion(page, 'usage-breakdown-filters-the-log', async () => {
    await expect(page.getByRole('textbox', { name: 'Search requests', exact: true })).toHaveValue('gpt-6.1-sol')
    await expect.poll(async () => requestButton(page, /deepseek/).count()).toBe(0)
  })
  await finishJourneyAssertions(page)
})
