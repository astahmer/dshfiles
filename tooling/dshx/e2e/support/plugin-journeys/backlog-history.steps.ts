import { mkdtempSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { createScratchDirectory, sendMessage, startThreadWithModel } from '../threads.js'
import { backlogRef } from './backlog-refs.js'

const feed = (page: Page) => page.getByRole('feed', { name: 'Backlog feed' })
const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })
const shortAlias = /^Item b:([0-9a-hjkmnp-tv-z]{4})$/u
const aliases = new WeakMap<Page, string>()

Then('the captured item {string} is named by a short alias', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-short-alias-shown', async () => {
    const article = feed(page)
      .getByRole('article', { name: /^Item b:/u })
      .filter({ hasText: title })
    await expect(article).toHaveAttribute('aria-label', shortAlias)
    const alias = shortAlias.exec((await article.getAttribute('aria-label')) ?? '')?.[1] ?? ''
    expect(alias).toMatch(/[a-z]/u)
    aliases.set(page, alias)
  })
})

Then('searching for that alias finds only {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-short-alias-search', async () => {
    const search = page.getByRole('textbox', { name: 'Search backlog', exact: true })
    await search.fill(`b:${aliases.get(page) ?? ''}`)
    await search.press('Enter')
    const results = page.getByRole('list', { name: 'Search results' })
    await expect(results.getByRole('listitem', { name: /^Item b:/u })).toHaveCount(1)
    await expect(results).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

const revertButton = (page: Page, field: string, before: string) => peek(page).getByRole('button', { name: `Revert ${field} to ${before}`, exact: true })

When('the {string} change from {string} is reverted from the item history', async ({ page }: { page: Page }, field: string, before: string) => {
  const collapsed = peek(page).getByRole('button', { name: /made \d+ changes/u })
  if ((await collapsed.count()) > 0) await collapsed.first().click()
  const hidden = peek(page).getByRole('button', { name: 'Show changes', exact: true })
  for (let remaining = await hidden.count(); remaining > 0; remaining -= 1) await hidden.first().click()
  await revertButton(page, field, before).click()
})

Then('the item history says the kind changed again since', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-revert-stale-refused', async () => {
    const refusal = peek(page).getByRole('alert').filter({ hasText: 'changed again since' })
    await expect(refusal).toContainText('Revert that later change first')
  })
  await finishJourneyAssertions(page)
})

const exportFiles = new WeakMap<Page, string>()

When('the backlog is exported as JSON Lines from the settings tab', async ({ page }: { page: Page }) => {
  const target = join(mkdtempSync(join(tmpdir(), 'dshfiles-backlog-export-e2e-')), 'backlog.jsonl')
  exportFiles.set(page, target)
  await page.getByRole('button', { name: 'Backlog settings', exact: true }).click()
  await page.getByRole('button', { name: 'Export…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export the backlog', exact: true })
  await dialog.getByRole('textbox', { name: 'Export file', exact: true }).fill(target)
  await dialog.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

Then('the export file holds the item {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-export-jsonl', async () => {
    const target = exportFiles.get(page) ?? ''
    await expect(page.getByRole('status').filter({ hasText: `Exported 1 items to ${target}` })).toBeVisible()
    const lines = readFileSync(target, 'utf8').trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`"title":"${title}"`)
  })
  await finishJourneyAssertions(page)
})

/** Two multi-host runtimes this Host cannot reach, as a Hosts panel adds them: enough for the backlog to list them. */
When('two multi-host Hosts are seeded', async ({ page }: { page: Page }) => {
  const createdAt = '2026-11-11T00:00:00.000Z'
  const launchUrl = 'http://127.0.0.1:1/?token=dshx-e2e-backlog-peer'
  const host = (id: string, name: string, position: number) => ({
    schemaVersion: 2,
    id,
    name,
    connector: { kind: 'local' },
    hidden: false,
    position,
    createdAt,
  })
  const runtime = (id: string, hostId: string, name: string, originPort: number) => ({
    schemaVersion: 2,
    id,
    hostId,
    name,
    locator: { kind: 'local', launchUrl },
    identity: null,
    originPort,
    createdAt,
  })
  const directory = {
    schemaVersion: 2,
    hosts: [host('studio', 'Studio', 0), host('build-box', 'Build box', 1)],
    runtimes: [
      runtime('10000000-0000-4000-8000-00000000bacc', 'studio', 'Studio', 43_011),
      runtime('10000000-0000-4000-8000-00000000bacd', 'build-box', 'Build box', 43_012),
    ],
    retiredPorts: [],
  }
  const dataDirectory = join(profileFor(page).homeRoot, 'plugins', 'multi-host')
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  await writeFile(join(dataDirectory, 'directory.json'), `${JSON.stringify(directory, null, 2)}\n`, { mode: 0o600 })
  await page.reload()
  await StartupDialogs.registerProviderSetupDismissal(page)
  await openGlobalPanel(page, 'Backlog')
  await page.getByRole('button', { name: 'Backlog settings', exact: true }).click()
})

Then('the Hosts section lists both Hosts and where each runs automation', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-hosts-peers', async () => {
    const hosts = page.getByRole('region', { name: 'Hosts', exact: true })
    const buildBox = hosts.getByRole('listitem', { name: 'Host Build box' })
    await expect(buildBox).toBeVisible()
    await expect(buildBox).toContainText('Automation Host not reported yet')
    await expect(hosts.getByRole('listitem', { name: 'Host Studio' })).toBeVisible()
    await expect(hosts).not.toContainText('No other Host yet')
  })
  await finishJourneyAssertions(page)
})

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'
const toolDirective = (tool: string, input: object): string => `[[call ${tool} ${JSON.stringify(input)}]]`
const conversation = (page: Page) => peek(page).getByRole('list', { name: 'Conversation', exact: true })
const workLogToggle = (page: Page) => peek(page).getByRole('button', { name: /^Work log/u })

When('an agent thread comments {string} on b:{int}', async ({ page }: { page: Page }, text: string, ordinal: number) => {
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, toolDirective('backlog_comment', { id: `b:${await backlogRef(page, ordinal)}`, text }))
})

When('the agent thread captures {string} in another project', async ({ page }: { page: Page }, text: string) => {
  const project = await createScratchDirectory('dshfiles-backlog-agent-project-')
  await sendMessage(page, toolDirective('backlog_capture', { text, project }))
})

Then('the conversation shows {string} but not {string}', async ({ page }: { page: Page }, shown: string, folded: string) => {
  await recordAssertion(page, 'backlog-timeline-conversation-lane', async () => {
    await expect(conversation(page)).toContainText(shown)
    await expect(conversation(page)).not.toContainText(folded)
    await expect(workLogToggle(page)).toContainText(/1 agent · \d+ updates? · last /u)
  })
})

When('the work log is opened', async ({ page }: { page: Page }) => {
  await workLogToggle(page).click()
})

Then('the work log shows {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'backlog-timeline-work-log-lane', async () => {
    await expect(peek(page).getByRole('list', { name: 'Work log', exact: true })).toContainText(text)
  })
})

const projectsTotal = (page: Page) => page.getByText(/^Grouped from the repositories items were captured in\./u)

Then('the project cards count {int} project(s)', async ({ page }: { page: Page }, total: number) => {
  await recordAssertion(page, `backlog-projects-count-${String(total)}`, async () => {
    await expect(projectsTotal(page)).toContainText(`${String(total)} in total.`)
  })
})

Then('the project cards count {int} project(s) once agent items show', async ({ page }: { page: Page }, total: number) => {
  await recordAssertion(page, 'backlog-projects-count-agent-items-shown', async () => {
    await expect(projectsTotal(page)).toContainText(`${String(total)} in total.`)
  })
  await finishJourneyAssertions(page)
})
