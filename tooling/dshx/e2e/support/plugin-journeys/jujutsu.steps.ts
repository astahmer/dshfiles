import { expect, type Page } from '@playwright/test'
import { openGlobalPanel } from '../plugin-view-names.js'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { registerWorkspaceFolder } from '../threads.js'

interface JujutsuFixture {
  readonly temporaryRoot: string
  readonly repositoryPath: string
  readonly revisionId: string
  readonly commitId: string
  readonly sourceDescription: string
  readonly childDescription: string
  readonly targetDescription: string
}

const fixtures = new WeakMap<Page, JujutsuFixture>()
interface CleanupGraphFixture {
  readonly workspaceName: string
  readonly mainCommitId: string
  readonly targetDescription: string
  readonly visibleRevisionCount: number
}
const cleanupGraphFixtures = new WeakMap<Page, CleanupGraphFixture>()
const cleanupFolderNames = { selected: 'stale-cleanup-selected', preserved: 'stale-cleanup-preserved' } as const
const cleanupFolderPaths = (fixture: JujutsuFixture) => ({
  selected: join(fixture.temporaryRoot, 'repo-threads', cleanupFolderNames.selected),
  preserved: join(fixture.temporaryRoot, 'repo-threads', cleanupFolderNames.preserved),
})
const sourceDescription = 'Branch source fixture'
const childDescription = 'Branch child fixture'
const targetDescription = 'Destination target fixture'
const bookmarkName = 'feature/drop-preview'
const invalidDropMessage = 'A branch cannot be rebased onto one of its own revisions.'

const jjAt = (cwd: string, home: string, args: readonly string[]): string => {
  const result = spawnSync(process.env.JJ_TEST_EXECUTABLE ?? 'jj', ['--color=never', '--no-pager', ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    timeout: 20_000,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`Disposable JJ fixture command failed (${String(result.status)}): ${result.stderr}`)
  return result.stdout
}

const currentCommitId = (repositoryPath: string, home: string): string =>
  jjAt(repositoryPath, home, ['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'commit_id']).trim()

const cleanupWorkspaceFor = async (fixture: JujutsuFixture): Promise<CleanupGraphFixture> => {
  const workspaceName = 'thread-e2e001'
  const targetDescription = 'Cleanup older main ancestor workspace'
  const historyCount = 24
  for (let index = 1; index <= 6; index += 1) {
    jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['new'])
    jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['describe', '--message', `Cleanup main history ${String(index).padStart(2, '0')}`])
  }
  const workspaceBaseCommitId = currentCommitId(fixture.repositoryPath, fixture.temporaryRoot)
  const workspacePath = join(fixture.temporaryRoot, 'repo-threads', workspaceName)
  await mkdir(join(fixture.temporaryRoot, 'repo-threads'), { recursive: true })
  jjAt(fixture.repositoryPath, fixture.temporaryRoot, [
    'workspace',
    'add',
    '--no-colocate',
    '--name',
    workspaceName,
    '--revision',
    workspaceBaseCommitId,
    workspacePath,
  ])
  jjAt(workspacePath, fixture.temporaryRoot, ['describe', '--message', targetDescription])
  const workspaceCommitId = currentCommitId(workspacePath, fixture.temporaryRoot)
  jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['new', workspaceCommitId])
  for (let index = 7; index <= historyCount; index += 1) {
    jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['new'])
    jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['describe', '--message', `Cleanup main history ${String(index).padStart(2, '0')}`])
  }
  const mainCommitId = currentCommitId(fixture.repositoryPath, fixture.temporaryRoot)
  jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['bookmark', 'set', 'main', '--revision', mainCommitId])
  expect(
    jjAt(fixture.repositoryPath, fixture.temporaryRoot, [
      '--ignore-working-copy',
      'log',
      '--no-graph',
      '--revisions',
      `(::${workspaceName}@ ~ ::main) ~ empty()`,
      '--template',
      'commit_id ++ "\\n"',
    ]).trim(),
  ).toBe('')
  expect(
    jjAt(fixture.repositoryPath, fixture.temporaryRoot, [
      '--ignore-working-copy',
      'log',
      '--no-graph',
      '--revisions',
      `${workspaceName}@ & ::main`,
      '--template',
      'commit_id',
    ]).trim(),
  ).toBe(workspaceCommitId)
  const firstPageIds = jjAt(fixture.repositoryPath, fixture.temporaryRoot, [
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '--limit',
    '10',
    '--revisions',
    'all()',
    '--template',
    'commit_id ++ "\\n"',
  ])
    .split('\n')
    .filter(Boolean)
  expect(firstPageIds).not.toContain(workspaceCommitId)
  const visibleRevisionCount = jjAt(fixture.repositoryPath, fixture.temporaryRoot, [
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '--revisions',
    'all()',
    '--template',
    'commit_id ++ "\\n"',
  ])
    .split('\n')
    .filter(Boolean).length
  return { workspaceName, mainCommitId, targetDescription, visibleRevisionCount }
}

const workspaceNames = (fixture: JujutsuFixture): readonly string[] =>
  jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"']).split('\n').filter(Boolean)

const snapshotRepository = (fixture: JujutsuFixture): string =>
  jjAt(fixture.repositoryPath, fixture.temporaryRoot, [
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '--revisions',
    'all()',
    '--template',
    'self.commit_id().short(64) ++ " " ++ self.parents().map(|parent| parent.commit_id().short(64)).join(",") ++ "\\n"',
  ]) +
  'bookmark ' +
  jjAt(fixture.repositoryPath, fixture.temporaryRoot, [
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '--revisions',
    `bookmarks(exact:"${bookmarkName}")`,
    '--template',
    'commit_id',
  ]).trim()

const createFixture = async (page: Page): Promise<JujutsuFixture> => {
  const fixtureParent = join(process.cwd(), 'test-results')
  await mkdir(fixtureParent, { recursive: true })
  const temporaryRoot = await mkdtemp(join(fixtureParent, 'dshx-jujutsu-e2e-'))
  const repositoryPath = join(temporaryRoot, 'repo')
  await mkdir(repositoryPath)
  try {
    jjAt(repositoryPath, temporaryRoot, ['git', 'init', '--no-colocate'])
    jjAt(repositoryPath, temporaryRoot, ['config', 'set', '--repo', 'user.name', 'Jujutsu E2E'])
    jjAt(repositoryPath, temporaryRoot, ['config', 'set', '--repo', 'user.email', 'jujutsu-e2e@example.invalid'])
    jjAt(repositoryPath, temporaryRoot, ['describe', '--message', 'Base target fixture'])
    const targetParent = currentCommitId(repositoryPath, temporaryRoot)
    jjAt(repositoryPath, temporaryRoot, ['new'])
    jjAt(repositoryPath, temporaryRoot, ['describe', '--message', sourceDescription])
    const sourceCommitId = currentCommitId(repositoryPath, temporaryRoot)
    jjAt(repositoryPath, temporaryRoot, ['bookmark', 'create', bookmarkName, '--revision', sourceCommitId])
    jjAt(repositoryPath, temporaryRoot, ['new'])
    jjAt(repositoryPath, temporaryRoot, ['describe', '--message', childDescription])
    jjAt(repositoryPath, temporaryRoot, ['new', targetParent])
    jjAt(repositoryPath, temporaryRoot, ['describe', '--message', targetDescription])
    const ids = jjAt(repositoryPath, temporaryRoot, [
      '--ignore-working-copy',
      'log',
      '--no-graph',
      '--revisions',
      sourceCommitId,
      '--template',
      'self.change_id().short(64) ++ "|" ++ self.commit_id().short(64)',
    ])
      .trim()
      .split('|')
    const revisionId = ids[0]
    const commitId = ids[1]
    if (revisionId === undefined || commitId === undefined) throw new Error('JJ did not return both fixture revision IDs.')
    const fixture = { temporaryRoot, repositoryPath, revisionId, commitId, sourceDescription, childDescription, targetDescription }
    fixtures.set(page, fixture)
    return fixture
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

const fixtureFor = (page: Page): JujutsuFixture => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) throw new Error('The disposable Jujutsu repository was not created for this scenario.')
  return fixture
}

const revisionRow = (page: Page, description: string) => page.locator('article[data-commit-id]').filter({ hasText: description })

const dispatchDrop = async (
  page: Page,
  input: { readonly source: string; readonly target: string; readonly kind: 'revision' | 'bookmark'; readonly hideTransferData?: boolean },
): Promise<boolean> =>
  page.evaluate(({ source, target, kind, hideTransferData }) => {
    const findRow = (description: string): HTMLElement | undefined =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="region"] article')).find(row => row.textContent?.includes(description))
    const sourceRow = findRow(source)
    const targetRow = findRow(target)
    const dragSource = sourceRow?.querySelector<HTMLElement>(kind === 'bookmark' ? 'span[draggable="true"]' : 'div[draggable="true"]')
    if (sourceRow === undefined || targetRow === undefined || dragSource === null || dragSource === undefined) {
      throw new Error('The expected Jujutsu drag source or target row is missing.')
    }
    const dataTransfer = new DataTransfer()
    dragSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
    if (hideTransferData) {
      Object.defineProperty(dataTransfer, 'types', { configurable: true, value: [] })
      Object.defineProperty(dataTransfer, 'getData', { configurable: true, value: () => '' })
    }
    targetRow.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }))
    targetRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
    targetRow.dispatchEvent(drop)
    dragSource.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }))
    return drop.defaultPrevented
  }, input)

const selectRepository = async (page: Page, fixture: JujutsuFixture, waitForFixtureRows = true): Promise<void> => {
  await page.evaluate(({ key, path }) => localStorage.setItem(key, JSON.stringify(path)), { key: 'dshfiles.jujutsu.selected', path: fixture.repositoryPath })
  await page.reload()
  await openGlobalPanel(page, 'Jujutsu: Revision graph')
  if (!waitForFixtureRows) return
  await expect(revisionRow(page, fixture.sourceDescription)).toBeVisible({ timeout: 30_000 })
  await expect(revisionRow(page, fixture.targetDescription)).toBeVisible({ timeout: 30_000 })
}

const openClickToTargetPreview = async (page: Page, fixture: JujutsuFixture): Promise<void> => {
  await revisionRow(page, fixture.sourceDescription).getByRole('button').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rebase branch onto…', exact: true }).click()
  await expect(page.getByText(/Choose a destination for .*Branch source fixture/)).toBeVisible()
  await revisionRow(page, fixture.targetDescription).getByRole('button').first().click()
}

When('a disposable Jujutsu repository is selected', async ({ page }: { page: Page }) => {
  const fixture = await createFixture(page)
  await selectRepository(page, fixture)
})

When('a disposable Jujutsu repository with six workspaces on one revision is selected', async ({ page }: { page: Page }) => {
  const fixture = await createFixture(page)
  for (let index = 1; index <= 6; index += 1) {
    const name = `review-0${index}`
    const path = join(fixture.temporaryRoot, name)
    jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['workspace', 'add', '--name', name, '--revision', fixture.commitId, path])
    jjAt(path, fixture.temporaryRoot, ['edit', fixture.commitId])
  }
  await selectRepository(page, fixture)
})

Then('an overflow workspace can be dragged to another revision and moved independently', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const source = revisionRow(page, fixture.sourceDescription)
  const overflow = source.getByRole('button', { name: 'Show 2 more workspaces', exact: true })
  const panel = page
    .locator('main.dshx-root')
    .filter({ has: page.getByRole('region', { name: 'Revisions', exact: true }) })
    .last()
  await panel.evaluate(element => {
    element.style.width = '360px'
    element.style.maxWidth = '360px'
  })
  await overflow.click()
  await expect(page.getByRole('dialog', { name: 'More workspaces', exact: true }).getByText('review-06', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await panel.evaluate(element => {
    element.style.removeProperty('width')
    element.style.removeProperty('max-width')
  })
  await overflow.focus()
  await page.keyboard.press('Enter')
  const list = page.getByRole('dialog', { name: 'More workspaces', exact: true })
  await expect(list.getByText('review-05', { exact: true })).toBeVisible()
  await expect(list.getByText('review-06', { exact: true })).toBeVisible()
  await list.getByText('review-05', { exact: true }).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Remove workspace…', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: 'Remove workspace…', exact: true })).toBeHidden()
  if (await list.isVisible()) await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await overflow.click()
  await expect(list).toBeVisible()
  await list.getByText('review-06', { exact: true }).dragTo(revisionRow(page, fixture.targetDescription))
  const preview = page.getByRole('group', { name: 'Preview workspace move', exact: true })
  await expect(preview).toContainText('review-06')
  await expect(preview).toContainText(fixture.targetDescription)
  await preview.getByRole('button', { name: 'Move workspace', exact: true }).click()
  await expect(preview).toBeHidden({ timeout: 10_000 })
  const moved = currentCommitId(join(fixture.temporaryRoot, 'review-06'), fixture.temporaryRoot)
  expect(moved).toBe(currentCommitId(fixture.repositoryPath, fixture.temporaryRoot))
  for (let index = 1; index <= 5; index += 1) {
    expect(currentCommitId(join(fixture.temporaryRoot, `review-0${index}`), fixture.temporaryRoot)).toBe(fixture.commitId)
  }
  await finishJourneyAssertions(page)
})

When('a disposable Jujutsu cleanup repository with an empty older-page workspace is selected', async ({ page }: { page: Page }) => {
  const fixture = await createFixture(page)
  cleanupGraphFixtures.set(page, await cleanupWorkspaceFor(fixture))
  await registerWorkspaceFolder(page, fixture.repositoryPath)
  await selectRepository(page, fixture, false)
})

Then('the empty workspace label appears on its older main ancestor', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const cleanupFixture = cleanupGraphFixtures.get(page)
  if (cleanupFixture === undefined) throw new Error('The cleanup workspace fixture was not created.')
  expect(currentCommitId(fixture.repositoryPath, fixture.temporaryRoot)).toBe(cleanupFixture.mainCommitId)
  const revisions = page.getByRole('region', { name: 'Revisions', exact: true })
  await expect.poll(async () => Number(await revisions.getAttribute('data-loaded-revisions')), { timeout: 30_000 }).toBeGreaterThan(10)
  await revisions.evaluate(element => {
    element.scrollTop = element.scrollHeight
  })
  const targetRow = revisionRow(page, cleanupFixture.targetDescription)
  await expect(targetRow).toBeVisible({ timeout: 30_000 })
  await expect(targetRow.getByText(cleanupFixture.workspaceName, { exact: true })).toBeVisible()
})
Then('removing the selected repository offers a way to choose another', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  await rm(fixture.repositoryPath, { recursive: true, force: true })
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByText('Registered repository path is unavailable. Select it again.', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page
    .getByRole('alert')
    .filter({ hasText: 'Registered repository path is unavailable. Select it again.' })
    .getByRole('button', { name: 'Choose another repository', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Choose a Jujutsu repository', exact: true })).toBeVisible()
})

Then('revision and bookmark moves preview in the target context without changing history', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const before = snapshotRepository(fixture)

  await recordAssertion(page, 'jujutsu-descendant-drop-is-cancelled-by-the-row-handler', async () => {
    await expect(await dispatchDrop(page, { source: fixture.sourceDescription, target: fixture.childDescription, kind: 'revision' })).toBe(true)
    await expect(page.getByText(invalidDropMessage, { exact: true })).toBeVisible({ timeout: 8_000 })
  })

  await recordAssertion(page, 'jujutsu-valid-branch-drop-is-cancelled-by-the-row-handler', async () =>
    expect(await dispatchDrop(page, { source: fixture.sourceDescription, target: fixture.targetDescription, kind: 'revision', hideTransferData: true })).toBe(
      true,
    ),
  )
  const branchPreview = page.getByRole('group', { name: 'Preview branch rebase', exact: true })
  await recordAssertion(page, 'jujutsu-rebase-drop-renders-context-and-host-preview', async () => {
    await expect(branchPreview).toBeVisible({ timeout: 8_000 })
    await expect(branchPreview).toContainText(fixture.sourceDescription)
    await expect(branchPreview).toContainText(fixture.childDescription)
    await expect(branchPreview).toContainText(fixture.targetDescription)
    await expect(branchPreview).toContainText('Jujutsu will rebase this revision and its descendants.')
    await expect(branchPreview.locator('pre')).toBeVisible()
    await expect(branchPreview.getByRole('button', { name: 'Rebase revision', exact: true })).toBeEnabled()
  })
  const revisionSearch = page.getByRole('textbox', { name: 'Search revisions', exact: true })
  if (!(await revisionSearch.isVisible())) await page.getByRole('button', { name: 'Show search', exact: true }).click()
  await revisionSearch.fill(fixture.sourceDescription)
  await recordAssertion(page, 'jujutsu-preview-survives-filtering-out-its-target-row', async () => {
    await expect(revisionRow(page, fixture.targetDescription)).toHaveCount(0)
    await expect(branchPreview).toBeVisible()
    await expect(branchPreview.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
  })
  await page.getByRole('textbox', { name: 'Search revisions', exact: true }).fill('')
  await branchPreview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(branchPreview).toBeHidden()

  await recordAssertion(page, 'jujutsu-bookmark-drop-is-cancelled-by-the-row-handler', async () =>
    expect(await dispatchDrop(page, { source: fixture.sourceDescription, target: fixture.targetDescription, kind: 'bookmark' })).toBe(true),
  )
  const bookmarkPreview = page.getByRole('group', { name: 'Preview bookmark move', exact: true })
  await recordAssertion(page, 'jujutsu-bookmark-drop-renders-target-context-preview', async () => {
    await expect(bookmarkPreview).toBeVisible()
    await expect(bookmarkPreview).toContainText(bookmarkName)
    await expect(bookmarkPreview).toContainText(fixture.sourceDescription)
    await expect(bookmarkPreview).toContainText(fixture.targetDescription)
  })
  await bookmarkPreview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(bookmarkPreview).toBeHidden()

  await openClickToTargetPreview(page, fixture)
  await recordAssertion(page, 'jujutsu-click-to-target-prepares-a-rebase-preview', async () => {
    await expect(branchPreview).toBeVisible()
    await expect(branchPreview).toContainText(fixture.sourceDescription)
    await expect(branchPreview).toContainText(fixture.targetDescription)
  })
  await branchPreview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(branchPreview).toBeHidden()

  await recordAssertion(page, 'jujutsu-cancelled-moves-preserve-repository-state', () => expect(snapshotRepository(fixture)).toBe(before))
  await finishJourneyAssertions(page)
})

Then('the revision context menu copies the displayed revision ID', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const origin = new URL(page.url()).origin
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  const sourceButton = revisionRow(page, fixture.sourceDescription).getByRole('button').first()

  await sourceButton.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: /^Copy/ })).toHaveCount(1)
  await page.getByRole('menuitem', { name: 'Copy revision ID', exact: true }).click()
  await recordAssertion(page, 'jujutsu-copy-revision-id-matches-visible-change-id', async () => {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(fixture.revisionId)
    await expect(page.getByText('Revision ID copied.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('a disposable Jujutsu navigation repository is selected', async ({ page }: { page: Page }) => {
  const fixture = await createFixture(page)
  jjAt(fixture.repositoryPath, fixture.temporaryRoot, ['bookmark', 'create', 'main', '-r', `${fixture.commitId}-`])
  await selectRepository(page, fixture)
})

Then('landmarks and relationships navigate without mutating history', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const before = snapshotRepository(fixture)
  await expect(page.getByRole('button', { name: 'Locate Current', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Locate Default', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Locate main', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Locate main@origin', exact: true })).toBeDisabled()
  const comparison = page.getByRole('region', { name: 'Revision comparison', exact: true })
  await expect(comparison).toHaveCount(0)
  await revisionRow(page, fixture.childDescription).getByRole('button').first().click()
  await expect(comparison).toHaveCount(0)
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(comparison.getByText('Ahead of target', { exact: true })).toBeVisible()
  await expect(comparison.getByText(/2 only in/)).toBeVisible()
  await comparison.getByRole('button', { name: 'Work since target', exact: true }).click()
  await expect(revisionRow(page, 'Base target fixture')).toHaveCount(0)
  await expect(revisionRow(page, fixture.targetDescription)).toHaveCount(0)
  await expect(revisionRow(page, fixture.sourceDescription)).toBeVisible()
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await comparison.getByRole('combobox', { name: 'Comparison target', exact: true }).click()
  await page.getByRole('option', { name: 'Another revision…', exact: true }).click()
  const revisionTarget = comparison.getByRole('combobox', { name: 'Choose revision target', exact: true })
  await revisionTarget.click()
  await page.getByRole('combobox', { name: 'Search loaded revisions', exact: true }).fill(fixture.childDescription)
  await page.getByRole('option').filter({ hasText: fixture.childDescription }).click()
  await expect(comparison.getByText('Same revision', { exact: true })).toBeVisible()
  await expect(comparison.getByRole('button', { name: 'Work since target', exact: true })).toBeDisabled()
  await comparison.getByRole('combobox', { name: 'Comparison target', exact: true }).click()
  await page.getByRole('option', { name: 'Default', exact: true }).click()
  await expect(comparison.getByText('Diverged', { exact: true })).toBeVisible()
  await expect(comparison.getByText(/1 only in Default/)).toBeVisible()
  const rowsBeforeHighlight = await page.getByRole('region', { name: 'Revisions', exact: true }).locator('article').count()
  await comparison.getByRole('button', { name: 'Highlight path', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove Connection highlighted', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Revisions', exact: true }).locator('article')).toHaveCount(rowsBeforeHighlight)
  await page.getByRole('button', { name: 'Remove Connection highlighted', exact: true }).click()
  await comparison.getByRole('button', { name: 'Close comparison', exact: true }).click()
  await revisionRow(page, fixture.childDescription).getByRole('button').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Compare with', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Default', exact: true }).click()
  await expect(comparison.getByText('Diverged', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search revisions', exact: true }).fill(fixture.childDescription)
  await page.getByRole('button', { name: 'Locate Current', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show temporarily', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show temporarily', exact: true }).click()
  await expect(revisionRow(page, fixture.targetDescription)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Search revisions', exact: true })).toHaveValue(fixture.childDescription)
  await page.getByRole('button', { name: 'Remove 1 temporarily revealed', exact: true }).click()
  await expect(revisionRow(page, fixture.targetDescription)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(revisionRow(page, fixture.targetDescription)).toBeVisible()
  expect(snapshotRepository(fixture)).toBe(before)
})

Then('graph focus and hide can be undone without losing shared history', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const before = snapshotRepository(fixture)
  await revisionRow(page, fixture.childDescription).getByRole('button').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Focus history leading here', exact: true }).click()
  await expect(page.getByRole('button', { name: /Remove History leading to/ })).toBeVisible()
  await expect(revisionRow(page, fixture.targetDescription)).toHaveCount(0)
  await expect(revisionRow(page, 'Base target fixture')).toBeVisible()
  const panel = page
    .locator('main.dshx-root')
    .filter({ has: page.getByRole('region', { name: 'Revisions', exact: true }) })
    .last()
  for (const width of [360, 480, 768, 1024]) {
    await panel.evaluate((element, paneWidth) => {
      element.style.width = `${paneWidth}px`
      element.style.maxWidth = `${paneWidth}px`
    }, width)
    await expect.poll(() => page.getByLabel('Graph landmarks', { exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await expect
      .poll(() => page.getByLabel('Graph view status', { exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1))
      .toBe(true)
    await expect
      .poll(() => page.getByRole('region', { name: 'Revision comparison', exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth + 1))
      .toBe(true)
  }
  await panel.evaluate(element => {
    element.style.removeProperty('width')
    element.style.removeProperty('max-width')
  })
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(revisionRow(page, fixture.targetDescription)).toBeVisible()
  await revisionRow(page, fixture.childDescription).getByRole('button').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Hide exclusive history leading here', exact: true }).click()
  await expect(revisionRow(page, fixture.childDescription)).toHaveCount(0)
  await expect(revisionRow(page, fixture.sourceDescription)).toBeVisible()
  await expect(revisionRow(page, 'Base target fixture')).toBeVisible()
  await page.getByRole('button', { name: 'Undo hide', exact: true }).click()
  await expect(revisionRow(page, fixture.childDescription)).toBeVisible()
  expect(snapshotRepository(fixture)).toBe(before)
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) return
  fixtures.delete(page)
  cleanupGraphFixtures.delete(page)
  await rm(fixture.temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The repository state before the cleanup dialog opened, so its preview is proven to remove nothing. */
const cleanupSnapshots = new WeakMap<Page, string>()

When('two stale untracked folders exist beside the repository', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const paths = cleanupFolderPaths(fixture)
  for (const path of Object.values(paths)) {
    await mkdir(path, { recursive: true })
    await utimes(path, new Date(0), new Date(0))
  }
})

When('the repository actions menu opens the workspace cleanup', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  cleanupSnapshots.set(page, snapshotRepository(fixture))
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Clean up JJ workspaces…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Clean up workspaces', exact: true })).toBeVisible({ timeout: 10_000 })
})

Then('the cleanup dialog shows age presets without removing anything', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const paths = cleanupFolderPaths(fixture)
  const dialog = page.getByRole('dialog', { name: 'Clean up workspaces', exact: true })
  await expect(dialog.getByRole('radio', { name: '6h', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByRole('radio', { name: '7d', exact: true })).toBeVisible()
  await expect(dialog.getByText(/empty revisions? will be abandoned/)).toBeVisible({ timeout: 20_000 })
  const allAgesPreview = page.waitForResponse(response => {
    const body = response.request().postData() ?? ''
    return response.request().method() === 'POST' && /"olderThanHours"\s*:\s*0(?:\D|$)/.test(body) && /"apply"\s*:\s*false/.test(body)
  })
  await dialog.getByRole('radio', { name: 'All', exact: true }).click()
  await expect(dialog.getByRole('radio', { name: 'All', exact: true })).toHaveAttribute('aria-checked', 'true')
  expect((await allAgesPreview).ok()).toBe(true)
  await dialog.getByRole('radio', { name: '6h', exact: true }).click()
  await expect(dialog.getByRole('radio', { name: '6h', exact: true })).toHaveAttribute('aria-checked', 'true')
  await recordAssertion(page, 'jujutsu-cleanup-age-preset-preview-does-not-remove-items', async () =>
    expect(dialog.getByText(/empty revisions? will be abandoned/)).toBeVisible({ timeout: 20_000 }),
  )
  await dialog.getByRole('button', { name: /Untracked folders/ }).click()
  await expect(dialog.getByRole('checkbox', { name: `Select ${cleanupFolderNames.selected}`, exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: `Select ${cleanupFolderNames.preserved}`, exact: true })).toBeVisible()
  expect(existsSync(paths.selected)).toBe(true)
  expect(existsSync(paths.preserved)).toBe(true)
  expect(snapshotRepository(fixture)).toBe(cleanupSnapshots.get(page))
  const visibleRevisionDescription = cleanupGraphFixtures.get(page)?.targetDescription ?? fixture.sourceDescription
  await expect(revisionRow(page, visibleRevisionDescription)).toBeVisible()
})

When('one stale untracked folder and the older-page workspace are selected for cleanup', async ({ page }: { page: Page }) => {
  const cleanupFixture = cleanupGraphFixtures.get(page)
  if (cleanupFixture === undefined) throw new Error('The cleanup workspace fixture was not created.')
  const dialog = page.getByRole('dialog', { name: 'Clean up workspaces', exact: true })
  await dialog.getByRole('radio', { name: 'All', exact: true }).click()
  await dialog.getByRole('button', { name: /^Empty/ }).click()
  const selectedWorkspace = dialog.getByRole('checkbox', { name: `Select ${cleanupFixture.workspaceName}`, exact: true })
  await selectedWorkspace.click()
  await expect(selectedWorkspace).toBeChecked()
  const selectedFolder = dialog.getByRole('checkbox', { name: `Select ${cleanupFolderNames.selected}`, exact: true })
  await selectedFolder.click()
  await expect(selectedFolder).toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Clean up 2', exact: true })).toBeEnabled()
})

Then('cleanup removes only the selected folder and clears the old graph workspace label without reloading', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const cleanupFixture = cleanupGraphFixtures.get(page)
  if (cleanupFixture === undefined) throw new Error('The cleanup workspace fixture was not created.')
  const paths = cleanupFolderPaths(fixture)
  const dialog = page.getByRole('dialog', { name: 'Clean up workspaces', exact: true })
  await dialog.getByRole('button', { name: 'Clean up 2', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => existsSync(paths.selected), { timeout: 20_000 }).toBe(false)
  expect(existsSync(paths.preserved)).toBe(true)
  await expect.poll(() => workspaceNames(fixture), { timeout: 30_000 }).not.toContain(cleanupFixture.workspaceName)
  await expect(page.getByRole('status').filter({ hasText: '1 thread workspaces removed' })).toBeVisible({ timeout: 30_000 })
  expect(snapshotRepository(fixture)).toBe(cleanupSnapshots.get(page))
  const revisions = page.getByRole('region', { name: 'Revisions', exact: true })
  await expect.poll(async () => Number(await revisions.getAttribute('data-loaded-revisions')), { timeout: 30_000 }).toBe(cleanupFixture.visibleRevisionCount)
  await revisions.evaluate(element => {
    element.scrollTop = element.scrollHeight
  })
  const targetRow = revisionRow(page, cleanupFixture.targetDescription)
  await expect(targetRow).toBeVisible({ timeout: 30_000 })
  await expect(targetRow.getByText(cleanupFixture.workspaceName, { exact: true })).toHaveCount(0)
  await expect(targetRow).toBeVisible()
  await finishJourneyAssertions(page)
})
