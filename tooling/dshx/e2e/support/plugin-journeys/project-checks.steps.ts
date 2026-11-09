import { expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Given, Then, When } from '../bdd.js'
import { bootComposedPluginProfile } from '../boot.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, profileFor, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

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

/** One trusted action a journey configures before the Host boots, in the profile row's own shape. */
interface TrustedAction {
  readonly id: string
  readonly label: string
  readonly script: string
  readonly verify?: boolean
  readonly timeoutMs?: number
  readonly setup?: 'await-first-turn'
}

/**
 * Trusted actions live only in the profile row, never in a settings form. The composition already activates
 * `@dshfiles/project-checks`, so a second row for the same id is fatal (`PluginInactive`): the actions ride the boot
 * patch instead, where an id-only entry merges into that row's config.
 */
const checksPatch = (input: { readonly trustedRoot: string; readonly actions: readonly TrustedAction[] }): string => {
  const rows = input.actions
    .map(action =>
      [
        `      - id: ${JSON.stringify(action.id)}`,
        `        label: ${JSON.stringify(action.label)}`,
        '        command: /bin/sh',
        `        args: ['-c', ${JSON.stringify(action.script)}]`,
        `        root: ${JSON.stringify(input.trustedRoot)}`,
        ...(action.timeoutMs === undefined ? [] : [`        timeoutMs: ${String(action.timeoutMs)}`]),
        `        verifyBeforeComplete: ${String(action.verify ?? false)}`,
        ...(action.setup === undefined
          ? []
          : [`        runOnWorkspaceCreate: true`, ...(action.setup === 'await-first-turn' ? [`        awaitBeforeFirstTurn: true`] : [])]),
      ].join('\n'),
    )
    .join('\n')
  return `- id: dshfiles-project-checks\n  config:\n    actions:\n${rows}\n`
}

/** A scratch tree with one trusted root holding a jj project, and a sibling folder outside it. */
const createFixture = async (): Promise<ChecksFixture> => {
  const root = await createScratchDirectory('dshx-project-checks-e2e-')
  const fixture = { root, trustedRoot: join(root, 'trusted'), project: join(root, 'trusted', 'checked-project'), sibling: join(root, 'trusted-sibling') }
  await mkdir(fixture.project, { recursive: true })
  await mkdir(fixture.sibling)
  await writeFile(join(fixture.project, 'README.md'), 'checked\n')
  const jj = (...args: readonly string[]) =>
    spawnSync('jj', args, {
      cwd: fixture.project,
      env: { PATH: process.env.PATH ?? '', HOME: root, JJ_USER: 'Project Checks E2E', JJ_EMAIL: 'project-checks@example.invalid' },
      encoding: 'utf8',
    })
  const init = jj('git', 'init', '--no-colocate')
  if (init.status !== 0) throw new Error(`jj init failed: ${init.stderr}`)
  // A first revision and the `main` bookmark: an isolated thread workspace starts from a bookmark, and a receipt names
  // the working copy it checked.
  const described = jj('describe', '-m', 'e2e fixture')
  if (described.status !== 0) throw new Error(`jj describe failed: ${described.stderr}`)
  const bookmarked = jj('bookmark', 'create', 'main', '-r', '@')
  if (bookmarked.status !== 0) throw new Error(`jj bookmark failed: ${bookmarked.stderr}`)
  return fixture
}

/** Boot the named composition with these trusted actions already written into the profile row. */
const bootTrusting = async (input: {
  readonly page: Page
  readonly packageList: string
  readonly actions: readonly TrustedAction[]
  readonly label: string
}) => {
  const fixture = await createFixture()
  fixtures.set(input.page, fixture)
  const [packageId, ...companionPackageIds] = input.packageList.split(',').map(listed => listed.trim())
  if (packageId === undefined || packageId === '') throw new Error('The plugin composition names no package.')
  const profile = await bootComposedPluginProfile({
    packageIds: [packageId, ...companionPackageIds],
    profileLabel: `${input.packageList}-${input.label}`,
    cordisPatch: checksPatch({ trustedRoot: fixture.trustedRoot, actions: input.actions }),
  })
  await visitIsolatedPluginProfile(input.page, profile)
}

Given(
  'the isolated plugin composition of {string} is booted with the trusted action {string} that runs {string}',
  async ({ page }: { page: Page }, packageList: string, label: string, script: string) => {
    await bootTrusting({ page, packageList, label: 'checks-manual', actions: [{ id: 'manual-check', label, script }] })
  },
)

Given(
  'the isolated plugin composition of {string} is booted with the trusted completion check {string} that runs {string}',
  async ({ page }: { page: Page }, packageList: string, label: string, script: string) => {
    await bootTrusting({ page, packageList, label: 'checks-completion', actions: [{ id: 'completion-check', label, script, verify: true }] })
  },
)

Given(
  'the isolated plugin composition of {string} is booted with the trusted setup action {string} that runs {string}',
  async ({ page }: { page: Page }, packageList: string, label: string, script: string) => {
    await bootTrusting({ page, packageList, label: 'checks-setup', actions: [{ id: 'setup-check', label, script, setup: 'await-first-turn' }] })
  },
)

Given(
  'the isolated plugin composition of {string} is booted with the Activity Timeline manual evidence actions',
  async ({ page }: { page: Page }, packageList: string) => {
    await bootTrusting({
      page,
      packageList,
      label: 'checks-evidence',
      actions: [
        { id: 'manual-pass', label: 'Manual pass', script: 'printf PRIVATE_EVIDENCE_SENTINEL' },
        { id: 'manual-failure', label: 'Manual failure', script: 'exit 7' },
        { id: 'manual-timeout', label: 'Manual timeout', script: 'sleep 3', timeoutMs: 1_000 },
      ],
    })
  },
)

When('a thread is started in the {string} folder', async ({ page }: { page: Page }, which: string) => {
  const fixture = fixtureFor(page)
  // The checks panel is a modal: a scenario that ran a check first must leave it before adding a workspace.
  if (await checksPanel(page).isVisible()) {
    await checksPanel(page).getByRole('button', { name: 'Close project checks', exact: true }).click()
    await expect(checksPanel(page)).toBeHidden()
  }
  const prompt = `project checks in the ${which} folder`
  await registerWorkspaceFolder(page, which === 'sibling' ? fixture.sibling : fixture.project)
  const composer = page
    .getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
    .or(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true }))
  await composer.fill(prompt)
  await composer.press('Enter')
  const sessionRow = page.getByRole('treeitem', { name: new RegExp(`project checks in the ${which}`) })
  await expect(sessionRow).toBeVisible({ timeout: 60_000 })
  await sessionRow.click()
  await expect(sessionRow).toHaveAttribute('aria-selected', 'true')
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /^(Completed|Failed|Stopped|Cancelled)$/ })
      .last(),
  ).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /^(?:Add an API key to get started|Get started)$/ })).toBeHidden()
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
    await expect.poll(() => readFile(markerPath, 'utf8').catch(() => ''), { timeout: 90_000 }).toBe('started')
    const stop = page.getByRole('button', { name: /^Stop/ }).first()
    await expect(stop).toBeVisible({ timeout: 30_000 })
    await stop.click()
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /^(Stopped|Cancelled|Interrupted)$/ })
        .last(),
    ).toBeVisible({ timeout: 30_000 })
  })
})

When('the project checks panel is opened', async ({ page }: { page: Page }) => {
  await openChecks(page)
})

When('{string} is run from the panel', async ({ page }: { page: Page }, label: string) => {
  await openChecks(page)
  const action = checksPanel(page).getByRole('region', { name: 'Actions', exact: true }).getByRole('listitem').filter({ hasText: label })
  await expect(async () => {
    await checksPanel(page).getByRole('button', { name: 'Refresh project checks', exact: true }).click()
    await expect(action).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
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

When('the New thread workspace is set to its own workspace', async ({ page }: { page: Page }) => {
  const segment = page.locator('[data-run-segment="workspace"]').first()
  await expect(segment).toBeVisible({ timeout: 30_000 })
  await segment.click()
  await page
    .getByRole('option', { name: /Own workspace/u })
    .first()
    .click()
  await expect(segment).toContainText('Own workspace')
})

When('the {string} folder is added as the New thread project', async ({ page }: { page: Page }, which: string) => {
  const fixture = fixtureFor(page)
  await registerWorkspaceFolder(page, which === 'sibling' ? fixture.sibling : fixture.project)
})

When('a message is sent while its workspace setup runs', async ({ page }: { page: Page }) => {
  const composer = page
    .getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
    .or(page.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true }))
  await composer.fill('project checks setup in the project folder')
  await composer.press('Enter')
  await recordAssertion(page, 'project-checks-setup-phase-is-visible-in-the-composer', async () => {
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /Setting up · Setup install/u })
        .first(),
    ).toBeVisible({ timeout: 60_000 })
  })
})

Then('the setup ran once in the thread workspace, not the project checkout', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const threadsDirectory = `${fixture.project}-threads`
  await recordAssertion(page, 'project-checks-setup-runs-in-the-thread-workspace', async () => {
    await expect
      .poll(
        async () => {
          const folders = await readdir(threadsDirectory).catch(() => [] as string[])
          for (const folder of folders) {
            const content = await readFile(join(threadsDirectory, folder, '.setup-ran'), 'utf8').catch(() => undefined)
            if (content !== undefined) return folder
          }
          return undefined
        },
        { timeout: 90_000 },
      )
      .toBeDefined()
    // A prepared or spare workspace may also exist; what matters is that the setup ran once, in a workspace.
    const markers = await Promise.all(
      (await readdir(threadsDirectory).catch(() => [] as string[])).map(folder =>
        readFile(join(threadsDirectory, folder, '.setup-ran'), 'utf8').catch(() => undefined),
      ),
    )
    expect(markers.filter(marker => marker !== undefined)).toHaveLength(1)
    expect(await readFile(join(fixture.project, '.setup-ran'), 'utf8').catch(() => undefined)).toBeUndefined()
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) return
  fixtures.delete(page)
  await rm(fixture.root, { recursive: true, force: true })
})
