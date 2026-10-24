import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { connectDshxApi, type DshxApiCall } from '../../../packages/dshx/src/platform/dshx-api.js'

const projectSchema = z.object({ projectId: z.string() })
const createdSchema = z.object({ sessionId: z.string() })
const nativeCreatedSchema = z.object({ result: z.object({ ok: z.literal(true), value: createdSchema }) })
const listedSchema = z.object({ threads: z.array(z.object({ sessionId: z.string(), projectId: z.string().optional() })) })
const journeys = new WeakMap<Page, { call: DshxApiCall; alpha: string; beta: string }>()
const sidebar = (page: Page): Locator => page.getByRole('region', { name: 'Threads', exact: true })
const selectedThread = (page: Page): string | null => new URL(page.url()).searchParams.get('thread')
const projectHeader = (page: Page, name: string): Locator => sidebar(page).getByRole('region', { name, exact: true })

const createFromHeader = async (page: Page, button: Locator, key?: 'Enter' | 'Space'): Promise<string> => {
  const responsePromise = page.waitForResponse(
    response => response.request().method() === 'POST' && response.request().postData()?.includes('session/create') === true,
  )
  if (key === undefined) await button.click()
  else {
    await button.focus()
    await button.press(key)
  }
  const response = await responsePromise
  const { sessionId } = nativeCreatedSchema.parse(await response.json()).result.value
  await expect.poll(() => selectedThread(page)).toBe(sessionId)
  await expect(page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })).toBeVisible()
  return sessionId
}

When('two local projects have conversations and the sidebar is grouped by project', async ({ page }: { page: Page }) => {
  const profile = profileFor(page)
  const call = await connectDshxApi({ url: profile.url, packageId: '@dshfiles/thread-sidebar', apiId: 'thread-actions', version: 1 })
  const alphaPath = join(profile.homeRoot, 'projects', 'alpha')
  const betaPath = join(profile.homeRoot, 'projects', 'beta')
  await mkdir(alphaPath, { recursive: true })
  await mkdir(betaPath, { recursive: true })
  const alpha = projectSchema.parse(await call('projectRegister', { path: alphaPath, title: 'Alpha project' })).projectId
  const beta = projectSchema.parse(await call('projectRegister', { path: betaPath, title: 'Beta project' })).projectId
  await call('create', { projectId: alpha, text: 'Alpha project conversation' })
  const betaThread = createdSchema.parse(await call('create', { projectId: beta, text: 'Beta project conversation' })).sessionId
  await sidebar(page).getByRole('group', { name: 'Thread list view', exact: true }).getByRole('button', { name: 'All threads', exact: true }).click()
  await sidebar(page).getByRole('button', { name: 'Group: Status', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Project', exact: true }).click()
  const row = sidebar(page).locator(`article[data-thread-id="${betaThread}"]`)
  await row
    .locator(':scope > div > button')
    .first()
    .click({ position: { x: 24, y: 16 } })
  await expect.poll(() => selectedThread(page)).toBe(betaThread)
  await expect(sidebar(page).getByRole('button', { name: 'New chat in Alpha project', exact: true })).toBeVisible()
  journeys.set(page, { call, alpha, beta })
})

Then('the project header plus creates in its own project without toggling collapse', async ({ page }: { page: Page }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('The project-header journey was not prepared.')
  await recordAssertion(page, 'project-header-chat-collapsed-target', async () => {
    const group = projectHeader(page, 'Alpha project')
    const collapse = group.getByRole('button', { expanded: true })
    await collapse.click()
    const collapsed = group.getByRole('button', { expanded: false })
    await expect(collapsed).toBeVisible()
    const sessionId = await createFromHeader(page, group.getByRole('button', { name: 'New chat in Alpha project', exact: true }))
    await expect(collapsed).toBeVisible()
    await expect
      .poll(async () => listedSchema.parse(await journey.call('list', {})).threads.find(thread => thread.sessionId === sessionId)?.projectId)
      .toBe(journey.alpha)
    await expect(page.getByRole('button', { name: 'Choose workspace', exact: true })).toHaveText('Alpha project')
  })
  await finishJourneyAssertions(page)
})

Then('the project header plus works with keyboard activation and a narrow sidebar', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('The project-header journey was not prepared.')
  await recordAssertion(page, 'project-header-chat-keyboard-and-narrow-layout', async () => {
    // Resize the window rather than assuming the sidebar fills the viewport.
    await page.setViewportSize({ width: 480, height: 838 })
    // The native shell collapses navigation at mobile widths; reveal it as a user would.
    const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true })
    // Wait for the responsive transition instead of reading isVisible before React applies it.
    await expandSidebar.click()
    const group = projectHeader(page, 'Beta project')
    const create = group.getByRole('button', { name: 'New chat in Beta project', exact: true })
    await expect(create).toBeVisible()
    const geometry = await create.boundingBox()
    const sidebarGeometry = await sidebar(page).boundingBox()
    if (geometry === null || sidebarGeometry === null) throw new Error('The project header has no visible layout box.')
    expect(geometry.x).toBeGreaterThanOrEqual(sidebarGeometry.x)
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(sidebarGeometry.x + sidebarGeometry.width + 1)
    for (const key of ['Enter', 'Space'] as const) {
      const sessionId = await createFromHeader(page, create, key)
      if (await expandSidebar.isVisible()) await expandSidebar.click()
      await expect(group.getByRole('button', { expanded: true })).toBeVisible()
      await expect
        .poll(async () => listedSchema.parse(await journey.call('list', {})).threads.find(thread => thread.sessionId === sessionId)?.projectId)
        .toBe(journey.beta)
    }
    const longTitle = 'Beta project with a very long title that should truncate instead of hiding the new chat button'
    await journey.call('projectRename', { projectId: journey.beta, title: longTitle })
    for (const width of [360, 480, 768, 1024]) {
      await page.setViewportSize({ width, height: 838 })
      const longCreate = sidebar(page).getByRole('button', { name: `New chat in ${longTitle}`, exact: true })
      await expect(async () => {
        if (await expandSidebar.isVisible()) await expandSidebar.click()
        await expect(longCreate).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      const buttonBox = await longCreate.boundingBox()
      const paneBox = await sidebar(page).boundingBox()
      if (buttonBox === null || paneBox === null) throw new Error(`The project-header layout is missing at ${width}px.`)
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1)
      expect(buttonBox.x).toBeGreaterThanOrEqual(paneBox.x)
      const title = sidebar(page).getByText(longTitle, { exact: true }).first()
      expect(await title.evaluate(element => getComputedStyle(element).textOverflow)).toBe('ellipsis')
    }
    await journey.call('projectRename', { projectId: journey.beta, title: 'Beta project' })
    await expect(create).toBeVisible()
    expect(await sidebar(page).locator('button button').count()).toBe(0)
    expect(browserDiagnosticsFor(page).filter(line => /pageerror:|slot entry crashed|Failed to load plugins/.test(line))).toEqual([])
    await expect(page.locator('[data-slot-error]')).toHaveCount(0)
    // Keep the evidence focused on the controls; omit machine labels and other conversation metadata.
    const pane = await sidebar(page).boundingBox()
    const lastHeader = await group.locator('[data-thread-section-header]').boundingBox()
    if (pane === null || lastHeader === null) throw new Error('The project headers have no screenshot bounds.')
    await page.screenshot({
      path: $testInfo.outputPath('project-header-chat.png'),
      animations: 'disabled',
      clip: { x: pane.x, y: pane.y, width: pane.width, height: lastHeader.y + lastHeader.height - pane.y },
    })
  })
  await finishJourneyAssertions(page)
})
