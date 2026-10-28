import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { tabPanelId } from '../../../../../plugins/@dshfiles/workbench/src/tab-panels.js'
import { connectDshxApi } from '../../../packages/dshx/src/platform/dshx-api.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'
import { When, Then } from '../bdd.js'
import { finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'

const title = { empty: 'Welcome empty thread', existing: 'Welcome existing chat' } as const
const draft = 'My draft belongs to this centered welcome, not the other chat'
const message = 'First real message from the centered welcome'
const created = z.object({ sessionId: z.string() })
const project = z.object({ projectId: z.string() })
interface WelcomeJourney {
  readonly empty: string
  readonly existing: string
}
const journeys = new WeakMap<Page, WelcomeJourney>()
const journey = (page: Page): WelcomeJourney => {
  const value = journeys.get(page)
  if (value === undefined) throw new Error('Welcome fixture has not created its real conversations')
  return value
}
const main = (page: Page): Locator => page.locator('[data-workbench-region="main"]')
const body = (page: Page, id: string): Locator => main(page).locator(`[data-workbench-panel-id=${JSON.stringify(tabPanelId(`thread:${id}`))}]`)
const own = (page: Page): Locator => body(page, journey(page).empty)
const content = (page: Page): Locator => own(page).locator('[data-conversation-content]')
const input = (page: Page): Locator =>
  own(page).getByRole('textbox', { name: /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/ })
const focus = async (page: Page, key: keyof WelcomeJourney): Promise<void> => {
  await main(page).getByRole('tab', { name: title[key], exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(journey(page)[key])
  await expect(body(page, journey(page)[key]).locator('[data-conversation-session]')).toHaveAttribute('data-conversation-session', journey(page)[key])
}
const welcome = async (page: Page): Promise<void> => {
  await expect(content(page)).toHaveAttribute('data-content-phase', 'hero')
  await expect(own(page).getByText('Into the Unknown', { exact: true })).toBeVisible()
  await expect(input(page)).toHaveCount(1)
  await expect(input(page)).toBeEditable()
  await expect(own(page).getByRole('button', { name: 'Choose workspace', exact: true })).toBeVisible()
  const geometry = await content(page).evaluate(element => {
    const rect = element.getBoundingClientRect()
    const editable = element.querySelector('[role="textbox"][contenteditable="true"]')?.getBoundingClientRect()
    const scroller = element.querySelector('[data-conversation-scroll]')
    return {
      height: rect.height,
      width: rect.width,
      scrollWidth: element.scrollWidth,
      centered: scroller === null ? false : getComputedStyle(scroller).justifyContent === 'center',
      inputTop: editable === undefined ? -1 : editable.top - rect.top,
      inputBottom: editable === undefined ? -1 : editable.bottom - rect.top,
      inputWidth: editable?.width ?? -1,
    }
  })
  expect(geometry.centered).toBe(true)
  expect(geometry.inputTop).toBeGreaterThan(geometry.height * 0.25)
  expect(geometry.inputBottom).toBeLessThan(geometry.height * 0.85)
  expect(geometry.inputWidth).toBeGreaterThan(100)
  expect(geometry.inputWidth).toBeLessThanOrEqual(geometry.width + 1)
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
}

When('a real empty fixed conversation and an existing chat are opened', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const call = await connectDshxApi({ url: profile.url, packageId: '@dshfiles/thread-sidebar', apiId: 'thread-actions', version: 1 })
  const path = join(profile.homeRoot, 'welcome-project')
  await mkdir(path)
  const projectId = project.parse(await call('projectRegister', { path, title: 'Welcome project' })).projectId
  const ids = {
    empty: created.parse(await call('create', { projectId, title: title.empty })).sessionId,
    existing: created.parse(await call('create', { projectId, title: title.existing, text: 'Existing chat owns this real message' })).sessionId,
  }
  journeys.set(page, ids)
  const route = new URL(profile.url)
  route.searchParams.set('thread', ids.empty)
  await page.goto(route.href)
  await page
    .locator(`article[data-thread-id=${JSON.stringify(ids.empty)}]`)
    .locator('button[data-thread-main-action]')
    .click({ position: { x: 24, y: 16 } })
  await focus(page, 'empty')
})

Then('the empty thread shows the native centered welcome and one scoped composer', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-empty-session-native-hero-geometry', async () => {
    await welcome(page)
    await page.screenshot({ path: test.info().outputPath('workbench-centered-new-thread.png'), animations: 'disabled' })
    await own(page).getByRole('button', { name: 'Choose workspace', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a project', exact: true })
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('option', { name: /Welcome project/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(input(page)).toBeEditable()
  })
})

Then('its welcome draft survives switching reload and a narrow split pane', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-welcome-preserves-scoped-draft-and-responsive-seat', async () => {
    await input(page).fill(draft)
    await welcome(page)
    await page
      .locator(`article[data-thread-id=${JSON.stringify(journey(page).existing)}]`)
      .locator('button[data-thread-main-action]')
      .click({ position: { x: 24, y: 16 } })
    await focus(page, 'existing')
    await expect(body(page, journey(page).existing).getByText('Existing chat owns this real message', { exact: true })).toBeVisible()
    await expect(body(page, journey(page).existing).locator('[data-content-phase="active"]')).toBeVisible()
    await focus(page, 'empty')
    await welcome(page)
    await expect(input(page)).toHaveText(draft)
    await StartupDialogs.reloadPastProviderSetup(page)
    await focus(page, 'empty')
    await welcome(page)
    await expect(input(page)).toHaveText(draft)
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    for (const width of [480, 360]) {
      await page.setViewportSize({ width, height: 850 })
      await welcome(page)
      await expect(input(page)).toHaveText(draft)
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await main(page).getByRole('button', { name: 'Pane options', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Split right', exact: true }).click()
    await focus(page, 'empty')
    await welcome(page)
    await expect(input(page)).toHaveText(draft)
    await page.screenshot({ path: test.info().outputPath('workbench-welcome-split.png'), animations: 'disabled' })
  })
})

When('its first real message is sent from the welcome composer', async ({ page }: { page: Page }) => {
  await input(page).fill(message)
  const original = await input(page).elementHandle()
  if (original === null) throw new Error('Native welcome editor did not mount')
  try {
    await input(page).press('Enter')
    await expect(content(page)).toHaveAttribute('data-content-phase', 'active')
    await expect(own(page).getByText(message, { exact: true })).toBeVisible()
    await recordAssertion(page, 'workbench-welcome-first-send-keeps-original-editor', async () => {
      expect(await input(page).evaluate((element, previous) => element === previous, original)).toBe(true)
      await expect(input(page)).toHaveText('')
      await expect.poll(() => new URL(page.url()).searchParams.get('thread')).toBe(journey(page).empty)
    })
  } finally {
    await original.dispose()
  }
})

Then('the same editor becomes a normal fixed conversation without the welcome', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-populated-session-remains-normal-fixed-chat', async () => {
    await expect(own(page).getByText('Into the Unknown', { exact: true })).toHaveCount(0)
    await expect(content(page)).toHaveAttribute('data-content-phase', 'active')
    await expect(input(page)).toHaveCount(1)
    await expect(input(page)).toBeVisible()
    await expect(own(page).getByRole('button', { name: 'Choose workspace', exact: true })).toHaveCount(0)
    await focus(page, 'existing')
    await focus(page, 'empty')
    await expect(content(page)).toHaveAttribute('data-content-phase', 'active')
    await expect(own(page).getByText(message, { exact: true })).toBeVisible()
  })
  await finishJourneyAssertions(page)
})
