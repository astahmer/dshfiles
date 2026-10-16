import { expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

/**
 * Trusted actions live only in the profile row, never in a settings form, so a journey writes them to the scratch
 * profile's cordis.patch.yml the way an operator would; the Host reloads the row live.
 */
interface ChecksFixture {
  readonly root: string
  readonly trustedRoot: string
  readonly project: string
  readonly sibling: string
}

const fixtures = new WeakMap<Page, ChecksFixture>()

const fixtureFor = (page: Page): ChecksFixture => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) throw new Error('The project-checks fixture was not created for this scenario.')
  return fixture
}

const checksPanel = (page: Page) => page.getByRole('dialog', { name: 'Project checks', exact: true })
const receipts = (page: Page) => checksPanel(page).getByRole('region', { name: 'Recent check receipts', exact: true }).getByRole('listitem')

const openChecks = async (page: Page): Promise<void> => {
  if (await checksPanel(page).isVisible()) {
    await checksPanel(page).getByRole('button', { name: 'Refresh project checks', exact: true }).click()
    return
  }
  const composer = page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
  await composer.pressSequentially('/project-checks')
  await expect(page.getByRole('option', { name: /^Project checks/ })).toBeVisible()
  await composer.press('Enter')
  await expect(checksPanel(page)).toBeVisible()
}

const trustActions = async (
  page: Page,
  actions: readonly {
    readonly id: string
    readonly label: string
    readonly script: string
    readonly verify: boolean
    readonly timeoutMs?: number
  }[],
): Promise<void> => {
  const profile = profileFor(page)
  const patch = join(profile.homeRoot, 'profiles', profile.profile, 'cordis.patch.yml')
  const configuredActions = actions
    .map(action =>
      [
        `      - id: ${JSON.stringify(action.id)}`,
        `        label: ${JSON.stringify(action.label)}`,
        '        command: /bin/sh',
        `        args: ['-c', ${JSON.stringify(action.script)}]`,
        `        root: ${JSON.stringify(fixtureFor(page).trustedRoot)}`,
        ...(action.timeoutMs === undefined ? [] : [`        timeoutMs: ${String(action.timeoutMs)}`]),
        `        verifyBeforeComplete: ${String(action.verify)}`,
      ].join('\n'),
    )
    .join('\n')
  await appendFile(
    patch,
    [
      '- id: dshfiles-project-checks',
      "  name: '@dshfiles/project-checks'",
      '  config:',
      '    actions:',
      configuredActions,
      '',
    ].join('\n'),
  )
}

const trustAction = async (
  page: Page,
  action: { readonly id: string; readonly label: string; readonly script: string; readonly verify: boolean },
): Promise<void> => trustActions(page, [action])

When('a trusted root holds a jj project and a sibling folder sits outside it', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-project-checks-e2e-')
  const fixture = { root, trustedRoot: join(root, 'trusted'), project: join(root, 'trusted', 'checked-project'), sibling: join(root, 'trusted-sibling') }
  fixtures.set(page, fixture)
  await mkdir(fixture.project, { recursive: true })
  await mkdir(fixture.sibling)
  await writeFile(join(fixture.project, 'README.md'), 'checked\n')
  const init = spawnSync('jj', ['git', 'init', '--no-colocate'], { cwd: fixture.project, env: { PATH: process.env.PATH ?? '', HOME: root }, encoding: 'utf8' })
  if (init.status !== 0) throw new Error(`jj init failed: ${init.stderr}`)
})

When('the profile trusts the action {string} that runs {string}', async ({ page }: { page: Page }, label: string, script: string) => {
  await trustAction(page, { id: 'manual-check', label, script, verify: false })
})

When('the profile trusts the completion check {string} that runs {string}', async ({ page }: { page: Page }, label: string, script: string) => {
  await trustAction(page, { id: 'completion-check', label, script, verify: true })
})

When('the profile trusts the Activity Timeline manual evidence actions', async ({ page }: { page: Page }) => {
  await trustActions(page, [
    { id: 'manual-pass', label: 'Manual pass', script: 'printf PRIVATE_EVIDENCE_SENTINEL', verify: false },
    { id: 'manual-failure', label: 'Manual failure', script: 'exit 7', verify: false },
    { id: 'manual-timeout', label: 'Manual timeout', script: 'sleep 3', verify: false, timeoutMs: 1_000 },
  ])
})

When('a thread is started in the {string} folder', async ({ page }: { page: Page }, which: string) => {
  const fixture = fixtureFor(page)
  const prompt = `project checks in the ${which} folder`
  await registerWorkspaceFolder(page, which === 'sibling' ? fixture.sibling : fixture.project)
  const composer = page
    .getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
    .or(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true }))
  await composer.fill(prompt)
  await composer.press('Enter')
  const sessionRow = page.getByRole('treeitem', { name: new RegExp(`project checks in the ${which}`) })
  const workspaceName = which === 'sibling' ? 'trusted-sibling' : 'checked-project'
  const blankSessionRow = page.getByRole('treeitem', { name: workspaceName, exact: true }).getByRole('treeitem', { name: 'New Session', exact: true })
  await expect(sessionRow.or(blankSessionRow)).toBeVisible({ timeout: 60_000 })
  if ((await sessionRow.count()) > 0) {
    await sessionRow.click()
    await expect(sessionRow).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('status').filter({ hasText: /^(Completed|Failed|Stopped|Cancelled)$/ }).last()).toBeVisible({ timeout: 60_000 })
  } else {
    await blankSessionRow.click()
    await expect(blankSessionRow).toHaveAttribute('aria-selected', 'true')
  }
  await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Add an API key to get started', exact: true })).toBeHidden()
})

When('a thread on the fake model is started in the trusted project', async ({ page }: { page: Page }) => {
  await registerWorkspaceFolder(page, fixtureFor(page).project)
  await startThreadWithModel(page, { project: 'checked-project', model: 'commandcode_work/gpt-6-luna' })
})

When('{string} is sent to the fake model', async ({ page }: { page: Page }, text: string) => {
  await sendMessage(page, text)
})

When('the fake model is sent a message while the completion check runs and the turn is cancelled', async ({ page }: { page: Page }) => {
  const markerPath = join(fixtureFor(page).project, '.verification-started')
  const composer = page
    .getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
    .or(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true }))
  await composer.fill('finish the task')
  await composer.press('Enter')
  await recordAssertion(page, 'project-checks-cancel-aborts-running-verification', async () => {
    await expect.poll(() => readFile(markerPath, 'utf8').catch(() => ''), { timeout: 30_000 }).toBe('started')
    const stop = page.getByRole('button', { name: /^Stop/ }).first()
    await expect(stop).toBeVisible({ timeout: 30_000 })
    await stop.click()
    await expect(page.getByRole('status').filter({ hasText: /^(Stopped|Cancelled|Interrupted)$/ }).last()).toBeVisible({ timeout: 30_000 })
  })
})

When('the project checks panel is opened', async ({ page }: { page: Page }) => {
  await openChecks(page)
})

When('{string} is run from the panel', async ({ page }: { page: Page }, label: string) => {
  await openChecks(page)
  const action = checksPanel(page).getByRole('region', { name: 'Actions', exact: true }).getByRole('listitem').filter({ hasText: label })
  // The Host reloads the profile row a moment after the patch file changes.
  await expect(async () => {
    await checksPanel(page).getByRole('button', { name: 'Refresh project checks', exact: true }).click()
    await expect(action).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await action.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(action.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
})

When('the project working copy changes', async ({ page }: { page: Page }) => {
  await writeFile(join(fixtureFor(page).project, 'README.md'), 'changed after the check\n')
})

Then('the action ran in the trusted project and left a passed receipt', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'project-checks-trusted-action-runs', async () => {
    await expect(receipts(page)).toHaveCount(1)
    await expect(receipts(page).first()).toContainText('passed')
    await expect(receipts(page).first()).toContainText('exit 0')
  })
})

Then('the receipt is available without Activity Timeline', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'verification-evidence-project-checks-works-without-timeline', async () => {
    expect(profileFor(page).expectedClientEntries).not.toContain('@dshfiles/activity-timeline')
    await expect(receipts(page)).toHaveCount(1)
    await expect(receipts(page).first()).toContainText('Manual pass')
    await expect(receipts(page).first()).toContainText('passed')
  })
  await finishJourneyAssertions(page)
})

Then('the sibling folder offers no trusted action', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'project-checks-sibling-outside-the-root-is-refused', async () => {
    await expect(checksPanel(page).getByText('No trusted actions are configured for this session directory.', { exact: true })).toBeVisible()
    await expect(checksPanel(page).getByRole('button', { name: 'Run', exact: true })).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the receipt names the working copy it checked', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'project-checks-receipt-records-the-revision', () => expect(receipts(page).first()).toContainText(/Working copy [0-9a-f]{12}/))
})

Then('the receipt is marked stale', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'project-checks-receipt-turns-stale', async () => {
    await expect(async () => {
      await checksPanel(page).getByRole('button', { name: 'Refresh project checks', exact: true }).click()
      await expect(receipts(page).first()).toContainText('Stale: working copy changed after this check.', { timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

Then('the failing check asks the agent to fix it once, then stops the turn', async ({ page }: { page: Page }) => {
  const feedback = 'Project checks failed (Completion check'
  await recordAssertion(page, 'project-checks-failed-verification-steers-the-agent', async () => {
    await expect
      .poll(() =>
        fakeCommandCodeFor(page)
          .requests.filter(request => request.kind === 'turn')
          .some(request => request.messages.some(message => message.text.includes(feedback) && message.text.includes('Attempt 1 of 2'))),
      )
      .toBe(true)
  })
  await openChecks(page)
  await recordAssertion(page, 'project-checks-verification-stops-at-the-attempt-limit', async () => {
    await expect(async () => {
      await checksPanel(page).getByRole('button', { name: 'Refresh project checks', exact: true }).click()
      await expect(receipts(page)).toHaveCount(2, { timeout: 2_000 })
    }).toPass({ timeout: 60_000 })
    for (const receipt of await receipts(page).all()) await expect(receipt).toContainText('failed')
    expect(
      fakeCommandCodeFor(page)
        .requests.filter(request => request.kind === 'turn')
        .some(request => request.messages.some(message => message.text.includes('Attempt 2 of 2'))),
    ).toBe(false)
  })
})

Then('the cancelled check remains available in Project Checks', async ({ page }: { page: Page }) => {
  await openChecks(page)
  await recordAssertion(page, 'project-checks-cancellation-persists-a-cancelled-receipt', async () => {
    await expect(async () => {
      await checksPanel(page).getByRole('button', { name: 'Refresh project checks', exact: true }).click()
      await expect(receipts(page)).toHaveCount(1, { timeout: 2_000 })
      await expect(receipts(page).first()).toContainText('cancelled')
    }).toPass({ timeout: 30_000 })
    await expect(receipts(page).first()).not.toContainText('failed')
  })
})

After(async ({ page }: { page: Page }) => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) return
  fixtures.delete(page)
  await rm(fixture.root, { recursive: true, force: true })
})
