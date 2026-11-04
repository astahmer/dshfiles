import { execFileSync } from 'node:child_process'
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { registerScratchWorkspace } from '../../../packages/dshx/src/project/scratch-workspace.js'
import { Given, Then, When } from '../bdd.js'
import { bootComposedPluginProfile, type BootedProfile } from '../boot.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { sendMessage } from '../threads.js'

const PULL_REQUEST_URL = 'https://github.com/acme/widget/pull/7'
const COMMIT_SUMMARY = 'feat(widget): add sprockets'

/** A stand-in for the GitHub CLI: it answers what the create flow and the watcher ask, and logs every argv. */
const fakeGh = (log: string): string => `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") echo '{"nameWithOwner":"acme/widget","defaultBranchRef":{"name":"main"}}' ;;
  "pr list") echo '[]' ;;
  "pr create") echo '${PULL_REQUEST_URL}' ;;
  "pr view") echo '{"state":"OPEN","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":null,"statusCheckRollup":[{"name":"unit","status":"COMPLETED","conclusion":"SUCCESS"}],"comments":[],"reviews":[]}' ;;
  *) echo "stub gh: unexpected $*" >&2; exit 2 ;;
esac
`

interface PullRequestFixture {
  readonly project: string
  readonly remote: string
  readonly ghLog: string
}

const fixtures = new WeakMap<Page, PullRequestFixture>()
const fixtureOf = (page: Page): PullRequestFixture => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) throw new Error('Boot the pull-requests composition first.')
  return fixture
}

const paths = (homeRoot: string): PullRequestFixture => ({
  project: join(homeRoot, 'pr-project'),
  remote: join(homeRoot, 'pr-remote.git'),
  ghLog: join(homeRoot, 'pr-gh.log'),
})

/** A jj repository whose `main` is pushed to a bare remote and one described commit sits above it, plus a stub gh. */
const seedPullRequestHome = async (homeRoot: string): Promise<{ readonly hostPathPrefix: string }> => {
  const fixture = paths(homeRoot)
  const bin = join(homeRoot, 'pr-bin')
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'gh'), fakeGh(fixture.ghLog))
  await chmod(join(bin, 'gh'), 0o755)
  await writeFile(join(homeRoot, 'pr-jj-config.toml'), '[user]\nname = "DSH E2E"\nemail = "dsh-e2e@example.invalid"\n')
  const env = { ...process.env, HOME: homeRoot, JJ_CONFIG: join(homeRoot, 'pr-jj-config.toml') }
  const jj = (args: readonly string[], cwd: string): void => {
    execFileSync('jj', ['--color=never', ...args], { cwd, env, stdio: 'pipe' })
  }
  execFileSync('git', ['init', '--quiet', '--bare', fixture.remote], { env })
  jj(['git', 'init', 'pr-project'], homeRoot)
  jj(['git', 'remote', 'add', 'origin', fixture.remote], fixture.project)
  await writeFile(join(fixture.project, 'README.md'), '# widget\n')
  jj(['describe', '-m', 'chore: init'], fixture.project)
  jj(['bookmark', 'set', 'main', '-r', '@'], fixture.project)
  // Pushing the working-copy commit makes jj start a new, empty one on top of it.
  jj(['git', 'push', '--bookmark', 'main'], fixture.project)
  await writeFile(join(fixture.project, 'sprockets.txt'), 'sprockets\n')
  jj(['describe', '-m', COMMIT_SUMMARY], fixture.project)
  jj(['new'], fixture.project)
  await registerScratchWorkspace(homeRoot, await realpath(fixture.project))
  return { hostPathPrefix: bin }
}

const dialog = (page: Page) => page.getByTestId('dshfiles-pull-request-create-dialog')

Given('the pull-requests composition with a jj repository and a stub gh is booted', async ({ page }: { page: Page }) => {
  const profile: BootedProfile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/pull-requests', '@dshfiles/command-palette'],
    profileLabel: 'pull-requests-create',
    seedHome: seedPullRequestHome,
    seedKey: 'pull-requests-create-v1',
  })
  fixtures.set(page, paths(profile.homeRoot))
  await visitIsolatedPluginProfile(page, profile)
})

Given('a thread is started in the pull-request project', async ({ page }: { page: Page }) => {
  await expect(page.getByRole('button', { name: 'Choose workspace', exact: true })).toHaveText('pr-project')
  // No model provider is configured: the turn fails at once, which still creates the thread in the project.
  await sendMessage(page, 'Add sprockets to the widget')
})

When('{string} is run from the command palette', async ({ page }: { page: Page }, label: string) => {
  await page.keyboard.press('Meta+Shift+P')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('pull request')
  await palette.getByRole('option', { name: new RegExp(`^${label}`) }).click()
})

Then('the pull-request dialog previews the commit above main with a drafted title', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'pull-requests-create-preview', async () => {
    await expect(dialog(page)).toBeVisible()
    const summary = dialog(page).getByTestId('dshfiles-pull-request-create-summary')
    await expect(summary).toContainText('acme/widget', { timeout: 30_000 })
    await expect(summary).toContainText('→ main')
    await expect(summary).toContainText(COMMIT_SUMMARY)
    await expect(dialog(page).getByTestId('dshfiles-pull-request-create-problems')).toHaveCount(0)
    // No model in this composition: the draft falls back to the commit message and says so.
    await expect(dialog(page).getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(COMMIT_SUMMARY)
    await expect(dialog(page).getByTestId('dshfiles-pull-request-create-generation')).toContainText('Drafted from the commit messages')
    expect(execFileSync('git', ['--git-dir', fixtureOf(page).remote, 'branch', '--list']).toString()).not.toContain('dsh/')
  })
})

When('the pull request is pushed and created from the dialog', async ({ page }: { page: Page }) => {
  await dialog(page).getByRole('textbox', { name: 'Title', exact: true }).fill('Add sprockets to the widget')
  await dialog(page).getByTestId('dshfiles-pull-request-create-confirm').click()
})

Then('the dialog shows the opened pull request linked to the thread', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'pull-requests-create-linked', async () => {
    const result = dialog(page).getByTestId('dshfiles-pull-request-create-result')
    await expect(result).toContainText(`Opened ${PULL_REQUEST_URL}`, { timeout: 60_000 })
    await expect(result).toContainText('Linked to this thread and watched for CI, reviews and merges.')
    await expect(result.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', PULL_REQUEST_URL)
  })
})

Then('the bookmark is on the remote and the stub gh created and polled the pull request', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'pull-requests-create-pushed-and-watched', async () => {
    const fixture = fixtureOf(page)
    const branches = execFileSync('git', ['--git-dir', fixture.remote, 'branch', '--list', '--format=%(refname:short)']).toString()
    expect(branches).toMatch(/^dsh\//mu)
    const calls = (await readFile(fixture.ghLog, 'utf8')).split('\n')
    expect(calls.some(call => call.startsWith('pr create --repo acme/widget --head dsh/') && call.includes('--title Add sprockets to the widget'))).toBe(true)
    // Watching polls once at link time, so the stored link already holds the OPEN state from gh pr view.
    expect(calls.some(call => call.startsWith('pr view 7 --repo acme/widget'))).toBe(true)
  })
  await finishJourneyAssertions(page)
})
