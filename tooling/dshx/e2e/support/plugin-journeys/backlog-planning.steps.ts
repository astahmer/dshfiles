import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { Schema } from 'effect'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { backlogLabel, backlogRef } from './backlog-refs.js'

const DAY_MS = 86_400_000
const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })
const table = (page: Page) => page.getByRole('table', { name: 'Backlog items', exact: true })
const viewButton = (page: Page, name: string) => page.getByRole('navigation', { name: 'Backlog views' }).getByRole('button', { name, exact: true })
const backlogCall = (page: Page) => connectDshxApi({ url: profileFor(page).url, packageId: '@dshfiles/backlog', apiId: 'backlog', version: 1 })

const pad = (value: number): string => String(value).padStart(2, '0')
/** A calendar date on this machine, which is also the scratch Host's. */
const dateOf = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const itemState = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({
    item: Schema.Struct({
      id: Schema.Number,
      title: Schema.String,
      status: Schema.String,
      due: Schema.optional(Schema.String),
      body: Schema.String,
      links: Schema.Array(Schema.Struct({ type: Schema.String, target: Schema.String, relation: Schema.optional(Schema.String) })),
      events: Schema.Array(Schema.Struct({ kind: Schema.String, detail: Schema.String })),
    }),
  }),
})

const readItem = async (page: Page, key: number | string) => Schema.decodeUnknownSync(itemState)(await (await backlogCall(page))('get', { id: key })).value.item

/** Opens an item from its Items row by its reference, clear of the row's pickers. */
const openFromItems = async (page: Page, ordinal: number): Promise<void> => {
  const label = await backlogLabel(page, ordinal)
  await viewButton(page, 'Items').click()
  await table(page)
    .getByRole('row', { name: `Item ${label}`, exact: true })
    .getByText(label, { exact: true })
    .click()
  await expect(peek(page)).toContainText(label)
}

const guidedFolders = new WeakMap<Page, string>()
const startedThreads = new WeakMap<Page, string>()

When('the criteria {string} are added in the inspector', async ({ page }: { page: Page }, criteria: string) => {
  const field = peek(page).getByRole('textbox', { name: 'New criterion', exact: true })
  for (const criterion of criteria.split(',').map(text => text.trim())) {
    await field.fill(criterion)
    await field.press('Enter')
    await expect(peek(page).getByRole('checkbox', { name: criterion, exact: true })).toBeVisible()
  }
})

When('the criterion {string} is checked in the inspector', async ({ page }: { page: Page }, criterion: string) => {
  const box = peek(page).getByRole('checkbox', { name: criterion, exact: true })
  await box.click()
  await expect(box).toBeChecked()
})

Then('the inspector shows criteria progress {string}', async ({ page }: { page: Page }, progress: string) => {
  await recordAssertion(page, 'backlog-criteria-rollup-inspector', async () => {
    await expect(peek(page).getByRole('region', { name: 'Acceptance criteria', exact: true })).toContainText(progress)
  })
})

Then('the Items view row of b:{int} shows criteria {string}', async ({ page }: { page: Page }, ordinal: number, progress: string) => {
  await recordAssertion(page, 'backlog-criteria-rollup-row', async () => {
    await viewButton(page, 'Items').click()
    const row = table(page).getByRole('row', { name: `Item ${await backlogLabel(page, ordinal)}`, exact: true })
    await expect(row.getByLabel('Acceptance criteria', { exact: true })).toHaveText(progress)
  })
  await finishJourneyAssertions(page)
})

Then(
  'the inspector shows b:{int} as a {string} titled {string} with criteria progress {string} and the template body',
  async ({ page }: { page: Page }, ordinal: number, kind: string, title: string, progress: string) => {
    await recordAssertion(page, 'backlog-template-capture', async () => {
      const label = await backlogLabel(page, ordinal)
      await expect(peek(page).getByRole('button', { name: `Kind of ${label}`, exact: true })).toContainText(kind)
      await expect(peek(page).getByRole('region', { name: 'Acceptance criteria', exact: true })).toContainText(progress)
      const item = await readItem(page, ordinal)
      expect(item.title).toBe(title)
      expect(item.body).toContain('## Steps to reproduce')
    })
    await finishJourneyAssertions(page)
  },
)

When('b:{int} was due yesterday', async ({ page }: { page: Page }, ordinal: number) => {
  await (
    await backlogCall(page)
  )('update', { id: ordinal, due: dateOf(Date.now() - DAY_MS) })
})

When('its due date is set to {string} in the inspector', async ({ page }: { page: Page }, choice: string) => {
  await peek(page)
    .getByRole('button', { name: /^Due date of b:/u })
    .click()
  await page.getByRole('menuitem', { name: new RegExp(`^${choice}`, 'u') }).click()
  await expect(peek(page).getByRole('button', { name: /^Due date of b:/u })).toContainText(choice)
})

Then('the Items view row of b:{int} shows the due chip {string}', async ({ page }: { page: Page }, ordinal: number, chip: string) => {
  await recordAssertion(page, 'backlog-due-chip-row', async () => {
    await viewButton(page, 'Items').click()
    const row = table(page).getByRole('row', { name: `Item ${await backlogLabel(page, ordinal)}`, exact: true })
    await expect(row.getByLabel(/^Due \d{4}-\d{2}-\d{2}$/u)).toContainText(chip)
  })
})

When('the Inbox is opened on its {string} tab', async ({ page }: { page: Page }, tab: string) => {
  await viewButton(page, 'Inbox').click()
  await page.getByRole('tab', { name: new RegExp(`^${tab}`, 'u') }).click()
})

Then('the Inbox lists {string} as overdue', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-overdue-inbox', async () => {
    await expect(page.getByText(`${title} is overdue`, { exact: false })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('b:{int} has the comment {string}', async ({ page }: { page: Page }, ordinal: number, text: string) => {
  await (
    await backlogCall(page)
  )('comment', { id: ordinal, text })
})

When('b:{int} is merged into b:{int} from its context menu', async ({ page }: { page: Page }, duplicate: number, survivor: number) => {
  await viewButton(page, 'Items').click()
  await table(page)
    .getByRole('row', { name: `Item ${await backlogLabel(page, duplicate)}`, exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^Merge into…/u }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Item to merge into', exact: true }).fill(await backlogLabel(page, survivor))
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

Then('b:{int} is dropped as a duplicate of b:{int}', async ({ page }: { page: Page }, duplicate: number, survivor: number) => {
  await recordAssertion(page, 'backlog-merge-duplicate-dropped', async () => {
    const dropped = await readItem(page, duplicate)
    expect(dropped.status).toBe('dropped')
    expect(dropped.links).toContainEqual(expect.objectContaining({ type: 'item', target: await backlogRef(page, survivor), relation: 'duplicates' }))
  })
})

Then('the reference b:{int} opens b:{int} with the moved comment', async ({ page }: { page: Page }, duplicate: number, survivor: number) => {
  await recordAssertion(page, 'backlog-merge-alias-redirect', async () => {
    const duplicateLabel = await backlogLabel(page, duplicate)
    const redirected = await readItem(page, duplicateLabel)
    expect(redirected.id).toBe(survivor)
    expect(redirected.events.some(event => event.kind === 'commented' && event.detail.startsWith(`Moved from ${duplicateLabel}`))).toBe(true)
    await openFromItems(page, survivor)
    await expect(peek(page)).toContainText('seen on Safari too')
  })
  await finishJourneyAssertions(page)
})

When('it is set to repeat {string} in the inspector', async ({ page }: { page: Page }, recurrence: string) => {
  const picker = peek(page).getByRole('button', { name: /^Repeat b:/u })
  await picker.click()
  await page.getByRole('menuitem', { name: recurrence, exact: true }).click()
  await expect(picker).toContainText(recurrence)
})

When('its status is set to {string} in the inspector', async ({ page }: { page: Page }, status: string) => {
  const picker = peek(page).getByRole('button', { name: /^Status of b:/u })
  await picker.click()
  await page.getByRole('menuitem', { name: new RegExp(`^${status}`, 'u') }).click()
  await expect(picker).toContainText(status)
})

Then('a new {string} item waits in Todo, due in a week', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-recurrence-next-occurrence', async () => {
    const listed = Schema.decodeUnknownSync(
      Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.Number, title: Schema.String, status: Schema.String, due: Schema.NullOr(Schema.String) })),
      }),
    )(await (await backlogCall(page))('list', { query: `"${title}"`, freshness: 'all' }))
    const next = listed.items.find(item => item.status === 'todo')
    expect(listed.items).toHaveLength(2)
    expect(next?.due).toBe(dateOf(Date.now() + 7 * DAY_MS))
    await viewButton(page, 'Items').click()
    await expect(table(page).getByRole('row', { name: `Item ${await backlogLabel(page, next?.id ?? 0)}`, exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('the project folder {string} has the agent guidance {string}', async ({ page }: { page: Page }, folder: string, guidance: string) => {
  const path = join(profileFor(page).homeRoot, folder)
  await mkdir(path, { recursive: true })
  guidedFolders.set(page, path)
  await (
    await backlogCall(page)
  )('setProjectGuidance', { project: path, guidance })
})

When('{string} is captured in the project folder {string}', async ({ page }: { page: Page }, text: string, folder: string) => {
  await (
    await backlogCall(page)
  )('capture', { text, project: guidedFolders.get(page) ?? join(profileFor(page).homeRoot, folder) })
})

When('a thread is started for b:{int} through the backlog API', async ({ page }: { page: Page }, ordinal: number) => {
  const started = Schema.decodeUnknownSync(Schema.Struct({ sessionId: Schema.String }))(
    await (
      await backlogCall(page)
    )('startThread', { ids: [ordinal], cwd: guidedFolders.get(page) ?? profileFor(page).homeRoot }),
  )
  startedThreads.set(page, started.sessionId)
})

Then("the started thread's first message opens with {string} and {string}", async ({ page }: { page: Page }, heading: string, guidance: string) => {
  await recordAssertion(page, 'backlog-guidance-start-thread', async () => {
    expect(startedThreads.get(page)).toMatch(/^session-/u)
    // The sidebar lists the thread before the feed row that shares its title.
    await page.getByText('Tidy the formatter', { exact: true }).first().click()
    await expect(page.getByText(heading, { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(guidance, { exact: false }).first()).toBeVisible()
  })
  await finishJourneyAssertions(page)
})

When('a {string} gate for tomorrow is added in the inspector', async ({ page }: { page: Page }, kind: string) => {
  const gates = peek(page).getByRole('region', { name: 'Gates', exact: true })
  await gates.getByRole('combobox', { name: 'Gate kind', exact: true }).click()
  await page.getByRole('option', { name: kind, exact: true }).click()
  const target = gates.getByRole('textbox', { name: 'Gate target', exact: true }).or(gates.getByLabel('Gate target', { exact: true }))
  await target.first().fill(dateOf(Date.now() + DAY_MS))
  await gates.getByRole('button', { name: 'Add gate', exact: true }).click()
  await expect(gates.getByRole('button', { name: /^Remove gate /u })).toHaveCount(1)
})

When('the pull request {string} is linked in the inspector', async ({ page }: { page: Page }, url: string) => {
  const pulls = peek(page).getByRole('region', { name: 'Pull requests', exact: true })
  const field = pulls.getByRole('textbox', { name: 'Pull request URL', exact: true })
  await field.fill(url)
  await field.press('Enter')
  await expect(pulls.getByRole('link', { name: /#579$/u })).toBeVisible()
})

Then('the inspector shows one open gate and the pull request as a plain link', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-gate-open-and-plain-pr', async () => {
    await expect(peek(page).getByRole('region', { name: 'Gates', exact: true }).getByLabel('Open', { exact: true })).toHaveCount(1)
    await expect(peek(page).getByRole('region', { name: 'Pull requests', exact: true })).toContainText('plain link')
  })
})

Then('the Ready view has no item', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-gate-not-ready', async () => {
    await expect(table(page).getByRole('row', { name: /^Item b:/u })).toHaveCount(0)
  })
})

When('the gate is removed in the inspector', async ({ page }: { page: Page }) => {
  const gates = peek(page).getByRole('region', { name: 'Gates', exact: true })
  await gates.getByRole('button', { name: /^Remove gate /u }).click()
  await expect(gates.getByRole('button', { name: /^Remove gate /u })).toHaveCount(0)
})

Then('the Ready view finally lists {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-gate-removed-ready', async () => {
    const rows = table(page).getByRole('row', { name: /^Item b:/u })
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

When('backlog item b:{int} is opened from the Items view', async ({ page }: { page: Page }, ordinal: number) => {
  await openFromItems(page, ordinal)
})

When('{string} is chosen from the context menu of b:{int}', async ({ page }: { page: Page }, action: string, ordinal: number) => {
  await table(page)
    .getByRole('row', { name: `Item ${await backlogLabel(page, ordinal)}`, exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: action, exact: true }).click()
})

Then('a notice says to enable Project automations or use automation_save', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-scheduled-rule-absent', async () => {
    const notice = page.getByRole('alert').filter({ hasText: 'Project automations' })
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('automation_save')
  })
  await finishJourneyAssertions(page)
})
