import { expect, type Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { After, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, sendMessage, startThreadWithModel } from '../threads.js'

const STORAGE_KEY = 'dshfiles.diffViewed.v1'
const roots = new WeakMap<Page, string>()
const checks = new WeakMap<Page, number>()
/** The same state is asserted more than once in a journey; evidence ids must stay unique. */
const checkId = (page: Page, name: string): string => {
  const index = (checks.get(page) ?? 0) + 1
  checks.set(page, index)
  return `diff-viewed-${String(index)}-${name}`.slice(0, 64)
}

const writeDirective = (path: string): string => `[[call write ${JSON.stringify({ file_path: path, content: `${path} written at ${String(Date.now())}\n` })}]]`
const progress = (page: Page) => page.getByText(/^\d+\/\d+ viewed$/)
const viewedBox = (page: Page, file: string) => page.getByRole('checkbox', { name: new RegExp(`^Mark ${file.replace('.', '\\.')} as (not )?viewed$`) })

const reviewFile = async (page: Page, file: string): Promise<void> => {
  const chooser = page.getByRole('button', { name: 'Choose the file to review', exact: true })
  if ((await chooser.textContent())?.includes(file) === true) return
  await chooser.click()
  await page.getByRole('option', { name: new RegExp(`^${file.replace('.', '\\.')}`) }).or(page.getByRole('menuitem', { name: new RegExp(`^${file.replace('.', '\\.')}`) })).first().click()
  await expect(chooser).toContainText(file)
}

/** A turn that edited several files offers a review button; a one-file turn shows a card naming that file. */
const openReview = async (page: Page, turn: number): Promise<void> => {
  const reviewButtons = page.getByRole('button', { name: 'Review this turn’s changes in the sidebar', exact: true })
  await expect(page.getByText(/^Edited /).nth(turn - 1)).toBeVisible()
  if (turn <= (await reviewButtons.count())) await reviewButtons.nth(turn - 1).click()
  else await page.getByText(/^Edited [\w.-]+$/).last().click()
  await expect(page.getByRole('tab', { name: `Review · turn ${String(turn)} Close`, exact: true })).toHaveAttribute('aria-selected', 'true')
}

When('the fake model writes {string} and {string} in a fresh review workspace', async ({ page }: { page: Page }, first: string, second: string) => {
  const root = await createScratchDirectory('dshx-diff-viewed-e2e-')
  roots.set(page, root)
  const workspace = join(root, 'review-project')
  await mkdir(workspace)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'review-project', model: 'commandcode_work/gpt-6-luna' })
  await sendMessage(page, `${writeDirective(first)} ${writeDirective(second)}`)
})

When('the fake model rewrites {string} in a second turn', async ({ page }: { page: Page }, file: string) => {
  await sendMessage(page, writeDirective(file))
})

When('turn {int} is reviewed', async ({ page }: { page: Page }, turn: number) => {
  await openReview(page, turn)
})

When('{string} is marked as viewed', async ({ page }: { page: Page }, file: string) => {
  await reviewFile(page, file)
  await viewedBox(page, file).check()
})

When('{string} is marked as not viewed', async ({ page }: { page: Page }, file: string) => {
  await reviewFile(page, file)
  await viewedBox(page, file).uncheck()
})

When('the viewed marks already hold {int} older marks', async ({ page }: { page: Page }, count: number) => {
  await page.evaluate(
    ({ key, total }) => localStorage.setItem(key, JSON.stringify(Array.from({ length: total }, (_, index) => JSON.stringify(['older-session', index, `old-${String(index)}.txt`])))),
    { key: STORAGE_KEY, total: count },
  )
})

When('the viewed marks in storage are corrupted', async ({ page }: { page: Page }) => {
  await page.evaluate(key => localStorage.setItem(key, '{"not":"a list"'), STORAGE_KEY)
})

When('the page is reloaded and turn {int} is reviewed', async ({ page }: { page: Page }, turn: number) => {
  await page.reload()
  await openReview(page, turn)
})

Then('the review shows {string}', async ({ page }: { page: Page }, text: string) => {
  await recordAssertion(page, checkId(page, `progress-${text.replace(/\W+/g, '-')}`), () => expect(progress(page)).toHaveText(text))
})

Then('{string} reads as {string}', async ({ page }: { page: Page }, file: string, state: string) => {
  await reviewFile(page, file)
  await recordAssertion(page, checkId(page, `${file.replace(/\W+/g, '-')}-${state.replace(/\W+/g, '-')}`), async () => {
    if (state === 'viewed') await expect(viewedBox(page, file)).toBeChecked()
    else await expect(viewedBox(page, file)).not.toBeChecked()
  })
})

Then('the review journey is complete', async ({ page }: { page: Page }) => {
  await finishJourneyAssertions(page)
})

Then('the oldest stored mark was evicted to keep {int}', async ({ page }: { page: Page }, cap: number) => {
  await recordAssertion(page, 'diff-viewed-retention-evicts-the-oldest-mark', async () => {
    const stored: unknown = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), STORAGE_KEY)
    expect(Array.isArray(stored) && stored.length).toBe(cap)
    expect(Array.isArray(stored) && stored.includes(JSON.stringify(['older-session', 0, 'old-0.txt']))).toBe(false)
    expect(Array.isArray(stored) && stored.includes(JSON.stringify(['older-session', 1, 'old-1.txt']))).toBe(true)
  })
})

Then('a mark made in another tab shows here without a reload', async ({ page }: { page: Page }) => {
  const otherTab = await page.context().newPage()
  try {
    await otherTab.goto(page.url())
    const preview = otherTab.getByRole('dialog', { name: 'Preview Notice', exact: true })
    if (await preview.isVisible()) await preview.getByRole('button', { name: 'Continue', exact: true }).click()
    await otherTab.getByRole('treeitem', { name: /^Fake thread title/ }).first().click()
    await openReview(otherTab, 1)
    await reviewFile(otherTab, 'beta.txt')
    await viewedBox(otherTab, 'beta.txt').check()
    await expect(progress(otherTab)).toHaveText('2/2 viewed')
  } finally {
    await otherTab.close()
  }
  await recordAssertion(page, 'diff-viewed-adopts-marks-from-another-tab', () => expect(progress(page)).toHaveText('2/2 viewed'))
  await finishJourneyAssertions(page)
})

After(async ({ page }: { page: Page }) => {
  const root = roots.get(page)
  if (root === undefined) return
  roots.delete(page)
  await rm(root, { recursive: true, force: true })
})
