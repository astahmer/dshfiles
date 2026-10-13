import { expect, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { fakeCommandCodeFor, type FakeChatRequest } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

const SECRET = 'e2e-secret-value-731'
const FAKE_MODEL = 'commandcode_work/gpt-6-luna'
const MEMORY_HEADER = 'Persistent memory (OptMem), full mode'
const scratchRoots = new WeakMap<Page, string>()

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })
const statusValue = (page: Page, term: string) => settingsDialog(page).getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::*[1]')

const openMemorySettings = async (page: Page): Promise<void> => {
  if (!(await settingsDialog(page).isVisible())) await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settingsDialog(page).getByRole('button', { name: 'Memory', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Memory (OptMem)', exact: true })).toBeVisible()
}

const saveMemorySettings = async (page: Page): Promise<void> => {
  await settingsDialog(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settingsDialog(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
}

const closeSettings = async (page: Page): Promise<void> => {
  await settingsDialog(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(settingsDialog(page)).toBeHidden()
}

const refreshStatus = async (page: Page): Promise<void> => {
  await settingsDialog(page).getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(settingsDialog(page).getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled()
}

const searchMemory = async (page: Page, query: string) => {
  await page.getByRole('button', { name: 'OptMem', exact: true }).click()
  await page.getByRole('tab', { name: 'Explore', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search project memories', exact: true }).fill(query)
  return page.getByRole('button').filter({ hasText: query })
}

const turnRequests = (page: Page): readonly FakeChatRequest[] => fakeCommandCodeFor(page).requests.filter(request => request.kind === 'turn')

const addWorkspace = async (page: Page, name: string): Promise<string> => {
  const root = scratchRoots.get(page) ?? (await createScratchDirectory('dshx-optmem-e2e-'))
  scratchRoots.set(page, root)
  const workspace = join(root, name)
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, '.env'), `SECRET_TOKEN=${SECRET}\n`)
  await writeFile(join(workspace, 'README.md'), `# ${name}\n`)
  await registerWorkspaceFolder(page, workspace)
  return workspace
}

When('a disposable workspace {string} holding a secret .env file is added', async ({ page }: { page: Page }, name: string) => {
  await addWorkspace(page, name)
})

When('a thread in the workspace {string} uses the fake Command Code model', async ({ page }: { page: Page }, name: string) => {
  await startThreadWithModel(page, { project: name, model: FAKE_MODEL })
})

When('{string} is sent to the fake model', async ({ page }: { page: Page }, text: string) => {
  await sendMessage(page, text)
})

When('OptMem is switched to full mode with a {int}-byte injected view', async ({ page }: { page: Page }, budget: number) => {
  await openMemorySettings(page)
  await settingsDialog(page).getByRole('combobox', { name: 'Mode', exact: true }).selectOption('full')
  await settingsDialog(page).getByRole('spinbutton', { name: 'Injected view budget', exact: true }).fill(String(budget))
  await saveMemorySettings(page)
  await refreshStatus(page)
  await expect(settingsDialog(page).getByText('Full mode', { exact: true })).toBeVisible()
  await closeSettings(page)
})

When('OptMem summaries {string}', async ({ page }: { page: Page }, behavior: string) => {
  const fake = fakeCommandCodeFor(page)
  if (behavior === 'fail') fake.summaries = 'fail'
  else if (behavior === 'hang') fake.summaries = 'hang'
  else fake.summaries = 'answer'
})

When('cross-project memory tools are enabled', async ({ page }: { page: Page }) => {
  await openMemorySettings(page)
  await settingsDialog(page).getByRole('switch', { name: 'Cross-project memory tools', exact: true }).click()
  await saveMemorySettings(page)
  await closeSettings(page)
})

When('the OptMem database is replaced by a corrupt file while OptMem is off', async ({ page }: { page: Page }) => {
  await openMemorySettings(page)
  const enabled = settingsDialog(page).getByRole('switch', { name: 'Enable OptMem', exact: true })
  const databasePath = ((await statusValue(page, 'Database').textContent()) ?? '').replace(/^.* · /, '').trim()
  expect(databasePath).toMatch(/\/plugins\/optmem\/optmem\.db$/)
  await enabled.click()
  await saveMemorySettings(page)
  await refreshStatus(page)
  await expect(settingsDialog(page).getByText('off', { exact: true })).toBeVisible()
  await rm(`${databasePath}-wal`, { force: true })
  await rm(`${databasePath}-shm`, { force: true })
  await writeFile(databasePath, 'not a sqlite database '.repeat(200))
  await enabled.click()
  await saveMemorySettings(page)
})

Then('OptMem search finds {string} exactly once', async ({ page }: { page: Page }, marker: string) => {
  const hits = await searchMemory(page, marker)
  await recordAssertion(page, 'optmem-capture-stores-a-redelivered-message-once', async () => {
    await expect(hits.first()).toBeVisible({ timeout: 30_000 })
    await expect(hits).toHaveCount(1)
  })
})

Then('memory keeps only an exclusion marker for the .env read', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'optmem-excluded-path-is-stored-as-a-marker', async () => {
    const markers = await searchMemory(page, 'excluded')
    await expect(markers.first()).toBeVisible({ timeout: 30_000 })
    const toolResult = turnRequests(page)
      .flatMap(request => request.messages)
      .find(message => message.role === 'tool')
    expect(toolResult?.text).toContain(SECRET)
  })
  await recordAssertion(page, 'optmem-excluded-file-content-never-reaches-memory', async () => {
    const leaks = await searchMemory(page, SECRET)
    await expect(page.getByText('No memory matches this search.', { exact: true })).toBeVisible()
    await expect(leaks).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('full mode is offered only with request-messages and the status reports compatibility', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'optmem-full-mode-needs-request-messages', async () => {
    const mode = settingsDialog(page).getByRole('combobox', { name: 'Mode', exact: true })
    await expect(mode).toBeDisabled()
    await expect(mode.getByRole('option', { name: 'Full (needs @dshfiles/request-messages)', exact: true })).toBeDisabled()
    await expect(settingsDialog(page).getByText('Compatibility mode', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the next turn carries {string} only through the bounded memory view', async ({ page }: { page: Page }, marker: string) => {
  await recordAssertion(page, 'optmem-full-mode-replaces-history-with-the-memory-view', () => {
    const last = turnRequests(page).at(-1)
    const memory = last?.messages.find(message => message.text.startsWith(MEMORY_HEADER))
    expect(memory?.text).toContain(marker)
    const raw = last?.messages.filter(message => message.role === 'user' && !message.text.startsWith(MEMORY_HEADER) && message.text.includes(marker)) ?? []
    expect(raw).toEqual([])
  })
  await recordAssertion(page, 'optmem-injected-view-stays-within-its-budget', () => {
    const memory = turnRequests(page)
      .at(-1)
      ?.messages.find(message => message.text.startsWith(MEMORY_HEADER))
    const view = memory?.text.split('The current turn follows below.').at(-1) ?? ''
    expect(Buffer.byteLength(view.trim(), 'utf8')).toBeGreaterThan(0)
    expect(Buffer.byteLength(view.trim(), 'utf8')).toBeLessThanOrEqual(1_024)
  })
  await finishJourneyAssertions(page)
})

Then('the OptMem status reports a pending summary and the summarizer error', async ({ page }: { page: Page }) => {
  await openMemorySettings(page)
  await recordAssertion(page, 'optmem-failed-summary-stays-pending', async () => {
    await expect(async () => {
      await refreshStatus(page)
      await expect(statusValue(page, 'Pending leaf entries')).not.toHaveText('0', { timeout: 1_000 })
      await expect(statusValue(page, 'Current error')).not.toHaveText('none', { timeout: 1_000 })
    }).toPass({ timeout: 45_000 })
    expect(fakeCommandCodeFor(page).requests.some(request => request.kind === 'summary')).toBe(true)
  })
  await closeSettings(page)
})

Then('the raw message {string} is still searchable while its summary is pending', async ({ page }: { page: Page }, marker: string) => {
  await recordAssertion(page, 'optmem-pending-event-remains-searchable', async () => {
    const hits = await searchMemory(page, marker)
    await expect(hits.first()).toBeVisible({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

When('{string} is sent and stopped while OptMem waits for pending summaries', async ({ page }: { page: Page }, text: string) => {
  const before = turnRequests(page).length
  const composer = page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
  await composer.fill(text)
  await composer.press('Enter')
  const stop = page.getByRole('button', { name: /^Stop/ }).first()
  await expect(stop).toBeVisible()
  await stop.click()
  await expect(page.getByRole('status').filter({ hasText: /^(Stopped|Cancelled|Interrupted)$/ }).last()).toBeVisible({ timeout: 30_000 })
  expect(turnRequests(page).length).toBe(before)
})

Then('the stopped turn never reached the provider', async ({ page }: { page: Page }) => {
  const before = turnRequests(page).length
  await recordAssertion(page, 'optmem-barrier-cancellation-sends-no-stale-context', async () => {
    await expect.poll(() => turnRequests(page).length, { timeout: 8_000 }).toBe(before)
    expect(fakeCommandCodeFor(page).requests.some(request => request.kind === 'summary')).toBe(true)
  })
  await finishJourneyAssertions(page)
})

Then('the memory search tool result {string} {string}', async ({ page }: { page: Page }, expectation: string, marker: string) => {
  const result = turnRequests(page)
    .at(-1)
    ?.messages.filter(message => message.role === 'tool')
    .at(-1)
  await recordAssertion(page, `optmem-memory-search-${expectation}-after-turn-${String(turnRequests(page).length)}`, () => {
    expect(result?.role).toBe('tool')
    if (expectation === 'contains') expect(result?.text).toContain(marker)
    else expect(result?.text ?? '').not.toContain(marker)
  })
  if (expectation === 'contains') await finishJourneyAssertions(page)
})

Then('OptMem reports the database failure and the Host stays responsive', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'optmem-database-failure-is-reported', async () => {
    await expect(async () => {
      await refreshStatus(page)
      await expect(settingsDialog(page).getByText('failed', { exact: true })).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 30_000 })
    await expect(statusValue(page, 'Current error')).toHaveText('file is not a database')
  })
  await closeSettings(page)
  await recordAssertion(page, 'optmem-database-failure-leaves-the-host-responsive', async () => {
    await page.getByRole('button', { name: 'New session', exact: true }).first().click()
    await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
    await openMemorySettings(page)
    await refreshStatus(page)
    await expect(settingsDialog(page).getByText('failed', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const root = scratchRoots.get(page)
  if (root === undefined) return
  scratchRoots.delete(page)
  await rm(root, { recursive: true, force: true })
})
