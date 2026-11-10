import { expect, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DSHFILES_ROOT } from '../../../packages/dshx/src/project/local-bundles.js'
import { bootComposedPluginProfile } from '../boot.js'
import { Given, Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion, restartScratchProfileInBrowser, visitIsolatedPluginProfile } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const THREAD_TITLE = 'Timed question fixture'
const QUESTION_TEXT = 'Which environment should the timed-question fixture deploy to?'
/** Short enough to watch the foreground wait end inside a journey, long enough to read the countdown first. */
const FOREGROUND_WAIT_SECONDS = 12
/** Long enough that only the Stop under test can end the wait. */
const LONG_WAIT_SECONDS = 600
const PENDING_NOTICE = 'Work continued — you can still answer'

const askDirective = (timeout: number): string =>
  `[[title ${THREAD_TITLE}]] [[once call ask_user_question ${JSON.stringify({
    questions: [
      {
        id: 'deploy-target',
        header: 'Deploy',
        question: QUESTION_TEXT,
        options: [{ label: 'Staging (Recommended)', description: 'Safe default for the fixture.' }, { label: 'Production' }],
      },
    ],
    timeout,
  })}]]`

/**
 * The web seed turns DSH's `tool-ask-user` row into `mode: timed`, but that row is a child of `preset-standard`, whose
 * patch replaces the preset's whole config. The journey copies that exact row from the seed instead of restating it, so
 * the scratch Agent runs the same preset the web profile ships.
 */
export const seedPresetRow = async (): Promise<string> => {
  const source = await readFile(join(DSHFILES_ROOT, 'profiles/web/cordis.patch.yml'), 'utf8')
  const lines = source.split('\n')
  const start = lines.findIndex(line => line === '- id: preset-standard')
  if (start === -1) throw new Error('profiles/web/cordis.patch.yml has no preset-standard row.')
  const end = lines.findIndex((line, index) => index > start && line.startsWith('- '))
  const row = lines.slice(start, end === -1 ? undefined : end).join('\n')
  if (!/tool-ask-user[\s\S]*?mode: timed/u.test(row)) throw new Error('The seeded preset no longer selects timed ask_user_question.')
  return `${row.trimEnd()}\n`
}

const questionCard = (page: Page) => page.locator('[data-question-key]').filter({ hasText: QUESTION_TEXT })
const countdown = (page: Page) => questionCard(page).locator('header span').filter({ hasText: /^Continuing in \d+s$/u })
const secondsLeft = async (page: Page): Promise<number> => Number(/(\d+)s$/u.exec((await countdown(page).textContent()) ?? '')?.[1] ?? Number.NaN)
const probe = async (name: string, content: () => Promise<string>): Promise<void> => {
  const directory = process.env.DSHX_PROBE_DIR
  if (directory !== undefined) await writeFile(join(directory, name), await content())
}

const askInFreshWorkspace = async (page: Page, timeout: number): Promise<void> => {
  const root = await createScratchDirectory('dshx-timed-question-e2e-')
  const workspace = join(root, 'timed-question-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'timed-question-project', model: 'commandcode_work/gpt-6-luna' })
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(askDirective(timeout))
  await composer.press('Enter')
  // The New thread view usually follows the thread it started; when it stays put, open the thread as a user would.
  const thread = page.getByRole('treeitem', { name: new RegExp(THREAD_TITLE, 'u') }).first()
  await expect(async () => {
    if (!(await questionCard(page).isVisible()) && (await thread.isVisible())) await thread.click()
    await expect(questionCard(page)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
}

Given('the isolated Agent Questions composition with timed questions is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/agent-questions', '@dshfiles/ai-accounts', '@dshfiles/workspace-folder-picker'],
    profileLabel: 'agent-questions-timed',
    cordisPatch: await seedPresetRow(),
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('the fake model asks a timed question in a fresh workspace', async ({ page }: { page: Page }) => {
  await askInFreshWorkspace(page, FOREGROUND_WAIT_SECONDS)
})

When('the fake model asks a timed question with a long wait in a fresh workspace', async ({ page }: { page: Page }) => {
  await askInFreshWorkspace(page, LONG_WAIT_SECONDS)
})

Then('the question card counts down with a steady countdown while the Agent waits', async ({ page }: { page: Page }) => {
  const card = questionCard(page)
  await probe('card.html', () => card.evaluate(element => element.outerHTML))
  await recordAssertion(page, 'agent-questions-root-timed-card-countdown', async () => {
    await expect(card.getByRole('radio', { name: 'Staging', exact: true })).toHaveAttribute('aria-checked', 'true')
    await expect(card.getByText('Recommended', { exact: true })).toBeVisible()
    await expect(countdown(page)).toBeVisible()
    const first = await secondsLeft(page)
    expect(first).toBeLessThanOrEqual(FOREGROUND_WAIT_SECONDS)
    await expect.poll(() => secondsLeft(page), { timeout: 5_000 }).toBeLessThan(first)
  })
  // question-card-layout: the countdown keeps tabular digits, so its width does not jitter as it ticks.
  await recordAssertion(page, 'agent-questions-question-card-tabular-countdown', async () => {
    expect(await countdown(page).evaluate(element => getComputedStyle(element).fontVariantNumeric)).toContain('tabular-nums')
  })
})

When('the wait ends pending while the question stays answerable', async ({ page }: { page: Page }) => {
  const card = questionCard(page)
  await recordAssertion(page, 'agent-questions-root-timed-pending-result', async () => {
    await expect(card.getByText(PENDING_NOTICE, { exact: true })).toBeVisible({ timeout: (FOREGROUND_WAIT_SECONDS + 30) * 1_000 })
    // The model got the pending result and kept working: its next turn answered after the tool result.
    await expect(page.getByText('Tool finished.', { exact: true })).toBeVisible({ timeout: 30_000 })
    const toolResults = fakeCommandCodeFor(page).requests.flatMap(request => request.messages.filter(message => message.role === 'tool'))
    expect(toolResults.some(message => message.text.includes('"pending":true'))).toBe(true)
    await expect(card.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled()
  })
  await probe('pending.html', () => card.evaluate(element => element.outerHTML))
})

When('the pending question is answered {string}', async ({ page }: { page: Page }, option: string) => {
  const card = questionCard(page)
  await card.getByRole('radio', { name: option, exact: true }).click()
  await expect(card.getByRole('radio', { name: option, exact: true })).toHaveAttribute('aria-checked', 'true')
  await card.getByRole('button', { name: 'Submit', exact: true }).click()
})

Then('the Agent receives the late answer {string} as a user-question reply', async ({ page }: { page: Page }, option: string) => {
  const fake = fakeCommandCodeFor(page)
  const reply = () =>
    fake.requests
      .flatMap(request => request.messages)
      .find(message => message.role === 'user' && message.text.includes('answer_to_pending_question') && message.text.includes(option))
  await recordAssertion(page, 'agent-questions-root-timed-late-answer', async () => {
    await expect.poll(() => reply() !== undefined, { timeout: 30_000 }).toBe(true)
    expect(reply()?.text).toContain('call_0_ask_user_question')
  })
  await probe('requests.json', async () => JSON.stringify(fake.requests, null, 2))
  await finishJourneyAssertions(page)
})

When('the turn is stopped while the question counts down', async ({ page }: { page: Page }) => {
  await expect(questionCard(page).getByRole('radio', { name: 'Staging', exact: true })).toBeVisible()
  await expect(countdown(page)).toBeVisible()
  // The open card takes the composer's place; closing its panel brings back the composer and its Stop control.
  await questionCard(page).getByRole('button', { name: 'Close the panel — reopen it from the tool call', exact: true }).click()
  await page.getByLabel('Stop generating', { exact: true }).click()
})

Then('the question card is no longer answerable', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'agent-questions-root-timed-cancelled', async () => {
    await expect(page.getByRole('status').filter({ hasText: /^(Stopped|Cancelled)$/u })).toHaveCount(1, { timeout: 30_000 })
    // The tool row stops offering to reopen the form, and no card is left to submit.
    await expect(page.getByRole('button', { name: 'Answer', exact: true })).toHaveCount(0, { timeout: 10_000 })
    await expect(questionCard(page).getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0)
  })
  await probe('cancelled.html', () => page.locator('[data-conversation-content]').first().evaluate(element => element.outerHTML))
  await finishJourneyAssertions(page)
})

When('the scratch Host restarts and the thread is reopened', async ({ page }: { page: Page }) => {
  await restartScratchProfileInBrowser(page)
  const thread = page.getByRole('treeitem', { name: THREAD_TITLE }).or(page.getByRole('button', { name: THREAD_TITLE })).first()
  await expect(thread).toBeVisible({ timeout: 30_000 })
  await thread.click()
})

Then('the pending question card survives the restart', async ({ page }: { page: Page }) => {
  await probe('restarted.html', () => page.locator('[data-conversation-content]').first().evaluate(element => element.outerHTML))
  await recordAssertion(page, 'agent-questions-root-timed-restart', async () => {
    await expect(questionCard(page)).toBeVisible({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})
