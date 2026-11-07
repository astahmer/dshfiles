import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { threadWorkspacePathFor } from './jj-integration.steps.js'

/** The thread panel's Changes facet (pulls-review): one region per thread, Land card on top. */
const facet = (page: Page) => page.getByTestId('changes-facet').filter({ visible: true }).first()
const landCard = (page: Page) => facet(page).getByTestId('land-card')

const jjDescription = (workspace: string, revision: string): string => {
  const result = spawnSync('jj', ['log', '--no-graph', '--ignore-working-copy', '-r', revision, '-T', 'description.first_line()'], {
    cwd: workspace,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`jj log failed in the thread workspace: ${result.stderr.slice(0, 300)}`)
  return result.stdout.trim()
}

const jjInWorkspace = (workspace: string, args: readonly string[]): void => {
  const result = spawnSync('jj', ['--config', 'user.name=Changes E2E', '--config', 'user.email=changes-e2e@example.invalid', ...args], {
    cwd: workspace,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`jj failed in the thread workspace: ${result.stderr.slice(0, 300)}`)
}

const combinedSteps = new WeakMap<Page, number>()
const combined = (page: Page) => facet(page).getByTestId('combined-review')
const revisionDescription = (file: string): string => `Add ${file}`
const revisionRow = (page: Page, description: string) => page.locator('article[data-commit-id]').filter({ visible: true }).filter({ hasText: description })
const rowButton = (page: Page, description: string) => revisionRow(page, description).locator('[data-row-focus]')

When('the Changes facet is opened from the composer changes bar', async ({ page }: { page: Page }) => {
  await page
    .getByRole('button', { name: /^Review workspace changes: / })
    .filter({ visible: true })
    .first()
    .click()
  await expect(facet(page)).toBeVisible({ timeout: 30_000 })
})

When('the Edited files card of turn {int} is opened', async ({ page }: { page: Page }, turn: number) => {
  const reviewButtons = page.getByRole('button', { name: 'Review this turn’s changes in the sidebar', exact: true })
  await expect(page.getByText(/^Edited /).nth(turn - 1)).toBeVisible({ timeout: 60_000 })
  if (turn <= (await reviewButtons.count())) await reviewButtons.nth(turn - 1).click()
  else
    await page
      .getByText(/^Edited [\w.-]+$/)
      .nth(turn - 1)
      .click()
  await expect(facet(page)).toBeVisible({ timeout: 30_000 })
})

Then('the Changes facet shows {string} with {int} changed file(s)', async ({ page }: { page: Page }, scope: string, count: number) => {
  await recordAssertion(page, `pulls-review-changes-${scope.toLowerCase().replace(/\W+/gu, '-')}-${String(count)}`.slice(0, 64), async () => {
    const choice = facet(page).getByRole('radio', { name: scope, exact: true })
    await expect(choice).toHaveAttribute('aria-checked', 'true')
    await expect(facet(page).getByTestId('changes-summary')).toContainText(count === 1 ? '1 file' : `${String(count)} files`, { timeout: 30_000 })
    await expect(facet(page).getByRole('list', { name: 'Changed files', exact: true }).getByRole('listitem')).toHaveCount(count)
  })
})

When('the {string} scope is chosen in the Changes facet', async ({ page }: { page: Page }, scope: string) => {
  await facet(page).getByRole('radio', { name: scope, exact: true }).click()
})

When('{string} is marked viewed in the Changes facet', async ({ page }: { page: Page }, file: string) => {
  await facet(page)
    .getByRole('checkbox', { name: `Mark viewed: ${file}`, exact: true })
    .click()
})

Then('the Changes facet reads {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, `pulls-review-changes-reads-${text.replace(/\W+/gu, '-')}`.slice(0, 64), async () => {
    await expect(facet(page).getByText(text, { exact: true })).toBeVisible({ timeout: 30_000 })
  })
})

Then('the viewed mark of {string} survives a reload', async ({ page }: { page: Page }, file: string) => {
  await recordAssertion(page, 'pulls-review-changes-viewed-mark-is-host-owned', async () => {
    await page.reload()
    await page
      .getByRole('button', { name: /^Review workspace changes: / })
      .filter({ visible: true })
      .first()
      .click()
    await expect(facet(page).getByRole('checkbox', { name: `Mark not viewed: ${file}`, exact: true })).toBeChecked({ timeout: 30_000 })
  })
})

When('line {int} of {string} is commented {string}', async ({ page }: { page: Page }, line: number, file: string, text: string) => {
  // The diff renders in an open shadow root; its line-number cells select lines, as a reviewer clicks them.
  await facet(page)
    .locator(`[data-diff-path="${file}"]`)
    .locator(`[data-column-number="${String(line)}"]`)
    .first()
    .click()
  const box = facet(page).getByRole('textbox', { name: 'Comment on the selected lines', exact: true })
  await box.fill(text)
  await facet(page).getByRole('button', { name: 'Add to next message', exact: true }).click()
  await expect(facet(page).getByText('Added to your next message.', { exact: true })).toBeVisible()
})

Then('the composer holds the line comment chip {string}', async ({ page }: { page: Page }, label: string) => {
  await recordAssertion(page, 'pulls-review-changes-comment-chip', async () => {
    await expect(page.getByText(label).filter({ visible: true }).first()).toBeVisible()
  })
})

Then('the Land card offers to land {int} revision(s) on {string}', async ({ page }: { page: Page }, count: number, bookmark: string) => {
  await recordAssertion(page, 'pulls-review-land-card-ready', async () => {
    await expect(landCard(page)).toContainText(`${String(count)} revision${count === 1 ? '' : 's'} to land`, { timeout: 30_000 })
    await expect(
      landCard(page).getByRole('button', { name: `Land ${String(count)} revision${count === 1 ? '' : 's'} on ${bookmark}`, exact: true }),
    ).toBeEnabled({
      timeout: 30_000,
    })
  })
})

When('the work described {string} is landed from the Land card', async ({ page }: { page: Page }, description: string) => {
  await landCard(page)
    .getByRole('button', { name: /^Land \d+ revisions? on / })
    .click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(description)
  await dialog.getByRole('button', { name: /^Land on / }).click()
})

Then('main moves onto the work described {string} and the Land card has nothing left', async ({ page }: { page: Page }, description: string) => {
  await recordAssertion(page, 'pulls-review-land-card-landed', async () => {
    await expect(landCard(page)).toContainText(/Landed 1 revision on main\./u, { timeout: 120_000 })
    expect(jjDescription(threadWorkspacePathFor(page), 'main')).toBe(description)
    await expect(landCard(page)).toContainText('Nothing to land', { timeout: 30_000 })
  })
  await finishJourneyAssertions(page)
})

When(
  'the thread workspace holds revisions adding {string}, {string} and {string}',
  async ({ page }: { page: Page }, first: string, second: string, third: string) => {
    const workspace = threadWorkspacePathFor(page)
    for (const file of [first, second, third]) {
      await writeFile(join(workspace, file), `${file} line\n`)
      jjInWorkspace(workspace, ['describe', '--message', revisionDescription(file)])
      jjInWorkspace(workspace, ['new'])
    }
  },
)

When('the revision graph is opened in the thread panel', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await page.locator('[data-sidebar-right-guide-entry]').filter({ hasText: 'Jujutsu' }).first().click()
  await expect(page.getByRole('region', { name: 'Revisions', exact: true }).filter({ visible: true })).toBeVisible({ timeout: 30_000 })
})

When('the revision adding {string} is selected for review with a modifier click', async ({ page }: { page: Page }, file: string) => {
  await rowButton(page, revisionDescription(file)).click({ modifiers: ['ControlOrMeta'], timeout: 30_000 })
  await expect(revisionRow(page, revisionDescription(file))).toHaveAttribute('data-review-selected', 'true')
})

When('the revision adding {string} is selected for review from its menu', async ({ page }: { page: Page }, file: string) => {
  await rowButton(page, revisionDescription(file)).click({ button: 'right', timeout: 30_000 })
  await page.getByRole('menuitem', { name: 'Select for review', exact: true }).click()
  await expect(revisionRow(page, revisionDescription(file))).toHaveAttribute('data-review-selected', 'true')
})

When('the revision described {string} is selected for review', async ({ page }: { page: Page }, description: string) => {
  await rowButton(page, description).click({ modifiers: ['ControlOrMeta'], timeout: 30_000 })
  await expect(revisionRow(page, description)).toHaveAttribute('data-review-selected', 'true')
})

When('the selection is extended to the revision described {string}', async ({ page }: { page: Page }, description: string) => {
  await rowButton(page, description).click({ modifiers: ['Shift'], timeout: 30_000 })
  await expect(revisionRow(page, description)).toHaveAttribute('data-review-selected', 'true')
})

Then('the graph reads {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'jujutsu-review-selection-count', async () => {
    await expect(page.getByTestId('revision-review-selection').filter({ visible: true })).toContainText(text)
  })
})

When('the selection is reviewed together', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Review together', exact: true }).filter({ visible: true }).click()
})

Then('the Changes facet shows the combined review of {int} revisions with a gap', async ({ page }: { page: Page }, count: number) => {
  await recordAssertion(page, 'pulls-review-combined-revisions-opened', async () => {
    await expect(facet(page).getByRole('radio', { name: 'Revisions', exact: true })).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 })
    await expect(combined(page).getByTestId('combined-summary')).toContainText(`${String(count)} revisions`, { timeout: 30_000 })
    await expect(combined(page).locator('[data-revision-commit]')).toHaveCount(count)
    await expect(combined(page).getByText(/These revisions are not adjacent/u)).toBeVisible()
  })
})

Then('the combined review is on revision {int} of {int} showing {string}', async ({ page }: { page: Page }, index: number, count: number, file: string) => {
  // The journey comes back to a revision, and each evidence assertion needs its own id.
  const step = (combinedSteps.get(page) ?? 0) + 1
  combinedSteps.set(page, step)
  await recordAssertion(page, `pulls-review-combined-step-${String(step)}-revision-${String(index)}`, async () => {
    await expect(combined(page).getByTestId('combined-current')).toContainText(`Revision ${String(index)} of ${String(count)}:`)
    await expect(combined(page).getByTestId('combined-current')).toContainText(revisionDescription(file))
    await expect(combined(page).locator(`[data-diff-path="${file}"]`)).toBeVisible({ timeout: 30_000 })
    await expect(combined(page).locator('[data-diff-path]')).toHaveCount(1)
  })
})

When('the next revision is shown in the combined review', async ({ page }: { page: Page }) => {
  await combined(page).getByRole('button', { name: 'Next revision', exact: true }).click()
})

When('{string} is opened from the combined review', async ({ page }: { page: Page }, file: string) => {
  await combined(page).getByRole('button', { name: file, exact: true }).click()
})

When('{string} of the first revision is marked viewed in the combined review', async ({ page }: { page: Page }, file: string) => {
  await combined(page)
    .getByRole('checkbox', { name: new RegExp(`^Mark viewed: ${file.replace('.', '\\.')} in `, 'u') })
    .click()
})

Then('the combined review reads {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, 'pulls-review-combined-viewed', async () => {
    await expect(combined(page).getByTestId('combined-summary')).toContainText(text, { timeout: 30_000 })
  })
})

Then('the Review page shows the combined review of {int} revisions', async ({ page }: { page: Page }, count: number) => {
  await recordAssertion(page, 'pulls-review-combined-page', async () => {
    const review = page.getByTestId('combined-review').filter({ visible: true })
    await expect(review.getByTestId('combined-summary')).toContainText(`${String(count)} revisions`, { timeout: 30_000 })
    await expect(review.locator('[data-revision-commit]')).toHaveCount(count)
  })
})

When('the Review page goes back to the workspace review', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Back to workspace review', exact: true }).filter({ visible: true }).click()
})

Then('the combined review is gone from the Review page', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'pulls-review-combined-page-left', async () => {
    await expect(page.getByTestId('combined-review')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Review', exact: true }).filter({ visible: true })).toBeVisible()
  })
})

Then('the Changes journey is complete', async ({ page }: { page: Page }) => {
  await finishJourneyAssertions(page)
})
