import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test'
import { bootComposedPluginProfile } from '../boot.js'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'
import { StartupDialogs } from '../../../packages/dshx/src/project/startup-dialogs.js'

const FIRST = 'Workbench first conversation'
const SECOND = 'Workbench second conversation'
const DRAFT = 'Resident draft survives restored native child views'
const main = (page: Page): Locator => page.locator('[data-workbench-region="main"]').first()
const right = (page: Page): Locator => page.locator('[data-workbench-region="right"]').first()
const outerTab = (scope: Locator, name: string): Locator => scope.getByRole('tab', { name, exact: true })
const bodyOf = async (page: Page, tab: Locator): Promise<Locator> => {
  const id = await tab.locator('[data-workbench-tab-id]').getAttribute('data-workbench-tab-id')
  if (id === null) throw new Error('A genuine conversation tab has no panel identity')
  return page.locator(`[data-workbench-panel-id=${JSON.stringify(id)}]`)
}
const header = (body: Locator): Locator => body.locator('[data-slot="conversation.header"] header')
const input = (body: Locator): Locator => body.locator('[data-composer-input]').filter({ visible: true })
const conversations = new WeakMap<Page, { first: string; second: string; editor?: ElementHandle<HTMLElement | SVGElement> }>()
const identities = (page: Page) => {
  const ids = conversations.get(page)
  if (ids === undefined) throw new Error('Header identities were not captured from the real Session bodies')
  return ids
}
const sessionOf = async (body: Locator): Promise<string> => {
  const id = await body.locator('[data-conversation-session]').getAttribute('data-conversation-session')
  if (id === null) throw new Error('Fixed body has no original Session binding')
  return id
}
const more = async (page: Page, body: Locator): Promise<Locator> => {
  await header(body).getByRole('button', { name: 'More thread actions', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'More thread actions', exact: true })
  await expect(menu).toBeVisible()
  return menu
}
const pin = async (page: Page, body: Locator, name: 'Pin' | 'Unpin'): Promise<void> => {
  const direct = header(body).getByRole('button', { name, exact: true, includeHidden: true })
  if (await direct.isVisible()) {
    await direct.click()
    return
  }
  const menu = await more(page, body)
  const folded = menu.getByRole('menuitem', { name, exact: true })
  // The native header's ResizeObserver may unfold Pin while the real menu
  // opens. Respect that responsive placement; never force-click behind it.
  await expect.poll(async () => (await folded.isVisible()) || (await direct.isVisible())).toBe(true)
  if (await folded.isVisible()) await folded.click()
  else {
    await page.keyboard.press('Escape')
    await direct.click()
  }
}

Given('an isolated Workbench header profile with all original view providers is booted', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: [
      '@dshfiles/frame-layout',
      '@dshfiles/sidebar-right',
      '@dshfiles/workbench',
      '@dshfiles/main-tabs',
      '@dshfiles/thread-sidebar',
      '@dshfiles/workspace-folder-picker',
      '@dshfiles/session-controller',
      '@dshfiles/rich-composer',
      '@dshfiles/chat',
      '@dshfiles/multi-host',
      '@dshfiles/jj-integration',
      '@dshfiles/ai-accounts',
      '@dshfiles/command-palette',
      '@dshfiles/agent-preset',
      '@dshfiles/model-selection',
      '@dshfiles/jujutsu',
      '@dshfiles/traces',
    ],
    profileLabel: 'workbench-original-conversation-header',
    cordisPatch: '- id: dshfiles-traces\n  config:\n    port: 0\n',
  })
  await visitIsolatedPluginProfile(page, profile)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
})
Then('each fixed conversation has its original title actions and child-view header', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-original-header-under-fixed-session', async () => {
    const ids = { first: '', second: '' }
    for (const [key, title] of [
      ['first', FIRST],
      ['second', SECOND],
    ] as const) {
      const tab = outerTab(main(page), title)
      await tab.click()
      const body = await bodyOf(page, tab)
      ids[key] = await sessionOf(body)
      await expect(header(body)).toBeVisible()
      await expect(header(body).getByRole('button', { name: title, exact: true })).toBeVisible()
      await expect(header(body).getByRole('button', { name: 'More thread actions', exact: true })).toBeVisible()
      await expect(header(body).getByRole('button', { name: /^(Workspace actions for|Current thread workspace:)/ })).toBeVisible()
      await expect(header(body)).toContainText('Standard mode')
      for (const name of ['Chat', 'Trajectory', 'Traces', 'Requests']) await expect(header(body).getByRole('tab', { name, exact: true })).toBeVisible()
      await expect(body.locator('[data-composer-input]')).toHaveCount(1)
    }
    expect(ids.first).not.toBe(ids.second)
    await header(await bodyOf(page, outerTab(main(page), SECOND))).screenshot({
      path: test.info().outputPath('restored-conversation-header.png'),
      animations: 'disabled',
    })
    conversations.set(page, ids)
  })
})
When('the first conversation is moved aside through the restored header opener', async ({ page }: { page: Page }) => {
  const tab = outerTab(main(page), FIRST)
  await tab.click()
  const body = await bodyOf(page, tab)
  await header(body).getByRole('button', { name: 'Open right sidebar', exact: true }).click()
  await expect(right(page)).toBeVisible()
  await expect(header(body).getByRole('button', { name: 'Open right sidebar', exact: true })).toHaveCount(0)
  const from = await tab.boundingBox()
  const to = await right(page).locator('[data-workbench-surface]').first().boundingBox()
  if (from === null || to === null) throw new Error('No genuine conversation drag endpoints')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 14, from.y + from.height / 2, { steps: 3 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 24 })
  await page.mouse.up()
  await expect(outerTab(right(page), FIRST)).toBeVisible()
  await outerTab(right(page), 'New tab').getByRole('button', { name: 'Close New tab', exact: true }).click()
  await outerTab(main(page), SECOND).click()
})
Then('both visible headers address their own conversation and Pin and Copy target the first', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-header-actions-own-session-not-global', async () => {
    const ids = identities(page)
    const a = await bodyOf(page, outerTab(right(page), FIRST))
    const b = await bodyOf(page, outerTab(main(page), SECOND))
    await expect(header(a).getByRole('button', { name: FIRST, exact: true })).toBeVisible()
    await expect(header(b).getByRole('button', { name: SECOND, exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('thread')).toBe(ids.second)
    await (await more(page, a)).getByRole('menuitem', { name: 'Copy thread ID', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ids.first)
    await pin(page, a, 'Pin')
    const aMenu = await more(page, a)
    await expect(aMenu.getByRole('menuitem', { name: 'Copy thread link', exact: true })).toBeVisible()
    for (const label of ['Park', 'Mute thread', 'Continue in project', 'Archive', 'Referenced by'])
      await expect(aMenu.getByRole('menuitem', { name: label, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await pin(page, a, 'Unpin')
    await input(a).fill(DRAFT)
    const editor = await input(a).elementHandle()
    if (editor === null) throw new Error('No original resident editor after move')
    ids.editor = editor
  })
})
Then('native child views switch independently without replacing the resident editor', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-native-child-view-selection-and-editor-continuity', async () => {
    const ids = identities(page)
    const a = await bodyOf(page, outerTab(right(page), FIRST))
    const b = await bodyOf(page, outerTab(main(page), SECOND))
    for (const name of ['Trajectory', 'Traces', 'Requests', 'Chat']) {
      await header(a).getByRole('tab', { name, exact: true }).click()
      await expect(header(a).getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(header(b).getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true')
      if (name === 'Traces') await expect(a.getByTestId('traces-session-view')).toHaveAttribute('data-session-id', ids.first)
      if (name === 'Requests') await expect(a.getByTestId('requests-session-view')).toHaveAttribute('data-session-id', ids.first)
      await expect(input(a)).toHaveText(DRAFT)
      expect(await input(a).evaluate((element, original) => element === original, ids.editor)).toBe(true)
    }
    await page.screenshot({ path: test.info().outputPath('restored-original-conversation-header.png'), animations: 'disabled' })
  })
})
Then('the header remains usable with its Workbench tab row hidden and after reload', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'workbench-header-hidden-row-and-reload', async () => {
    const ids = identities(page)
    const tab = outerTab(right(page), FIRST)
    const a = await bodyOf(page, tab)
    await tab.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Hide tab row', exact: true }).click()
    await expect(tab).toHaveCount(0)
    await header(a).getByRole('button', { name: 'More thread actions', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Copy thread ID', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await header(a).getByRole('tab', { name: 'Traces', exact: true }).click()
    await StartupDialogs.reloadPastProviderSetup(page)
    const restored = right(page)
      .locator(`[data-workbench-thread]`)
      .filter({ has: page.locator(`[data-conversation-session=${JSON.stringify(ids.first)}]`) })
    await expect(header(restored)).toBeVisible()
    await expect(header(restored).getByRole('tab', { name: 'Traces', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(input(restored)).toHaveText(DRAFT)
    await header(restored).getByRole('tab', { name: 'Chat', exact: true }).click()
    await right(page).getByRole('button', { name: 'Show tab row', exact: true }).click()
    await right(page).getByRole('button', { name: 'Close pane', exact: true }).click()
    await outerTab(main(page), SECOND).click()
    const b = await bodyOf(page, outerTab(main(page), SECOND))
    await expect(header(b).getByRole('button', { name: 'Open right sidebar', exact: true })).toBeVisible()
    const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
    if (await collapse.isVisible()) await collapse.click()
    for (const width of [360, 480, 768, 1024]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(header(b).getByRole('button', { name: 'More thread actions', exact: true })).toBeInViewport()
      await (await more(page, b)).getByRole('menuitem', { name: 'Copy thread ID', exact: true }).click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(ids.second)
      await header(b).getByRole('tab', { name: 'Requests', exact: true }).click()
      await expect(b.getByTestId('requests-session-view')).toHaveAttribute('data-session-id', ids.second)
      await header(b).getByRole('tab', { name: 'Chat', exact: true }).click()
      if (width === 360) {
        await page.screenshot({ path: test.info().outputPath('restored-conversation-header-360.png'), animations: 'disabled' })
        await header(b).screenshot({ path: test.info().outputPath('restored-conversation-header-narrow.png'), animations: 'disabled' })
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 })
  })
  await finishJourneyAssertions(page)
})
