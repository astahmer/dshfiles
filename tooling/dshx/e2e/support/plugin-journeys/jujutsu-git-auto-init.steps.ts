import { expect, type Page, type TestInfo } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { browserDiagnosticsFor, finishJourneyAssertions, recordAssertion, reloadPastProviderSetup } from '../steps.js'
import { createScratchDirectory } from '../threads.js'

interface GitSnapshot {
  readonly head: string
  readonly symbolicHead: string
  readonly headFile: Buffer
  readonly refs: string
  readonly tracked: Buffer
  readonly untracked: Buffer
}

interface GitOnlyFixture {
  readonly root: string
  readonly path: string
  readonly before: GitSnapshot
}

const fixtures = new WeakMap<Page, GitOnlyFixture>()
const commitDescription = 'Git-only checkout imported without losing dirty bytes'
const trackedPath = 'tracked.txt'
const untrackedPath = 'untracked.bin'

const command = (root: string, cwd: string, executable: string, args: readonly string[]): string => {
  const result = spawnSync(executable, args, {
    cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: root,
      XDG_CONFIG_HOME: join(root, '.config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
    },
    encoding: 'utf8',
    shell: false,
    timeout: 20_000,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`Git auto-init fixture command failed (${String(result.status)}): ${result.stderr}`)
  return result.stdout
}

const git = (fixture: { readonly root: string; readonly path: string }, args: readonly string[]): string =>
  command(fixture.root, fixture.path, 'git', ['--no-pager', ...args])

const snapshotGit = async (fixture: { readonly root: string; readonly path: string }): Promise<GitSnapshot> => ({
  head: git(fixture, ['rev-parse', 'HEAD']),
  symbolicHead: git(fixture, ['symbolic-ref', 'HEAD']),
  headFile: await readFile(join(fixture.path, '.git', 'HEAD')),
  // JJ may add refs/jj/keep GC roots; user branches, tags and remote-tracking refs must stay identical.
  refs: git(fixture, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags', 'refs/remotes']),
  tracked: await readFile(join(fixture.path, trackedPath)),
  untracked: await readFile(join(fixture.path, untrackedPath)),
})

const fixtureFor = (page: Page): GitOnlyFixture => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) throw new Error('The disposable Git-only checkout was not created for this scenario.')
  return fixture
}

// This read must not snapshot the dirty working copy or append its own operation.
const operationLog = (fixture: GitOnlyFixture): string =>
  command(fixture.root, fixture.path, process.env.JJ_TEST_EXECUTABLE ?? 'jj', [
    '--ignore-working-copy',
    '--color=never',
    '--no-pager',
    'op',
    'log',
    '--no-graph',
    '-T',
    'id ++ "\\n"',
  ])

const importedCommitRow = (page: Page) =>
  page.getByRole('region', { name: 'Revisions', exact: true }).first().locator('article').filter({ hasText: commitDescription })

const chooseGitCheckout = async (page: Page, fixture: GitOnlyFixture): Promise<void> => {
  await page.getByRole('button', { name: 'Choose repository', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a Jujutsu repository', exact: true })
  const pathInput = picker.getByRole('textbox', { name: 'Search projects or enter a folder path', exact: true })
  // The first home-directory listing may rewrite the input; wait for the requested listing before selecting.
  await expect(async () => {
    await pathInput.fill(fixture.path)
    await pathInput.press('Enter')
    await expect(picker.locator('p').filter({ hasText: fixture.path }).first()).toHaveText(fixture.path, { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await picker.getByRole('button', { name: 'Select this folder', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(importedCommitRow(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
}

When('a disposable dirty Git-only checkout is opened through the Jujutsu repository picker', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-jujutsu-git-auto-init-')
  const repository = { root, path: join(root, 'git-only checkout') }
  try {
    await mkdir(repository.path)
    git(repository, ['init', '--initial-branch=main'])
    git(repository, ['config', 'user.name', 'Git auto-init E2E'])
    git(repository, ['config', 'user.email', 'git-auto-init@example.invalid'])
    await writeFile(join(repository.path, trackedPath), 'committed contents\n')
    git(repository, ['add', trackedPath])
    git(repository, ['commit', '-m', commitDescription])
    git(repository, ['branch', 'preserve-branch'])
    git(repository, ['tag', 'preserve-tag'])
    git(repository, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    await writeFile(join(repository.path, trackedPath), 'staged contents\r\n')
    git(repository, ['add', trackedPath])
    await writeFile(join(repository.path, trackedPath), Buffer.from('dirty tracked contents\r\nwith a nul: \0 and unicode: café\n'))
    await writeFile(join(repository.path, untrackedPath), Buffer.from([0, 255, 13, 10, 128, 65, 0]))
    expect(git(repository, ['status', '--porcelain=v1'])).toContain(`MM ${trackedPath}`)
    expect(git(repository, ['ls-files', '--others', '--exclude-standard'])).toBe(`${untrackedPath}\n`)
    expect(existsSync(join(repository.path, '.jj'))).toBe(false)
    fixtures.set(page, { ...repository, before: await snapshotGit(repository) })
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
  await openGlobalPanel(page, 'Jujutsu: Revision graph')
  await chooseGitCheckout(page, fixtureFor(page))
})

Then('the imported Git commit is visible and JJ metadata exists without changing Git history or dirty file bytes', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  await recordAssertion(page, 'jujutsu-git-auto-init-imports-the-commit', async () => {
    await expect(importedCommitRow(page)).toBeVisible()
    expect(existsSync(join(fixture.path, '.jj', 'repo'))).toBe(true)
  })
  await recordAssertion(page, 'jujutsu-git-auto-init-preserves-git-and-dirty-bytes', async () => {
    // JJ graph reads snapshot the working copy, so Git index staging is not a stable post-graph invariant.
    expect(await snapshotGit(fixture)).toEqual(fixture.before)
  })
})

Then('reselecting and reopening the Git checkout does not initialize JJ again', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  const fixture = fixtureFor(page)
  const beforeReopen = operationLog(fixture)
  expect(beforeReopen.trim().length).toBeGreaterThan(0)
  await chooseGitCheckout(page, fixture)
  await recordAssertion(page, 'jujutsu-git-auto-init-reselection-is-idempotent', async () => {
    expect(operationLog(fixture)).toBe(beforeReopen)
    expect(await snapshotGit(fixture)).toEqual(fixture.before)
  })
  await reloadPastProviderSetup(page)
  await openGlobalPanel(page, 'Jujutsu: Revision graph')
  await expect(importedCommitRow(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  await recordAssertion(page, 'jujutsu-git-auto-init-reopen-is-idempotent', async () => {
    expect(operationLog(fixture)).toBe(beforeReopen)
    expect(await snapshotGit(fixture)).toEqual(fixture.before)
  })
  // Keep every diagnostic, including optional-API 404s and navigation cancellations, visible in passing evidence.
  const browserEvents = browserDiagnosticsFor(page)
  await $testInfo.attach('jujutsu-git-auto-init-browser-diagnostics.json', {
    body: JSON.stringify({ events: browserEvents }, null, 2),
    contentType: 'application/json',
  })
  await recordAssertion(page, 'jujutsu-git-auto-init-has-no-render-failure', async () => {
    expect(browserEvents.filter(event => event.startsWith('pageerror:'))).toEqual([])
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(importedCommitRow(page)).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) return
  fixtures.delete(page)
  await rm(fixture.root, { recursive: true, force: true })
})
