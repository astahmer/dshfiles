import { expect, type Page } from '@playwright/test'
import { Option, Schema } from 'effect'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { sendMessage, startThreadWithModel } from '../threads.js'
import { backlogLabel, backlogRef } from './backlog-refs.js'

const FAKE_MODEL = 'commandcode_work/gpt-6-luna'
const toolDirective = (tool: string, input: object): string => `[[call ${tool} ${JSON.stringify(input)}]]`
const peek = (page: Page) => page.getByRole('complementary', { name: 'Item detail' })
const table = (page: Page) => page.getByRole('table', { name: 'Backlog items', exact: true })
const viewButton = (page: Page, name: string) => page.getByRole('navigation', { name: 'Backlog views' }).getByRole('button', { name, exact: true })

const backlogCall = (page: Page) => connectDshxApi({ url: profileFor(page).url, packageId: '@dshfiles/backlog', apiId: 'backlog', version: 1 })

const claimState = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({
    item: Schema.Struct({ delegate: Schema.optional(Schema.String), events: Schema.Array(Schema.Struct({ detail: Schema.String })) }),
    lease: Schema.NullOr(Schema.Struct({ holder: Schema.String })),
  }),
})

const readClaim = async (page: Page, ordinal: number) => {
  const call = await backlogCall(page)
  const result = Schema.decodeUnknownOption(claimState)(await call('get', { id: ordinal }))
  if (Option.isNone(result)) throw new Error(`Backlog item number ${String(ordinal)} has no readable claim state.`)
  return result.value.value
}

/** How the panel names an agent: `Agent` and the first six characters of its thread id. */
const agentName = (actorId: string): string => `Agent ${actorId.replace(/^agent:(session-)?/u, '').slice(0, 6)}`

When('{string} is captured as a work item', async ({ page }: { page: Page }, text: string) => {
  const capture = page.getByRole('textbox', { name: 'Capture', exact: true })
  await capture.fill(text)
  await capture.press('Enter')
  await expect(capture).toHaveText('')
})

Then('the inspector shows b:{int} with priority {string}', async ({ page }: { page: Page }, ordinal: number, priority: string) => {
  await recordAssertion(page, 'backlog-priority-inspector', async () => {
    await expect(peek(page).getByRole('button', { name: `Priority of ${await backlogLabel(page, ordinal)}`, exact: true })).toContainText(priority)
  })
})

Then('the search results list only {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-priority-search', async () => {
    const results = page.getByRole('list', { name: 'Search results' })
    await expect(results.getByRole('listitem', { name: /^Item b:/u })).toHaveCount(1)
    await expect(results).toContainText(title)
  })
  await finishJourneyAssertions(page)
})

When('b:{int} depends on b:{int}', async ({ page }: { page: Page }, waiting: number, blocker: number) => {
  const call = await backlogCall(page)
  await call('link', { id: waiting, link: { type: 'item', target: await backlogRef(page, blocker), relation: 'depends-on' } })
})

When('the priority of b:{int} is set to {string} with its key in the Items view', async ({ page }: { page: Page }, ordinal: number, priority: string) => {
  const keys: Record<string, string> = { 'No priority': '0', Urgent: '1', High: '2', Medium: '3', Low: '4' }
  await viewButton(page, 'Items').click()
  const label = await backlogLabel(page, ordinal)
  const picker = table(page).getByRole('button', { name: `Priority of ${label}`, exact: true })
  await picker.click()
  await page
    .getByRole('menu')
    .last()
    .press(keys[priority] ?? '0')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

When('the Ready view is opened', async ({ page }: { page: Page }) => {
  await viewButton(page, 'Ready').click()
  await expect(table(page)).toBeVisible()
})

Then('the Ready view lists {string} in that order', async ({ page }: { page: Page }, titles: string) => {
  await recordAssertion(page, `backlog-ready-order-${titles.split(',')[0]?.trim().toLowerCase().replace(/\W+/gu, '-') ?? ''}`, async () => {
    const expected = titles.split(',').map(title => title.trim())
    const rows = table(page).getByRole('row', { name: /^Item b:/u })
    await expect(rows).toHaveCount(expected.length)
    for (const [index, title] of expected.entries()) await expect(rows.nth(index)).toContainText(title)
  })
  if (titles.startsWith('Tidy')) await finishJourneyAssertions(page)
})

When('the sub-issue {string} is added in the inspector', async ({ page }: { page: Page }, title: string) => {
  await peek(page).getByRole('button', { name: 'Add sub-issue', exact: true }).click()
  const field = page.getByRole('textbox', { name: 'Sub-issue title', exact: true })
  await field.fill(title)
  await field.press('Enter')
  await expect(peek(page).getByRole('list', { name: 'Sub-issue list', exact: true })).toContainText(title)
})

Then('the inspector shows sub-issue progress {string}', async ({ page }: { page: Page }, progress: string) => {
  await recordAssertion(page, `backlog-sub-issue-progress-${progress.replace(/\W+/gu, '-')}`, async () => {
    await expect(peek(page).getByRole('region', { name: 'Sub-issues', exact: true })).toContainText(progress)
  })
  if (progress.startsWith('1/')) await finishJourneyAssertions(page)
})

When('the sub-issue {string} is opened and marked {string}', async ({ page }: { page: Page }, title: string, status: string) => {
  await peek(page).getByRole('list', { name: 'Sub-issue list', exact: true }).getByRole('button').filter({ hasText: title }).click()
  const statusPicker = peek(page).getByRole('button', { name: /^Status of b:/u })
  await expect(peek(page).getByRole('button', { name: /^Parent b:/u })).toBeVisible()
  await statusPicker.click()
  await page.getByRole('menuitem', { name: new RegExp(`^${status}`, 'u') }).click()
  await expect(statusPicker).toContainText(status)
})

When('its parent is opened from the inspector', async ({ page }: { page: Page }) => {
  await peek(page)
    .getByRole('button', { name: /^Parent b:/u })
    .click()
  await expect(peek(page).getByRole('region', { name: 'Sub-issues', exact: true })).toBeVisible()
})

const firstHolders = new WeakMap<Page, string>()

When('an agent thread claims b:{int}', async ({ page }: { page: Page }, ordinal: number) => {
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, toolDirective('backlog_claim', { id: `b:${await backlogRef(page, ordinal)}` }))
  const claim = await readClaim(page, ordinal)
  expect(claim.lease?.holder).toBe(claim.item.delegate)
  firstHolders.set(page, claim.lease?.holder ?? '')
})

When('another agent thread tries to claim b:{int}', async ({ page }: { page: Page }, ordinal: number) => {
  await startThreadWithModel(page, { project: 'Default workspace', model: FAKE_MODEL })
  await sendMessage(page, toolDirective('backlog_claim', { id: `b:${await backlogRef(page, ordinal)}` }))
})

Then('the inspector shows b:{int} claimed by the first agent thread only', async ({ page }: { page: Page }, ordinal: number) => {
  await recordAssertion(page, 'backlog-claim-conflict-refused', async () => {
    const holder = firstHolders.get(page) ?? ''
    const claim = await readClaim(page, ordinal)
    expect(holder).toMatch(/^agent:/u)
    expect(claim.lease?.holder).toBe(holder)
    expect(claim.item.delegate).toBe(holder)
    expect(claim.item.events.filter(event => event.detail.includes('claimed by')).length).toBe(1)
    await expect(peek(page).getByLabel(`Claimed by ${agentName(holder)}`, { exact: true })).toBeVisible()
    await expect(peek(page).getByRole('button', { name: /^Status of b:/u })).toContainText('In progress')
    await expect(
      peek(page)
        .getByLabel('Ownership', { exact: true })
        .getByLabel(/^Agent (done|working|stale)$/u),
    ).toBeVisible()
  })
})

When('the claim is released in the inspector', async ({ page }: { page: Page }) => {
  await peek(page).getByRole('button', { name: 'Release', exact: true }).click()
})

Then('the inspector shows b:{int} unclaimed in {string}', async ({ page }: { page: Page }, ordinal: number, status: string) => {
  await recordAssertion(page, 'backlog-claim-released', async () => {
    await expect(peek(page).getByLabel(/^Claimed by /u)).toHaveCount(0)
    await expect(peek(page).getByRole('button', { name: `Status of ${await backlogLabel(page, ordinal)}`, exact: true })).toContainText(status)
    const claim = await readClaim(page, ordinal)
    expect(claim.lease).toBeNull()
    expect(claim.item.delegate).toBeUndefined()
  })
  await finishJourneyAssertions(page)
})
