import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { tabPanelId } from '../../../../../plugins/@dshfiles/workbench/src/tab-panels.js'
import { Then, When } from '../bdd.js'
import { recordAssertion } from '../steps.js'

const names = { first: 'Workbench first conversation', second: 'Workbench second conversation', third: 'Workbench third conversation' } as const
const drafts = {
  first: 'Unsent draft owned by the first fixed conversation',
  second: 'Unsent draft owned by the second fixed conversation',
  third: 'Unsent draft owned by the third fixed conversation',
} as const
const main = (page: Page): Locator => page.locator('[data-slot="shell.main"]')
const tab = (page: Page, name: string): Locator => main(page).getByRole('tab', { name, exact: true })
const composer = (body: Locator): Locator => body.getByRole('textbox', { name: 'Message or run a task, / commands, @ files or sessions', exact: true })
const conversations = new WeakMap<Page, Record<keyof typeof names, string>>()

const body = (page: Page, id: string): Locator => main(page).locator(`[data-workbench-panel-id=${JSON.stringify(tabPanelId(`thread:${id}`))}]`)
const identity = async (page: Page, name: string): Promise<string> => {
  const row = page.locator('article[data-thread-id]').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) })
  await expect(row).toHaveCount(1)
  const id = await row.getAttribute('data-thread-id')
  if (id === null) throw new Error(`Missing real Session identity for ${name}`)
  return id
}
const selected = async (page: Page, key: keyof typeof names, ids: Record<keyof typeof names, string>): Promise<void> => {
  await expect(tab(page, names[key])).toHaveCount(1)
  await expect(tab(page, names[key])).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(ids[key])
  const own = body(page, ids[key])
  await expect(own.getByText(names[key], { exact: true })).toBeVisible()
  await expect(composer(own)).toBeVisible()
  await expect(composer(own)).toHaveAttribute('contenteditable', 'true')
  await expect(composer(own)).toHaveText(drafts[key])
}
const focus = async (page: Page, key: keyof typeof names, ids: Record<keyof typeof names, string>): Promise<void> => {
  await tab(page, names[key]).click()
  await selected(page, key, ids)
}
const reopen = async (page: Page, key: keyof typeof names, ids: Record<keyof typeof names, string>): Promise<void> => {
  await page
    .locator(`article[data-thread-id=${JSON.stringify(ids[key])}]`)
    .locator('button[data-thread-main-action]')
    .click({ position: { x: 24, y: 16 } })
  await selected(page, key, ids)
}
const close = async (page: Page, key: keyof typeof names): Promise<void> => {
  await tab(page, names[key])
    .getByRole('button', { name: `Close ${names[key]}`, exact: true })
    .click()
  await expect(tab(page, names[key])).toHaveCount(0)
}

When('a third real Workbench conversation has its own draft', async ({ page }: { page: Page }) => {
  const previous = new URL(page.url()).searchParams.get('thread')
  const create = page.locator('[data-workbench-region="left"]').getByRole('button', { name: 'New thread', exact: true }).filter({ visible: true })
  await expect(create).toHaveCount(1)
  await create.click()
  await expect
    .poll(() => {
      const id = new URL(page.url()).searchParams.get('thread')
      return id !== null && id !== previous
    })
    .toBe(true)
  const third = new URL(page.url()).searchParams.get('thread')
  if (third === null) throw new Error('Third conversation has no native identity')
  const own = body(page, third)
  // A genuinely empty fixed Session now owns the native welcome, not the
  // populated-chat placeholder. Keep later active/draft assertions unchanged.
  await expect(own.locator('[data-conversation-content]')).toHaveAttribute('data-content-phase', 'hero')
  const welcomeInput = own.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
  await expect(welcomeInput).toBeVisible()
  await expect(welcomeInput).toHaveAttribute('contenteditable', 'true')
  await welcomeInput.fill(names.third)
  await welcomeInput.press('Enter')
  await expect(own.getByText(names.third, { exact: true })).toBeVisible()
  await expect(own.getByRole('status').filter({ hasText: /^(Completed|Failed|Stopped|Cancelled)$/ })).toHaveCount(1, { timeout: 60_000 })
  await expect(composer(own)).toHaveAttribute('contenteditable', 'true')
  await composer(own).fill(drafts.third)
  const ids = { first: await identity(page, names.first), second: await identity(page, names.second), third }
  conversations.set(page, ids)
  await selected(page, 'third', ids)
})

Then('closing inactive and active Workbench tabs preserves the correct existing conversations', async ({ page }) => {
  const ids = conversations.get(page)
  if (ids === undefined) throw new Error('Real conversation setup missing')
  const errors: string[] = []
  const onError = (error: Error): void => {
    if (errors.length < 6) errors.push(error.message.slice(0, 400))
  }
  page.on('pageerror', onError)
  try {
    await recordAssertion(page, 'inactive-close-active-neighbor-close-all-reopen', async () => {
      // A is deliberately not B's automatic right neighbor. An inactive B close
      // must never focus B first and silently select C instead of keeping A.
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await focus(page, 'first', ids)
        const visited: Array<string | null> = []
        const onNavigate = (): void => {
          visited.push(new URL(page.url()).searchParams.get('thread'))
        }
        page.on('framenavigated', onNavigate)
        try {
          await close(page, 'second')
          await selected(page, 'first', ids)
          expect(visited).not.toContain(ids.second)
        } finally {
          page.off('framenavigated', onNavigate)
        }
        await expect(tab(page, names.third)).toHaveCount(1)
        await reopen(page, 'second', ids)
      }
      await focus(page, 'third', ids)
      // Closing the active tab may select an existing neighbor, never a new or
      // retargeted conversation. Compute that neighbor from the public tab order.
      const order = await main(page)
        .getByRole('tab')
        .evaluateAll(elements =>
          elements.map(element => element.querySelector('[data-workbench-tab-id]')?.getAttribute('data-workbench-tab-id')).filter(id => id?.startsWith('tab/')),
        )
      const index = order.indexOf(tabPanelId(`thread:${ids.third}`))
      const next = order[index + 1] ?? order[index - 1]
      const nextKey = (['first', 'second'] as const).find(key => tabPanelId(`thread:${ids[key]}`) === next)
      if (nextKey === undefined) throw new Error('Active close has no existing conversation neighbor')
      await close(page, 'third')
      await selected(page, nextKey, ids)
      for (const key of ['first', 'second'] as const) await close(page, key)
      await expect(main(page).locator('[data-conversation-session]').filter({ visible: true })).toHaveCount(0)
      await expect(main(page).getByRole('region', { name: 'Choose a view', exact: true })).toBeVisible()
      await reopen(page, 'first', ids)
      await expect(tab(page, names.second)).toHaveCount(0)
      await expect(tab(page, names.third)).toHaveCount(0)
      expect(errors).toEqual([])
    })
  } catch (error) {
    const state = await page.evaluate(() => ({
      thread: new URL(location.href).searchParams.get('thread'),
      tabs: [...document.querySelectorAll('[data-workbench-tab-id]')].map(element => ({
        id: element.getAttribute('data-workbench-tab-id'),
        selected: element.closest('[role="tab"]')?.getAttribute('aria-selected'),
      })),
      sessions: [...document.querySelectorAll('[data-conversation-session]')].map(element => ({
        id: element.getAttribute('data-conversation-session'),
        visible: getComputedStyle(element).visibility,
        height: element.getBoundingClientRect().height,
      })),
    }))
    const path = test.info().outputPath('close-ownership.json')
    await writeFile(path, JSON.stringify({ failure: String(error).slice(0, 1600), expected: ids, state, errors }, null, 2))
    await test.info().attach('close-ownership', { path, contentType: 'application/json' })
    throw error
  } finally {
    page.off('pageerror', onError)
  }
})
