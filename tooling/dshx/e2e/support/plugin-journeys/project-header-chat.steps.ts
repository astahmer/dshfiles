import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { hostname } from 'node:os'
import { z } from 'zod'
import { Then, When } from '../bdd.js'
import { browserDiagnosticsFor, finishJourneyAssertions, profileFor, recordAssertion } from '../steps.js'
import { connectDshxApi, type DshxApiCall } from '../../../packages/dshx/src/platform/dshx-api.js'

const projectSchema = z.object({ projectId: z.string() })
const createdSchema = z.object({ sessionId: z.string() })
const listedSchema = z.object({ threads: z.array(z.object({ sessionId: z.string(), projectId: z.string().optional() })) })
interface HeaderJourney {
  call: DshxApiCall
  alpha: string
  beta: string
  betaThread: string
  alphaDraft?: string
  secondAlphaDraft?: string
  betaDraft?: string
}
const journeys = new WeakMap<Page, HeaderJourney>()
const sidebar = (page: Page): Locator => page.getByRole('region', { name: 'Threads', exact: true })
const selectedThread = (page: Page): string | null => new URL(page.url()).searchParams.get('thread')
const projectHeader = (page: Page, name: string): Locator => sidebar(page).getByRole('region', { name, exact: true })
const composer = (page: Page): Locator => page.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
const row = (page: Page, id: string): Locator => sidebar(page).locator(`article[data-thread-id="${id}"]`)
const openRow = async (page: Page, id: string): Promise<void> => {
  await row(page, id)
    .locator(':scope > div > button')
    .first()
    .click({ position: { x: 24, y: 16 } })
  await expect.poll(() => selectedThread(page)).toBe(id)
}

const createFromHeader = async (page: Page, button: Locator, key?: 'Enter' | 'Space'): Promise<string> => {
  const previous = selectedThread(page)
  if (key === undefined) await button.click()
  else {
    await button.focus()
    await button.press(key)
  }
  await expect.poll(() => selectedThread(page)).not.toBe(previous)
  const id = selectedThread(page)
  if (id === null) throw new Error('New chat did not publish its local identity.')
  await expect(composer(page)).toBeVisible()
  return id
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
  await openRow(page, betaThread)
  await expect(sidebar(page).getByRole('button', { name: 'New chat in Alpha project', exact: true })).toBeVisible()
  journeys.set(page, { call, alpha, beta, betaThread })
})

Then('the project header plus creates in its own project without toggling collapse', async ({ page }: { page: Page }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('The project-header journey was not prepared.')
  await recordAssertion(page, 'project-header-chat-collapsed-target', async () => {
    const group = projectHeader(page, 'Alpha project')
    await group.getByRole('button', { expanded: true }).click()
    const collapsed = group.getByRole('button', { expanded: false })
    const creates: string[] = []
    const observe = (request: import('@playwright/test').Request): void => {
      if (request.method() === 'POST' && request.postData()?.includes('session/create') === true) creates.push(request.url())
    }
    page.on('request', observe)
    try {
      const sessionId = await createFromHeader(page, group.getByRole('button', { name: 'New chat in Alpha project', exact: true }))
      await expect(collapsed).toBeVisible()
      await expect(page.getByRole('button', { name: 'Choose workspace', exact: true })).toHaveText('Alpha project')
      expect(listedSchema.parse(await journey.call('list', {})).threads.some(thread => thread.sessionId === sessionId)).toBe(false)
      await collapsed.click()
      await expect(row(page, sessionId)).toContainText('New chat')
      await openRow(page, journey.betaThread)
      await expect(row(page, sessionId)).toHaveCount(0)
      expect(creates).toEqual([])
      await page.reload()
      expect(listedSchema.parse(await journey.call('list', {})).threads.some(thread => thread.sessionId === sessionId)).toBe(false)
      await expect(row(page, sessionId)).toHaveCount(0)
    } finally {
      page.off('request', observe)
    }
  })
  await finishJourneyAssertions(page)
})

Then('the project header plus works with keyboard activation and a narrow sidebar', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('The project-header journey was not prepared.')
  await recordAssertion(page, 'project-header-chat-keyboard-and-narrow-layout', async () => {
    await page.setViewportSize({ width: 480, height: 838 })
    const expandSidebar = page.getByRole('button', { name: 'Expand sidebar', exact: true })
    await expandSidebar.click()
    const group = projectHeader(page, 'Beta project')
    const create = group.getByRole('button', { name: 'New chat in Beta project', exact: true })
    for (const key of ['Enter', 'Space'] as const) {
      const sessionId = await createFromHeader(page, create, key)
      if (await expandSidebar.isVisible()) await expandSidebar.click()
      await expect(group.getByRole('button', { expanded: true })).toBeVisible()
      await expect(row(page, sessionId)).toContainText('New chat')
      expect(listedSchema.parse(await journey.call('list', {})).threads.some(thread => thread.sessionId === sessionId)).toBe(false)
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
      mask: [page.getByText(hostname(), { exact: true })],
    })
  })
  await finishJourneyAssertions(page)
})

Then('typing saves independent unsent project chats that reopen from All threads', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('The project-header journey was not prepared.')
  const alphaCreate = sidebar(page).getByRole('button', { name: 'New chat in Alpha project', exact: true })
  const betaCreate = sidebar(page).getByRole('button', { name: 'New chat in Beta project', exact: true })
  const fillDraft = async (id: string, text: string, projectId: string): Promise<void> => {
    await composer(page).fill(text)
    await expect(row(page, id)).toContainText(`Draft: ${text}`)
    await expect.poll(async () => listedSchema.parse(await journey.call('list', {})).threads.find(thread => thread.sessionId === id)?.projectId).toBe(projectId)
  }
  await recordAssertion(page, 'typed-project-drafts-save-before-send', async () => {
    journey.alphaDraft = await createFromHeader(page, alphaCreate)
    await expect(row(page, journey.alphaDraft)).toContainText('New chat')
    // Whitespace remains temporary and makes no Host conversation.
    await composer(page).fill('   ')
    expect(listedSchema.parse(await journey.call('list', {})).threads.some(thread => thread.sessionId === journey.alphaDraft)).toBe(false)
    await fillDraft(journey.alphaDraft, 'First unfinished Alpha prompt', journey.alpha)
    journey.secondAlphaDraft = await createFromHeader(page, alphaCreate)
    expect(journey.secondAlphaDraft).not.toBe(journey.alphaDraft)
    await expect(composer(page)).toHaveText('')
    await fillDraft(journey.secondAlphaDraft, 'Second unfinished Alpha prompt', journey.alpha)
    journey.betaDraft = await createFromHeader(page, betaCreate)
    await fillDraft(journey.betaDraft, 'Unfinished Beta prompt', journey.beta)
    await openRow(page, journey.betaThread)
    await expect(row(page, journey.alphaDraft)).toContainText('Draft: First unfinished Alpha prompt')
    await expect(row(page, journey.secondAlphaDraft)).toContainText('Draft: Second unfinished Alpha prompt')
    await expect(row(page, journey.betaDraft)).toContainText('Draft: Unfinished Beta prompt')
  })
  await recordAssertion(page, 'typed-project-drafts-restore-after-reload', async () => {
    if (journey.alphaDraft === undefined || journey.secondAlphaDraft === undefined || journey.betaDraft === undefined)
      throw new Error('Draft identities missing.')
    await page.reload()
    await openRow(page, journey.secondAlphaDraft)
    await expect(composer(page)).toHaveText('Second unfinished Alpha prompt')
    await openRow(page, journey.betaDraft)
    await expect(composer(page)).toHaveText('Unfinished Beta prompt')
    await openRow(page, journey.alphaDraft)
    await expect(composer(page)).toHaveText('First unfinished Alpha prompt')
    await page.mouse.move(1200, 750)
    await sidebar(page).screenshot({
      path: $testInfo.outputPath('typed-project-drafts.png'),
      animations: 'disabled',
      mask: [page.getByText(hostname(), { exact: true })],
    })
  })
  await finishJourneyAssertions(page)
})

Then('sending one draft leaves other unsent chats intact and New chat stays fresh', async ({ page }: { page: Page }) => {
  const journey = journeys.get(page)
  if (journey?.alphaDraft === undefined || journey.betaDraft === undefined || journey.secondAlphaDraft === undefined) throw new Error('Draft journey missing.')
  await composer(page).press('Enter')
  await expect(page.getByText('This turn failed', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  await recordAssertion(page, 'project-header-starts-new-draft-after-send', async () => {
    const freshId = await createFromHeader(page, sidebar(page).getByRole('button', { name: 'New chat in Alpha project', exact: true }))
    expect(freshId).not.toBe(journey.alphaDraft)
    await expect(composer(page)).toHaveText('')
    expect(listedSchema.parse(await journey.call('list', {})).threads.some(thread => thread.sessionId === freshId)).toBe(false)
  })
  await recordAssertion(page, 'project-header-keeps-other-drafts-after-send', async () => {
    const { secondAlphaDraft, betaDraft } = journey
    if (secondAlphaDraft === undefined || betaDraft === undefined) throw new Error('Draft identities missing.')
    await openRow(page, secondAlphaDraft)
    await expect(composer(page)).toHaveText('Second unfinished Alpha prompt')
    await openRow(page, betaDraft)
    await expect(composer(page)).toHaveText('Unfinished Beta prompt')
    const globalDraft = await createFromHeader(
      page,
      page.getByRole('navigation', { name: 'Sidebar navigation' }).getByRole('button', { name: 'New thread', exact: true }),
    )
    await composer(page).fill('Global New thread is saved while typing too')
    await expect(row(page, globalDraft)).toContainText('Draft: Global New thread is saved while typing too')
    await expect
      .poll(async () => listedSchema.parse(await journey.call('list', {})).threads.find(thread => thread.sessionId === globalDraft)?.projectId)
      .toBe(journey.beta)
  })
  expect(browserDiagnosticsFor(page).filter(line => /pageerror:|slot entry crashed|Failed to load plugins/.test(line))).toEqual([])
  await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  await finishJourneyAssertions(page)
})

Then('model and preset choices remain local until typing creates the chat', async ({ page, $testInfo }: { page: Page; $testInfo: TestInfo }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('The project-header journey was not prepared.')
  const requests: string[] = []
  const observe = (request: import('@playwright/test').Request): void => {
    const body = request.postData()
    if (body !== null && /session\/(create|selectModel|prompt)|agentPresets\/select/.test(body)) requests.push(body)
  }
  page.on('request', observe)
  try {
    const id = await createFromHeader(page, sidebar(page).getByRole('button', { name: 'New chat in Alpha project', exact: true }))
    await recordAssertion(page, 'pretyping-model-and-preset-stay-local', async () => {
      const modelTrigger = page.getByRole('button', { name: /^Select model/ })
      await expect(modelTrigger).toBeVisible()
      await modelTrigger.click()
      const modelCell = page.getByRole('menuitem', { name: /^Model / })
      if (await modelCell.isVisible()) await modelCell.click()
      const alternate = page.getByRole('menu', { name: 'Model', exact: true }).getByRole('menuitemradio', { checked: false }).first()
      await expect(alternate).toBeVisible()
      const modelName = await alternate.getAttribute('title')
      if (modelName === null) throw new Error('The catalog model has no label.')
      await alternate.click()
      await expect(modelTrigger).toHaveAttribute('aria-label', new RegExp(modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      await page.getByRole('button', { name: 'Standard mode', exact: true }).click()
      await page.getByRole('menuitem').filter({ hasText: 'Creator mode' }).click()
      await expect(page.getByRole('button', { name: 'Creator mode', exact: true })).toBeVisible()
      expect(requests).toEqual([])
      expect(listedSchema.parse(await journey.call('list', {})).threads.some(thread => thread.sessionId === id)).toBe(false)
      await page.screenshot({
        path: $testInfo.outputPath('draft-selection-before-typing.png'),
        animations: 'disabled',
        mask: [page.getByText(hostname(), { exact: true })],
      })
    })
    await recordAssertion(page, 'pretyping-choices-apply-before-first-send', async () => {
      await composer(page).fill('Pretyping choices proof')
      await composer(page).press('Enter')
      await expect(page.getByText('This turn failed', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
      const creation = requests.findIndex(body => body.includes('session/create'))
      const selection = requests.findIndex(body => body.includes('session/selectModel'))
      const prompt = requests.findIndex(body => body.includes('session/prompt'))
      expect(creation).toBeGreaterThanOrEqual(0)
      expect(selection).toBeGreaterThan(creation)
      expect(prompt).toBeGreaterThan(selection)
      expect(requests[creation]).toContain('cordis')
      expect(requests.filter(body => body.includes('session/create'))).toHaveLength(1)
      expect(requests.filter(body => body.includes('session/selectModel'))).toHaveLength(1)
    })
  } finally {
    page.off('request', observe)
  }
  expect(browserDiagnosticsFor(page).filter(line => /pageerror:|slot entry crashed|Failed to load plugins/.test(line))).toEqual([])
  await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  await finishJourneyAssertions(page)
})

Then('the compact model picker stages its selection without creating an empty chat', async ({ page }: { page: Page }) => {
  const journey = journeys.get(page)
  if (journey === undefined) throw new Error('The project-header journey was not prepared.')
  const requests: string[] = []
  const observe = (request: import('@playwright/test').Request): void => {
    const body = request.postData()
    if (body !== null && /session\/(create|selectModel|prompt)/.test(body)) requests.push(body)
  }
  page.on('request', observe)
  try {
    await recordAssertion(page, 'compact-picker-stages-local-model', async () => {
      const id = await createFromHeader(page, sidebar(page).getByRole('button', { name: 'New chat in Alpha project', exact: true }))
      const trigger = page.getByRole('button').filter({ has: page.locator('[data-model-picker-text]') })
      await expect(trigger).toBeVisible()
      await trigger.click()
      const alternate = page.getByRole('list', { name: 'Models grouped by provider' }).getByRole('button', { pressed: false }).first()
      await expect(alternate).toBeVisible()
      const chosenLabel = await alternate.locator('span').first().innerText()
      await alternate.click()
      await expect(page.locator('[data-model-picker-text]')).toHaveText(chosenLabel)
      await page.keyboard.press('Escape')
      expect(requests).toEqual([])
      expect(listedSchema.parse(await journey.call('list', {})).threads.some(thread => thread.sessionId === id)).toBe(false)
      await composer(page).fill('Compact picker draft proof')
      await expect
        .poll(async () => listedSchema.parse(await journey.call('list', {})).threads.find(thread => thread.sessionId === id)?.projectId)
        .toBe(journey.alpha)
      await expect.poll(() => requests.filter(body => body.includes('session/selectModel')).length).toBe(1)
      expect(requests.filter(body => body.includes('session/create'))).toHaveLength(1)
      expect(requests.some(body => body.includes('session/prompt'))).toBe(false)
    })
  } finally {
    page.off('request', observe)
  }
  expect(browserDiagnosticsFor(page).filter(line => /pageerror:|slot entry crashed|Failed to load plugins/.test(line))).toEqual([])
  await expect(page.locator('[data-slot-error]')).toHaveCount(0)
  await finishJourneyAssertions(page)
})
