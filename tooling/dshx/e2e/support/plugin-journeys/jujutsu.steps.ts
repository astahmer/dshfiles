import { expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

interface JujutsuFixture {
  readonly temporaryRoot: string
  readonly repositoryPath: string
  readonly changeId: string
  readonly commitId: string
  readonly sourceDescription: string
  readonly childDescription: string
  readonly targetDescription: string
}

const fixtures = new WeakMap<Page, JujutsuFixture>()
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
      'self.change_id().normal_hex() ++ "|" ++ self.commit_id().short(64)',
    ]).trim().split('|')
    const changeId = ids[0]
    const commitId = ids[1]
    if (changeId === undefined || commitId === undefined) throw new Error('JJ did not return both fixture revision IDs.')
    const fixture = { temporaryRoot, repositoryPath, changeId, commitId, sourceDescription, childDescription, targetDescription }
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

const revisionRow = (page: Page, description: string) =>
  page.getByRole('region', { name: 'Revisions', exact: true }).first().locator('article').filter({ hasText: description })

const dispatchDrop = async (
  page: Page,
  input: { readonly source: string; readonly target: string; readonly kind: 'revision' | 'bookmark' },
): Promise<boolean> =>
  page.evaluate(({ source, target, kind }) => {
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
    targetRow.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }))
    targetRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
    targetRow.dispatchEvent(drop)
    dragSource.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }))
    return drop.defaultPrevented
  }, input)

const selectRepository = async (page: Page, fixture: JujutsuFixture): Promise<void> => {
  await page.evaluate(
    ({ key, path }) => localStorage.setItem(key, JSON.stringify(path)),
    { key: 'dshfiles.jujutsu.selected', path: fixture.repositoryPath },
  )
  await page.reload()
  await page.getByRole('button', { name: 'Jujutsu', exact: true }).first().click()
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

Then('revision and bookmark moves preview in the target context without changing history', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const before = snapshotRepository(fixture)

  await recordAssertion(page, 'jujutsu-descendant-drop-is-cancelled-by-the-row-handler', async () => {
    await expect(await dispatchDrop(page, { source: fixture.sourceDescription, target: fixture.childDescription, kind: 'revision' })).toBe(true)
    await expect(page.getByText(invalidDropMessage, { exact: true })).toBeVisible({ timeout: 8_000 })
  })

  await recordAssertion(page, 'jujutsu-valid-branch-drop-is-cancelled-by-the-row-handler', async () =>
    expect(await dispatchDrop(page, { source: fixture.sourceDescription, target: fixture.targetDescription, kind: 'revision' })).toBe(true),
  )
  const branchPreview = page.getByRole('group', { name: 'Preview branch rebase', exact: true })
  await recordAssertion(page, 'jujutsu-rebase-drop-renders-context-and-host-preview', async () => {
    await expect(branchPreview).toBeVisible({ timeout: 8_000 })
    await expect(branchPreview).toContainText(fixture.sourceDescription)
    await expect(branchPreview).toContainText(fixture.childDescription)
    await expect(branchPreview).toContainText(fixture.targetDescription)
    await expect(branchPreview).toContainText('Jujutsu will rebase this revision and its descendants.')
    await expect(branchPreview.locator('pre')).toBeVisible()
    await expect(branchPreview.getByRole('button', { name: 'Confirm and run', exact: true })).toBeEnabled()
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

  await recordAssertion(page, 'jujutsu-cancelled-moves-preserve-commit-parents-and-bookmark-target', () =>
    expect(snapshotRepository(fixture)).toBe(before),
  )
  await finishJourneyAssertions(page)
})

Then('the revision context menu copies the exact change ID and commit ID', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const origin = new URL(page.url()).origin
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  const sourceButton = revisionRow(page, fixture.sourceDescription).getByRole('button').first()

  await sourceButton.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy full change ID', exact: true }).click()
  await recordAssertion(page, 'jujutsu-copy-change-id-uses-full-change-id', async () => {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(fixture.changeId)
    await expect(page.getByText('Full change ID copied.', { exact: true })).toBeVisible()
  })

  await sourceButton.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy commit ID (this revision)', exact: true }).click()
  await recordAssertion(page, 'jujutsu-copy-commit-id-uses-this-revision-commit-id', async () => {
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(fixture.commitId)
    await expect(page.getByText('Commit ID for this revision copied.', { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const fixture = fixtures.get(page)
  if (fixture === undefined) return
  fixtures.delete(page)
  await rm(fixture.temporaryRoot, { recursive: true, force: true })
})
