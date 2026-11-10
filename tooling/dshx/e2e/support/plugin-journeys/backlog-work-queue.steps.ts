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

const feed = (page: Page) => page.getByRole('feed', { name: 'Backlog feed', exact: true })
const seededTitle = (index: number): string => `Seeded item ${String(index).padStart(3, '0')}`

When('{int} items are captured through the backlog API', async ({ page }: { page: Page }, count: number) => {
  const call = await backlogCall(page)
  // oxlint-disable-next-line no-await-in-loop -- one capture after another keeps the feed order the numbering expects.
  for (let index = 1; index <= count; index += 1) await call('capture', { text: seededTitle(index), project: null })
})

Then('the feed mounts the newest {int} of {int} items', async ({ page }: { page: Page }, shown: number, total: number) => {
  await recordAssertion(page, 'backlog-feed-first-page', async () => {
    await expect(feed(page).getByRole('article')).toHaveCount(shown)
    await expect(feed(page).getByRole('article').last()).toContainText(seededTitle(total))
    await expect(feed(page).getByRole('article').first()).toContainText(seededTitle(total - shown + 1))
  })
})

When('the feed is scrolled to its top', async ({ page }: { page: Page }) => {
  await feed(page).evaluate(element => {
    element.scrollTop = 0
  })
})

Then('the feed mounts all {int} items, oldest first', async ({ page }: { page: Page }, total: number) => {
  await recordAssertion(page, 'backlog-feed-older-page', async () => {
    await expect(feed(page).getByRole('article')).toHaveCount(total)
    await expect(feed(page).getByRole('article').first()).toContainText(seededTitle(1))
  })
  await finishJourneyAssertions(page)
})

const firstHolders = new WeakMap<Page, string>()
const backgroundThreads = new WeakMap<Page, { readonly sessionId: string; readonly title: string }>()
const BACKGROUND_THREAD_TITLE = 'Claiming agent'
const createdThread = Schema.Struct({ sessionId: Schema.String })
const attentionState = Schema.Struct({ sessions: Schema.Array(Schema.Struct({ sessionId: Schema.String })) })
const inboxRegion = (page: Page) => page.getByRole('region', { name: 'Inbox', exact: true })
const sidebarApi = (page: Page, apiId: string) => connectDshxApi({ url: profileFor(page).url, packageId: '@dshfiles/thread-sidebar', apiId, version: 1 })

When('the backlog Inbox also lists finished threads', async ({ page }: { page: Page }) => {
  const settings = await connectDshxApi({ url: profileFor(page).url, packageId: '@dshfiles/settings-shell', apiId: 'settings-shell', version: 1 })
  await settings('set', { namespace: 'dshfiles-backlog', patch: { inboxThreads: 'all' } })
})

// Started through the Host so this browser never shows the thread: viewing a finished thread acknowledges it.
When('an agent thread this browser never opened claims b:{int}', async ({ page }: { page: Page }, ordinal: number) => {
  const actions = await sidebarApi(page, 'thread-actions')
  const { sessionId } = Schema.decodeUnknownSync(createdThread)(await actions('create', { title: BACKGROUND_THREAD_TITLE }))
  const [provider = '', model = ''] = FAKE_MODEL.split('/')
  await actions('selectModel', { sessionId, provider, model })
  await actions('prompt', { sessionId, text: toolDirective('backlog_claim', { id: `b:${await backlogRef(page, ordinal)}` }) })
  await expect.poll(async () => (await readClaim(page, ordinal)).lease?.holder, { timeout: 30_000 }).toBe(`agent:${sessionId}`)
  const attention = await sidebarApi(page, 'thread-sidebar-attention')
  await expect
    .poll(async () => Schema.decodeUnknownSync(attentionState)(await attention('state')).sessions.some(entry => entry.sessionId === sessionId), {
      timeout: 30_000,
    })
    .toBe(true)
  backgroundThreads.set(page, { sessionId, title: BACKGROUND_THREAD_TITLE })
})

Then('the Inbox lists that agent thread under {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-inbox-thread-row', async () => {
    const thread = backgroundThreads.get(page)
    expect(thread).toBeDefined()
    const row = inboxRegion(page).getByRole('listitem').filter({ hasText: title })
    await expect(row.getByRole('button', { name: `Open thread ${thread?.title ?? ''}`, exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: `Acknowledge thread ${thread?.title ?? ''}`, exact: true })).toBeVisible()
  })
})

When('that agent thread is acknowledged from the Inbox', async ({ page }: { page: Page }) => {
  await inboxRegion(page)
    .getByRole('button', { name: `Acknowledge thread ${backgroundThreads.get(page)?.title ?? ''}`, exact: true })
    .click()
})

Then('the Inbox no longer lists {string} and the thread is read', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-inbox-thread-acknowledged', async () => {
    const thread = backgroundThreads.get(page)
    await expect(inboxRegion(page).getByRole('button', { name: `Acknowledge thread ${thread?.title ?? ''}`, exact: true })).toHaveCount(0)
    await expect(inboxRegion(page).getByRole('listitem').filter({ hasText: title })).toHaveCount(0)
    const attention = await sidebarApi(page, 'thread-sidebar-attention')
    const unread = Schema.decodeUnknownSync(attentionState)(await attention('state')).sessions.map(entry => entry.sessionId)
    expect(unread).not.toContain(thread?.sessionId)
  })
  await finishJourneyAssertions(page)
})

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
