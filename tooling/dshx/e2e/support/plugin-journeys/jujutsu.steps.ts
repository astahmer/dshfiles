import { expect, type Page } from '@playwright/test'
import { globalPanelLink } from '../plugin-view-names.js'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'

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

const revisionRow = (page: Page, description: string) =>
  page.getByRole('region', { name: 'Revisions', exact: true }).first().locator('article').filter({ hasText: description })

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

const selectRepository = async (page: Page, fixture: JujutsuFixture): Promise<void> => {
  await page.evaluate(({ key, path }) => localStorage.setItem(key, JSON.stringify(path)), { key: 'dshfiles.jujutsu.selected', path: fixture.repositoryPath })
  await page.reload()
  await globalPanelLink(page, 'Jujutsu: Revision graph').first().click()
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
  await rm(fixture.temporaryRoot, { recursive: true, force: true })
})

/** The repository state before the cleanup dialog opened, so its preview is proven to remove nothing. */
const cleanupSnapshots = new WeakMap<Page, string>()

When('the repository actions menu opens the workspace cleanup', async ({ page }: { page: Page }) => {
  cleanupSnapshots.set(page, snapshotRepository(fixtureFor(page)))
  await page.getByRole('button', { name: 'Repository actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Clean up thread workspaces…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Clean up thread workspaces', exact: true })).toBeVisible({ timeout: 10_000 })
})

Then('a custom cleanup threshold previews workspaces without removing anything', async ({ page }: { page: Page }) => {
  const fixture = fixtureFor(page)
  const dialog = page.getByRole('dialog', { name: 'Clean up thread workspaces', exact: true })
  const customHours = dialog.getByRole('spinbutton', { name: 'Custom hours', exact: true })
  await customHours.fill('12')
  await expect(customHours).toHaveValue('12')
  await expect(dialog.getByRole('radio', { name: '6h', exact: true })).toHaveAttribute('aria-checked', 'false')
  await recordAssertion(page, 'jujutsu-cleanup-custom-threshold-previews-before-removing', async () =>
    expect(dialog.getByText(/empty revisions? will be abandoned/)).toBeVisible({ timeout: 20_000 }),
  )
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(snapshotRepository(fixture)).toBe(cleanupSnapshots.get(page))
  await expect(revisionRow(page, fixture.sourceDescription)).toBeVisible()
  await finishJourneyAssertions(page)
})
