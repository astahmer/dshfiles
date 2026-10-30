import { expect, type Page } from '@playwright/test'
import { openGlobalPanel } from '../plugin-view-names.js'
import { spawnSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { FAKE_COMMAND_CODE_MODEL } from '../../../packages/dshx/src/scratch/fake-command-code.js'
import { After, Then, When } from '../bdd.js'
import { fakeCommandCodeFor } from '../fake-command-code.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

interface Repository {
  readonly root: string
  readonly path: string
}

interface ForeignRepository extends Repository {
  readonly bookmark: string
  readonly description: string
}

const repositories = new WeakMap<Page, Repository>()
const foreignRepositories = new WeakMap<Page, ForeignRepository>()
const UNICODE_PATH = 'dir with space/ünïcode file.txt'
const SHORT_REFERENCE_TITLE = 'Jujutsu reference chips size to title'
const LONG_REFERENCE_TITLE = 'Jujutsu reference chips size to their own title length'

const jj = (
  repository: Repository,
  args: readonly string[],
  author: { readonly name: string; readonly email: string; readonly timestamp?: string } = { name: 'Ada Author', email: 'ada@example.invalid' },
): string => {
  const result = spawnSync(process.env.JJ_TEST_EXECUTABLE ?? 'jj', ['--color=never', '--no-pager', ...args], {
    cwd: repository.path,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: repository.root,
      XDG_CONFIG_HOME: join(repository.root, '.config'),
      JJ_USER: author.name,
      JJ_EMAIL: author.email,
      ...(author.timestamp === undefined ? {} : { JJ_TIMESTAMP: author.timestamp }),
    },
    encoding: 'utf8',
    shell: false,
    timeout: 20_000,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`Disposable JJ fixture command failed (${String(result.status)}): ${result.stderr}`)
  return result.stdout
}

const repositoryFor = (page: Page): Repository => {
  const repository = repositories.get(page)
  if (repository === undefined) throw new Error('The disposable Jujutsu repository was not created for this scenario.')
  return repository
}

const foreignRepositoryFor = (page: Page): ForeignRepository => {
  const repository = foreignRepositories.get(page)
  if (repository === undefined) throw new Error('The second disposable Jujutsu repository was not created for this scenario.')
  return repository
}

const descriptions = (repository: Repository): readonly string[] =>
  jj(repository, ['--ignore-working-copy', 'log', '--no-graph', '-r', 'all()', '-T', 'description.first_line() ++ "\\n"'])
    .split('\n')
    .filter(line => line.length > 0)

const revisionsRegion = (page: Page) => page.getByRole('region', { name: 'Revisions', exact: true }).first()
const revisionRow = (page: Page, description: string) => revisionsRegion(page).locator('article').filter({ hasText: description })
const loadedRevisions = async (page: Page): Promise<number> => Number((await revisionsRegion(page).getAttribute('data-loaded-revisions')) ?? 0)

When('a disposable Jujutsu repository with two authors is opened in the Jujutsu panel', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-jujutsu-journeys-')
  const repository = { root, path: join(root, 'repo') }
  repositories.set(page, repository)
  await mkdir(repository.path)
  jj(repository, ['git', 'init', '--no-colocate'])
  await writeFile(join(repository.path, 'base.txt'), 'base\n')
  jj(repository, ['describe', '-m', 'Base fixture'])
  jj(repository, ['bookmark', 'create', 'main', '-r', '@'])
  jj(repository, ['new'])
  await mkdir(join(repository.path, 'dir with space'))
  await writeFile(join(repository.path, UNICODE_PATH), 'one\n')
  await writeFile(join(repository.path, 'feature.txt'), 'feature\n')
  jj(repository, ['describe', '-m', 'Feature work by Ada'])
  jj(repository, ['new', 'main', '-m', 'Bob side change'], { name: 'Bob Builder', email: 'bob@example.invalid' })
  await writeFile(join(repository.path, 'bob.txt'), 'bob\n')
  jj(repository, ['new'])
  await page.evaluate(path => localStorage.setItem('dshfiles.jujutsu.selected', JSON.stringify(path)), repository.path)
  await page.reload()
  await openGlobalPanel(page, 'Jujutsu: Revision graph')
  await expect(revisionRow(page, 'Feature work by Ada')).toBeVisible({ timeout: 30_000 })
})

When('two Jujutsu bookmarks have long titles', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  jj(repository, ['new', 'main', '-m', SHORT_REFERENCE_TITLE])
  jj(repository, ['bookmark', 'create', 'short-ref'])
  jj(repository, ['new', 'main', '-m', LONG_REFERENCE_TITLE])
  jj(repository, ['bookmark', 'create', 'long-ref'])
})

When('a revision {string} is committed outside DSH', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  jj(repository, ['describe', '-m', description])
  jj(repository, ['new'])
})

When('a revision {string} created in 2020 is edited outside DSH today', async ({ page }: { page: Page }, description: string) => {
  const repository = repositoryFor(page)
  jj(repository, ['new', 'main', '-m', description], { name: 'Ada Author', email: 'ada@example.invalid', timestamp: '2020-01-01T00:00:00Z' })
  await writeFile(join(repository.path, 'long-ago.txt'), 'edited today\n')
  jj(repository, ['status'])
  jj(repository, ['new'])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(revisionRow(page, description)).toBeVisible()
})

When('the Feature revision is opened', async ({ page }: { page: Page }) => {
  const files = revisionRow(page, 'Feature work by Ada').getByRole('list', { name: 'Changed files', exact: true })
  if (!(await files.isVisible())) await revisionRow(page, 'Feature work by Ada').getByRole('button', { name: 'Feature work by Ada', exact: true }).click()
  await expect(files).toBeVisible()
})

When('the Feature revision is previewed for squashing into its parent', async ({ page }: { page: Page }) => {
  await revisionRow(page, 'Feature work by Ada').getByRole('button', { name: 'Squash into parent', exact: true }).click()
  await expect(revisionRow(page, 'Feature work by Ada').getByRole('group', { name: 'Confirm squash changes', exact: true })).toBeVisible()
})

When('the squash preview is confirmed', async ({ page }: { page: Page }) => {
  await page.getByRole('group', { name: 'Confirm squash changes', exact: true }).getByRole('button', { name: 'Squash changes', exact: true }).click()
})

When('a workspace {string} is provisioned at the Feature revision under the fixture root', async ({ page }: { page: Page }, name: string) => {
  const repository = repositoryFor(page)
  await revisionRow(page, 'Feature work by Ada').getByRole('button').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New workspace here…', exact: true }).click()
  const provision = page.getByRole('group', { name: 'Create workspace at this revision', exact: true })
  await provision.getByRole('textbox', { name: 'Workspace name', exact: true }).fill(name)
  await provision.getByRole('button', { name: 'Choose parent directory', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose the parent directory', exact: true })
  const path = picker.getByRole('textbox').first()
  await expect(async () => {
    await path.fill(repository.root)
    await path.press('Enter')
    await expect(picker.locator('p').filter({ hasText: repository.root }).first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await picker.getByRole('button', { name: 'Select this folder', exact: true }).click()
  await expect(provision.getByText(repository.root, { exact: true })).toBeVisible()
  await provision.getByRole('button', { name: 'Preview workspace setup', exact: true }).click()
  await page
    .getByRole('group', { name: 'Confirm create isolated workspace', exact: true })
    .getByRole('button', { name: 'Create isolated workspace', exact: true })
    .click()
})

Then('searching, filtering by author and hiding immutable revisions narrow the graph', async ({ page }: { page: Page }) => {
  const search = page.getByRole('textbox', { name: 'Search revisions', exact: true })
  if (!(await search.isVisible())) await page.getByRole('button', { name: 'Show search', exact: true }).click()
  await search.fill('Bob side')
  await recordAssertion(page, 'jujutsu-search-filters-revisions', async () => {
    await expect(revisionRow(page, 'Bob side change')).toBeVisible()
    await expect(revisionRow(page, 'Feature work by Ada')).toHaveCount(0)
  })
  await search.fill('')
  await page.getByRole('textbox', { name: 'Filter author', exact: true }).fill('Bob')
  await recordAssertion(page, 'jujutsu-author-filter-keeps-that-author', async () => {
    await expect(revisionRow(page, 'Bob side change')).toBeVisible()
    await expect(revisionRow(page, 'Feature work by Ada')).toHaveCount(0)
    await expect(revisionRow(page, 'Base fixture')).toHaveCount(0)
  })
  await page.getByRole('textbox', { name: 'Filter author', exact: true }).fill('')
  const repository = repositoryFor(page)
  jj(repository, ['new', 'main', '-m', 'Needle hidden beyond the first page'])
  const targetRevisionId = jj(repository, ['--ignore-working-copy', 'log', '--no-graph', '-r', '@', '-T', 'change_id.short(64)']).trim()
  for (let index = 0; index < 105; index += 1) jj(repository, ['new', '@', '-m', `History filler ${index}`])
  jj(repository, ['new', '@'])
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(revisionRow(page, 'History filler 104')).toBeVisible()
  await recordAssertion(page, 'jujutsu-graph-loads-past-the-first-page-without-scrolling', async () => {
    await expect.poll(() => loadedRevisions(page)).toBeGreaterThan(100)
  })
  await search.fill('needle hidden beyond the first page')
  await expect(revisionRow(page, 'Needle hidden beyond the first page')).toBeVisible()
  await search.fill(targetRevisionId)
  await expect(revisionRow(page, 'Needle hidden beyond the first page')).toBeVisible()
  await search.fill('')
  await expect(revisionRow(page, 'Needle hidden beyond the first page')).toHaveCount(0)
  await revisionsRegion(page).evaluate(element => {
    element.scrollTop = element.scrollHeight
  })
  await expect(revisionRow(page, 'Needle hidden beyond the first page')).toBeVisible({ timeout: 10_000 })
  const rootCommitId = jj(repository, ['--ignore-working-copy', 'log', '--no-graph', '-r', 'root()', '-T', 'commit_id']).trim()
  const rootRow = revisionsRegion(page).locator(`article[data-commit-id="${rootCommitId}"]`)
  await expect(rootRow).toHaveCount(1)
  const hideImmutable = page.getByRole('checkbox', { name: 'Hide immutable', exact: true })
  await hideImmutable.click()
  await expect(hideImmutable).toBeChecked()
  await recordAssertion(page, 'jujutsu-hide-immutable-drops-the-root', async () => {
    await expect(rootRow).toHaveCount(0)
    await expect(revisionRow(page, 'Feature work by Ada')).toBeVisible()
    await revisionsRegion(page).evaluate(element => {
      element.scrollTop = 0
    })
    await expect(revisionsRegion(page).getByText('default', { exact: true })).toHaveCount(1)
  })
  await finishJourneyAssertions(page)
})

Then('its row shows the edit, the creation, or both as the Revision date setting selects', async ({ page }: { page: Page }) => {
  const age = revisionRow(page, 'Started long ago').locator('time').first()
  const chooseRevisionDate = async (label: string): Promise<void> => {
    await page.getByRole('button', { name: 'Jujutsu view settings', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Revision date', exact: true }).click()
    await page.getByRole('menuitemradio', { name: label, exact: true }).click()
    await page.keyboard.press('Escape')
  }
  await recordAssertion(page, 'jujutsu-row-age-is-the-last-content-edit', async () => {
    await expect(age).toHaveText(/^(now|\d+m)$/)
    await age.hover()
    await expect(page.getByRole('tooltip')).toHaveText(/^Created .*2020.*Last edited .*Last rewritten .*$/su)
  })
  await chooseRevisionDate('Created')
  await recordAssertion(page, 'jujutsu-row-age-can-show-the-creation', async () => {
    await expect(age).toHaveText(/^\d+y$/)
  })
  await chooseRevisionDate('Last edited and created')
  await recordAssertion(page, 'jujutsu-row-age-can-show-both', async () => {
    await expect(age).toHaveText(/^(now|\d+m) · \d+y$/)
  })
  await finishJourneyAssertions(page)
})

Then('{string} appears only after a manual refresh', async ({ page }: { page: Page }, description: string) => {
  await recordAssertion(page, 'jujutsu-outside-change-waits-for-a-refresh', () => expect(revisionRow(page, description)).toHaveCount(0))
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await recordAssertion(page, 'jujutsu-refresh-reads-the-new-revision', () => expect(revisionRow(page, description)).toBeVisible())
})

Then('{string} appears when the page becomes visible again', async ({ page }: { page: Page }, description: string) => {
  await expect(revisionRow(page, description)).toHaveCount(0)
  // A browser tab cannot be hidden from a test, so the document reports a hide and, after the panel rendered it, a return.
  const reportVisibility = (state: DocumentVisibilityState) =>
    page.evaluate(next => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => next === 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    }, state)
  await reportVisibility('hidden')
  await reportVisibility('visible')
  await recordAssertion(page, 'jujutsu-refresh-on-visible', () => expect(revisionRow(page, description)).toBeVisible())
  await finishJourneyAssertions(page)
})

Then('its changed files keep literal paths and track review progress', async ({ page }: { page: Page }) => {
  const row = revisionRow(page, 'Feature work by Ada')
  await recordAssertion(page, 'jujutsu-review-progress-starts-empty', () => expect(row.getByText('0/2 reviewed')).toBeVisible())
  await row.getByRole('radio', { name: 'Flat', exact: true }).click()
  await expect(row.getByRole('radio', { name: 'Flat', exact: true })).toBeChecked()
  await recordAssertion(page, 'jujutsu-flat-files-keep-literal-paths', () =>
    expect(row.getByRole('checkbox', { name: `Mark reviewed ${UNICODE_PATH}`, exact: true })).toBeVisible(),
  )
  await row.getByRole('checkbox', { name: `Mark reviewed ${UNICODE_PATH}`, exact: true }).click()
  await recordAssertion(page, 'jujutsu-review-progress-counts-reviewed-files', () => expect(row.getByText('1/2 reviewed')).toBeVisible())
  await row.getByRole('checkbox', { name: 'Hide reviewed files', exact: true }).click()
  await recordAssertion(page, 'jujutsu-hide-reviewed-files', async () => {
    await expect(row.getByRole('checkbox', { name: `Mark reviewed ${UNICODE_PATH}`, exact: true })).toHaveCount(0)
    await expect(row.getByRole('checkbox', { name: 'Mark reviewed feature.txt', exact: true })).toBeVisible()
  })
  await row.getByRole('button', { name: 'Full diff', exact: true }).click()
  await recordAssertion(page, 'jujutsu-full-diff-reveals-the-patch-section', async () => {
    await expect(row.getByText('Patch', { exact: true })).toBeVisible()
    await expect(row.getByText(UNICODE_PATH, { exact: true })).toBeVisible()
    await expect(row.getByRole('group', { name: /^Full diff of/ })).toHaveCount(0)
  })
  await row.getByRole('button', { name: 'Open full-page diff in a tab', exact: true }).click()
  await recordAssertion(page, 'jujutsu-full-page-diff-opens-in-panel-tab', async () => {
    await expect(page.getByRole('tab', { name: 'Diff', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Diff', exact: true })).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('group', { name: /^Full diff of Feature work by Ada · \w+ · 2 files$/ })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the stale preview is refused without changing the repository', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jujutsu-stale-preview-is-refused', async () => {
    await expect(page.getByRole('alert').filter({ hasText: 'Preview expired or repository state changed. Refresh and preview again.' })).toBeVisible()
    expect(descriptions(repository)).toContain('Feature work by Ada')
  })
})

Then('the Feature revision is squashed into Base', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await recordAssertion(page, 'jujutsu-confirmed-squash-runs', async () => {
    await expect.poll(() => descriptions(repository)).not.toContain('Feature work by Ada')
    expect(jj(repository, ['--ignore-working-copy', 'file', 'list', '-r', 'main'])).toContain('feature.txt')
    await expect(revisionRow(page, 'Feature work by Ada')).toHaveCount(0)
  })
  await finishJourneyAssertions(page)
})

Then('the workspace {string} exists and a session opens in it only when asked', async ({ page }: { page: Page }, name: string) => {
  const repository = repositoryFor(page)
  const provision = page.getByRole('alert').filter({ hasText: 'Created:' })
  await recordAssertion(page, 'jujutsu-workspace-is-created-at-the-revision', async () => {
    await expect(provision.getByText(`Created: ${join(repository.root, name)}`, { exact: true })).toBeVisible()
    expect(jj(repository, ['--ignore-working-copy', 'workspace', 'list'])).toContain(`${name}:`)
    expect(jj(repository, ['--ignore-working-copy', 'log', '--no-graph', '-r', `${name}@-`, '-T', 'description.first_line()'])).toBe('Feature work by Ada')
    await expect(page.getByRole('treeitem', { name, exact: true })).toHaveCount(0)
  })
  await provision.getByRole('button', { name: 'Open a DSH Session here', exact: true }).click()
  await recordAssertion(page, 'jujutsu-session-opens-in-the-new-workspace', async () => {
    await expect(page.getByRole('treeitem', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose workspace', exact: true })).toHaveText(name)
    await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeEditable()
  })
  await finishJourneyAssertions(page)
})

When('the repository is registered and a thread is started in it', async ({ page }: { page: Page }) => {
  const repository = repositoryFor(page)
  await registerWorkspaceFolder(page, repository.path)
  await page.getByRole('checkbox', { name: 'workspace', exact: true }).check()
  await sendMessage(page, 'jujutsu composer context thread')
  const workspaces = jj(repository, ['--ignore-working-copy', 'workspace', 'list'])
  const threadWorkspace = /^(thread-[\w-]+): (.+?)(?: \(current\))?$/mu.exec(workspaces)
  const threadRelativePath = threadWorkspace?.[2]?.trim().split(/\s/u)[0]
  if (threadRelativePath === undefined) throw new Error(`The thread workspace was not listed:\n${workspaces}`)
  const threadPath = resolve(repository.path, threadRelativePath)
  const threadRepository = { root: threadPath, path: threadPath }
  await writeFile(join(threadPath, 'review-one.txt'), 'First reviewed file.\n')
  await writeFile(join(threadPath, 'review-two.txt'), 'Second reviewed file.\n')
  jj(threadRepository, ['describe', '-m', 'Two-file review fixture'])
  const workspaceDiff = jj(threadRepository, ['diff', '--from', 'main', '--to', '@', '--summary'])
  expect(workspaceDiff).toContain('review-one.txt')
  expect(workspaceDiff).toContain('review-two.txt')
})

/** Register the fixture repository and let its thread answer `prompt`, so the answer renders as markdown. */
When('the repository is registered and its thread answers {string}', async ({ page }: { page: Page }, prompt: string) => {
  const repository = repositoryFor(page)
  await registerWorkspaceFolder(page, repository.path)
  await page.getByRole('checkbox', { name: 'workspace', exact: true }).check()
  await startThreadWithModel(page, { project: repository.path, model: FAKE_COMMAND_CODE_MODEL })
  await sendMessage(page, prompt)
})

Then('the two long-title JJ references use content-driven widths', async ({ page }: { page: Page }) => {
  const shortReference = page.getByRole('link', { name: `Jujutsu bookmark: ${SHORT_REFERENCE_TITLE} (short-ref)`, exact: true })
  const longReference = page.getByRole('link', { name: `Jujutsu bookmark: ${LONG_REFERENCE_TITLE} (long-ref)`, exact: true })
  await recordAssertion(page, 'jujutsu-chat-reference-width-follows-title-length', async () => {
    expect(SHORT_REFERENCE_TITLE.length).toBeGreaterThan(32)
    expect(LONG_REFERENCE_TITLE.length).toBeGreaterThan(32)
    await expect(shortReference).toHaveAttribute('title', SHORT_REFERENCE_TITLE)
    await expect(longReference).toHaveAttribute('title', LONG_REFERENCE_TITLE)
    const shortWidth = await shortReference.evaluate(element => element.getBoundingClientRect().width)
    const longWidth = await longReference.evaluate(element => element.getBoundingClientRect().width)
    expect(longWidth).toBeGreaterThan(shortWidth + 24)
  })
})

Then('hovering the reference previews the revision graph around it', async ({ page }: { page: Page }) => {
  const link = page.getByRole('link', { name: 'Jujutsu bookmark: Base fixture (main)', exact: true })
  await expect(link).toBeVisible({ timeout: 30_000 })
  await link.hover()
  await recordAssertion(page, 'jujutsu-chat-reference-hover-previews-revision-graph', async () => {
    await expect(link).toHaveText('Base fixture')
    await expect(link).toHaveAttribute('title', 'Base fixture')
    await expect(link).toHaveCSS('text-decoration-style', 'solid')
    const referenceColors = await link.evaluate(element => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--dsw-alias-state-business-primary)'
      document.body.append(probe)
      const expectedColor = getComputedStyle(probe).color
      probe.remove()
      return { actualColor: getComputedStyle(element).color, expectedColor }
    })
    expect(referenceColors.actualColor).toBe(referenceColors.expectedColor)
    await expect(page.getByText('Revision graph · main', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Commit ID: [a-f0-9]{8}$/u)).toBeVisible()
    await expect(page.getByText(/^Change ID: [k-z]{8,64}$/u)).toBeVisible()
    const shortCommitId = page.locator('[data-dshfiles-jj-preview] code').filter({ hasText: /^[a-f0-9]{8}$/u })
    await shortCommitId.hover()
    await expect(page.getByRole('tooltip')).toHaveText(/^[a-f0-9]{40,64}$/u)
    const graph = page.getByRole('list', { name: 'Revision graph', exact: true })
    await expect(graph).toBeVisible()
    await expect(graph).toContainText('main')
    await expect(graph).toContainText('default@')
  })
  await page.keyboard.press('Escape')
})

Then('clicking the reference opens the panel focused on that revision', async ({ page }: { page: Page }) => {
  const link = page.getByRole('link', { name: 'Jujutsu bookmark: Base fixture (main)', exact: true })
  await expect(link).toBeVisible({ timeout: 30_000 })
  await link.click()
  await recordAssertion(page, 'jujutsu-chat-reference-opens-focused-revision', async () => {
    await expect(page.getByRole('button', { name: 'Jujutsu view settings', exact: true })).toBeVisible()
    // `Full diff` renders only inside one revision's expanded details, so it proves the reference was selected.
    await expect(page.getByRole('button', { name: 'Full diff', exact: true })).toBeVisible()
  })
})

Then('the Agent prompt tells it to write Jujutsu references with the jj: prefix', async ({ page }: { page: Page }) => {
  const request = fakeCommandCodeFor(page).requests.find(candidate => candidate.kind === 'turn')
  await recordAssertion(page, 'jujutsu-chat-reference-instruction-reaches-the-model', () =>
    expect(request?.messages.some(message => message.text.includes('jj:<name>'))).toBe(true),
  )
  await finishJourneyAssertions(page)
})

When('a second disposable Jujutsu repository has a bookmark {string} on {string}', async ({ page }: { page: Page }, bookmark: string, description: string) => {
  const repository = repositoryFor(page)
  const foreign = { root: repository.root, path: join(repository.root, 'foreign') }
  foreignRepositories.set(page, { ...foreign, bookmark, description })
  await mkdir(foreign.path)
  jj(foreign, ['git', 'init', '--no-colocate'])
  await writeFile(join(foreign.path, 'foreign.txt'), 'foreign\n')
  jj(foreign, ['describe', '-m', description])
  jj(foreign, ['bookmark', 'create', bookmark, '-r', '@'])
  jj(foreign, ['new'])
  expect(descriptions(repository)).not.toContain(description)
})

When("both repositories are registered and the first repository's thread answers {string}", async ({ page }: { page: Page }, prompt: string) => {
  const repository = repositoryFor(page)
  await registerWorkspaceFolder(page, foreignRepositoryFor(page).path)
  await registerWorkspaceFolder(page, repository.path)
  await startThreadWithModel(page, { project: repository.path, model: FAKE_COMMAND_CODE_MODEL })
  await sendMessage(page, prompt)
})

const foreignReferenceLink = (page: Page) => {
  const foreign = foreignRepositoryFor(page)
  return page.getByRole('link', { name: new RegExp(`\\(${foreign.bookmark}\\)$`, 'u') })
}

Then('hovering the foreign reference previews its revision graph from the other repository', async ({ page }: { page: Page }) => {
  const foreign = foreignRepositoryFor(page)
  const link = foreignReferenceLink(page)
  await expect(link).toBeVisible({ timeout: 30_000 })
  await link.hover()
  await recordAssertion(page, 'jujutsu-foreign-chat-reference-hover-previews-other-repository', async () => {
    await expect(link).toHaveText(foreign.description)
    await expect(page.getByText(`Revision graph · ${foreign.bookmark}`, { exact: true })).toBeVisible()
    await expect(page.getByText(/^Commit ID: [a-f0-9]{8}$/u)).toBeVisible()
    const graph = page.getByRole('list', { name: 'Revision graph', exact: true })
    await expect(graph).toContainText(foreign.bookmark)
    await expect(page.locator('[data-dshfiles-jj-preview]').getByRole('alert')).toHaveCount(0)
  })
  await page.keyboard.press('Escape')
})

Then('clicking the foreign reference opens the panel on the other repository focused on that revision', async ({ page }: { page: Page }) => {
  const foreign = foreignRepositoryFor(page)
  const link = foreignReferenceLink(page)
  await expect(link).toBeVisible({ timeout: 30_000 })
  await link.click()
  await recordAssertion(page, 'jujutsu-foreign-chat-reference-opens-other-repository', async () => {
    await expect(revisionRow(page, foreign.description)).toBeVisible({ timeout: 30_000 })
    await expect(revisionRow(page, 'Feature work by Ada')).toHaveCount(0)
    await expect(revisionRow(page, foreign.description).getByRole('button', { name: 'Full diff', exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

Then('the composer dock names the project, thread workspace and bookmark in one chip', async ({ page }: { page: Page }) => {
  const chip = page.getByRole('button', { name: /^repo \(thread-[0-9a-f]{6} \/ main\+\)$/ })
  const viewport = page.viewportSize()
  await recordAssertion(page, 'jujutsu-composer-dock-has-one-context-chip', async () => {
    await expect(chip).toBeVisible()
    await expect(page.getByRole('button', { name: 'repo', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^thread-[0-9a-f]{6}$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^@ \w+ · main\+$/ })).toHaveCount(0)
  })
  for (const width of [360, 480, 768, 1024]) {
    await page.setViewportSize({ width, height: viewport?.height ?? 900 })
    await expect(chip).toBeVisible()
    await expect.poll(() => chip.evaluate(button => button.scrollWidth <= button.clientWidth)).toBe(true)
  }
  if (viewport !== null) await page.setViewportSize(viewport)
  await chip.click()
  await recordAssertion(page, 'jujutsu-composer-chip-opens-the-repository', () => expect(revisionRow(page, 'Feature work by Ada')).toBeVisible())
  await finishJourneyAssertions(page)
})

Then('the composer summary shows an exact revision count against main', async ({ page }: { page: Page }) => {
  const summary = page.getByRole('button', { name: /^Review workspace changes: @ vs main: 1 only on @$/u })
  await recordAssertion(page, 'jujutsu-composer-summary-shows-a-real-ahead-or-behind-count', () => expect(summary).toBeVisible())
  await summary.click()
  const review = page.getByTestId('pulls-review-diffs')
  await recordAssertion(page, 'jujutsu-composer-summary-opens-multi-file-workspace-review', async () => {
    await expect(review).toBeVisible()
    await expect(review.getByText('review-one.txt', { exact: true })).toBeVisible()
    await expect(review.getByText('review-two.txt', { exact: true })).toBeVisible()
    await expect(review.getByText('base.txt', { exact: true })).toHaveCount(0)
  })
})

After(async ({ page }: { page: Page }) => {
  const repository = repositories.get(page)
  if (repository === undefined) return
  repositories.delete(page)
  foreignRepositories.delete(page)
  await rm(repository.root, { recursive: true, force: true })
})
