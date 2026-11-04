import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'

/** A synthetic Claude Code log and Codex rollout laid out the way each CLI writes them under HOME. */
const FIXTURE_HOME = fileURLToPath(new URL('../../../../../plugins/@dshfiles/agentsview/fixtures/home', import.meta.url))
const CLAUDE_KEY = 'claude-code:11111111-1111-4111-8111-111111111111'
const CODEX_KEY = 'codex:22222222-2222-4222-8222-222222222222'

const rows = (page: Page) => page.locator('[data-agent-session]')

When('Claude Code and Codex session logs are seeded into the scratch HOME', async ({ page }: { page: Page }) => {
  await cp(FIXTURE_HOME, profileFor(page).homeRoot, { recursive: true })
})

When('the Agent CLI threads page is opened and refreshed', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, 'Agent CLI threads')
  await expect(page.getByRole('heading', { name: 'Agent CLI threads', exact: true, level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(rows(page)).toHaveCount(2, { timeout: 45_000 })
})

Then('it lists both seeded sessions with their agent and working directory', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'agentsview-lists-claude-and-codex-sessions', async () => {
    const claude = page.locator(`[data-agent-session="${CLAUDE_KEY}"]`)
    await expect(claude).toContainText('Claude Code')
    await expect(claude).toContainText('Rename flamingo helper')
    await expect(claude).toContainText('agentsview/claude')
    const codex = page.locator(`[data-agent-session="${CODEX_KEY}"]`)
    await expect(codex).toContainText('Codex')
    await expect(codex).toContainText('Count the walrus tests')
    await expect(page.getByText('2 threads', { exact: true })).toBeVisible()
  })
})

Then('the agent filter narrows the list to Codex', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'agentsview-agent-filter-narrows-the-list', async () => {
    await page.getByRole('radio', { name: 'Codex', exact: true }).click()
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toHaveAttribute('data-agent-session', CODEX_KEY)
    await page.getByRole('radio', { name: 'All agents', exact: true }).click()
    await expect(rows(page)).toHaveCount(2)
  })
})

Then('a message search finds the Claude Code reply and opens it in its transcript', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'agentsview-message-search-opens-the-transcript', async () => {
    await page.getByRole('textbox', { name: 'Search agent CLI threads' }).fill('pelican in src')
    await page.getByRole('button', { name: 'Search messages' }).click()
    const hit = rows(page).filter({ hasText: 'Renamed flamingo to pelican' })
    await expect(hit).toHaveCount(1, { timeout: 30_000 })
    await hit.click()
    const reply = page.locator('[data-transcript-item="5"]')
    await expect(reply).toContainText('Renamed flamingo to pelican in src/flamingo.ts.')
    await expect(page.locator('[data-transcript-item][data-kind="tool-call"]')).toContainText('Grep')
  })
  await finishJourneyAssertions(page)
})
