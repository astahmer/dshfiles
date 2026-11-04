import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { whiteboardApi } from '../../../../../plugins/@dshfiles/whiteboard/src/api.js'
import { connectDshxApiClient } from '../../../packages/dshx/src/platform/index.js'
import { registerScratchWorkspace } from '../../../packages/dshx/src/project/scratch-workspace.js'
import { Given, Then, When } from '../bdd.js'
import { bootComposedPluginProfile } from '../boot.js'
import { openGlobalPanel } from '../plugin-view-names.js'
import { browserDiagnosticsFor, finishJourneyAssertions, profileFor, recordAssertion, reloadPastProviderSetup, visitIsolatedPluginProfile } from '../steps.js'

const PROJECT_FOLDER = 'whiteboard-project'
const PANEL = 'Whiteboard: Boards'
const navigationAborts = new WeakMap<Page, Set<number>>()
const editorOpenings = new WeakMap<Page, number>()
const reloadCancellations = new Set(['requestfailed: eventsource net::ERR_ABORTED', 'requestfailed: eventsource cancelled'])
/** Paths of failed requests, so a `requestfailed` diagnostic names the request that failed. */
const failedRequests = new WeakMap<Page, string[]>()

/** Each prepared home registers its own project, so boards have a project to belong to. */
const seedWhiteboardProject = async (homeRoot: string): Promise<void> => {
  const project = join(homeRoot, PROJECT_FOLDER)
  await mkdir(project, { recursive: true })
  await registerScratchWorkspace(homeRoot, await realpath(project))
}

const projectPath = (page: Page): Promise<string> => realpath(join(profileFor(page).homeRoot, PROJECT_FOLDER))
const hostClient = (page: Page) => connectDshxApiClient(whiteboardApi, { url: profileFor(page).url })

const boardNamed = async (page: Page, title: string) => {
  const client = await hostClient(page)
  const boards = (await client.list({ project: await projectPath(page), includeDeleted: true })).boards
  const board = boards.find(candidate => candidate.title === title)
  if (board === undefined) throw new Error(`No whiteboard titled ${JSON.stringify(title)} on the Host.`)
  return { client, board }
}

const boardList = (page: Page) => page.getByRole('list', { name: 'Whiteboards', exact: true })
const boardRow = (page: Page, title: string) =>
  boardList(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) })
const canvas = (page: Page) => page.getByTestId('whiteboard-canvas')

Given('the isolated whiteboard plugin profile is booted with a project', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/whiteboard'],
    profileLabel: '@dshfiles/whiteboard',
    seedHome: seedWhiteboardProject,
    seedKey: 'whiteboard-project-v1',
  })
  await visitIsolatedPluginProfile(page, profile)
  const failed: string[] = []
  failedRequests.set(page, failed)
  page.on('requestfailed', request => failed.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? ''}`))
})

Given('an agent wrote whiteboard {string} from Mermaid {string}', async ({ page }: { page: Page }, title: string, mermaid: string) => {
  const client = await hostClient(page)
  const board = await client.write({ project: await projectPath(page), title, mermaid: mermaid.replaceAll('\\n', '\n') })
  expect(board.pending).toBe('mermaid')
})

When('the Whiteboards page is opened', async ({ page }: { page: Page }) => {
  await openGlobalPanel(page, PANEL)
  await expect(page.getByRole('heading', { name: 'Whiteboards', exact: true })).toBeVisible()
})

When('a whiteboard {string} is created', async ({ page }: { page: Page }, title: string) => {
  await page.getByRole('button', { name: 'New board', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New whiteboard', exact: true })
  await dialog.getByRole('textbox', { name: 'Board title', exact: true }).fill(title)
  await dialog.getByRole('button', { name: 'Create board', exact: true }).click()
  await expect(dialog).toBeHidden()
})

Then('the Excalidraw editor is open on {string}', async ({ page }: { page: Page }, title: string) => {
  const opening = (editorOpenings.get(page) ?? 0) + 1
  editorOpenings.set(page, opening)
  await recordAssertion(page, `editor-loaded-${String(opening)}`, async () => {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    // The editor bundle arrives from the plugin's own route, not client.js, and mounts Excalidraw's canvas.
    await expect(canvas(page).locator('.excalidraw canvas').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  })
})

When('a rectangle is drawn on the whiteboard', async ({ page }: { page: Page }) => {
  // Excalidraw's tool radios are visually hidden inside their icon labels; click the label a user taps.
  await canvas(page)
    .locator('label.ToolIcon')
    .filter({ has: page.getByRole('radio', { name: /Rectangle/u }) })
    .first()
    .click()
  await expect(
    canvas(page)
      .getByRole('radio', { name: /Rectangle/u })
      .first(),
  ).toBeChecked()
  const box = await canvas(page).locator('canvas.interactive, .excalidraw__canvas.interactive').first().boundingBox()
  if (box === null) throw new Error('The Excalidraw canvas has no box to draw on.')
  const x = box.x + box.width / 2 - 80
  const y = box.y + box.height / 2 - 40
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 160, y + 90, { steps: 8 })
  await page.mouse.up()
})

Then('the Host stores {int} element(s) on whiteboard {string}', async ({ page }: { page: Page }, count: number, title: string) => {
  await recordAssertion(page, 'autosaved', async () => {
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await boardNamed(page, title)).board.elementCount, { timeout: 15_000 }).toBe(count)
  })
})

When('the Whiteboards page is reloaded', async ({ page }: { page: Page }) => {
  const before = browserDiagnosticsFor(page).length
  await reloadPastProviderSetup(page)
  // An explicit reload cancels the native SSE stream (Chromium reports ERR_ABORTED, WebKit "cancelled"); admit only
  // that exact cancellation, within this navigation.
  const admitted = navigationAborts.get(page) ?? new Set<number>()
  browserDiagnosticsFor(page).forEach((diagnostic, index) => {
    if (index >= before && reloadCancellations.has(diagnostic)) admitted.add(index)
  })
  navigationAborts.set(page, admitted)
  await openGlobalPanel(page, PANEL)
  await expect(page.getByRole('heading', { name: 'Whiteboards', exact: true })).toBeVisible()
})

When('whiteboard {string} is opened', async ({ page }: { page: Page }, title: string) => {
  await boardList(page).getByRole('button', { name: title, exact: true }).click()
})

Then('the whiteboard fits a 390 px phone screen', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'phone-width', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(canvas(page).locator('.excalidraw canvas').first()).toBeVisible()
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(391)
    const header = await page.getByRole('button', { name: /^Rename /u }).boundingBox()
    expect(header === null ? 0 : header.x + header.width).toBeLessThanOrEqual(390)
    await page.setViewportSize({ width: 1280, height: 800 })
  })
})

When('the board list is shown again', async ({ page }: { page: Page }) => {
  await page.getByRole('button', { name: 'Boards', exact: true }).click()
  await expect(boardList(page)).toBeVisible()
})

When('whiteboard {string} is renamed to {string}', async ({ page }: { page: Page }, title: string, next: string) => {
  await boardRow(page, title)
    .getByRole('button', { name: `Rename ${title}`, exact: true })
    .click()
  const field = page.getByRole('textbox', { name: `Rename ${title}`, exact: true })
  await field.fill(next)
  await field.press('Enter')
  await expect(boardList(page).getByRole('button', { name: next, exact: true })).toBeVisible()
})

When('whiteboard {string} is deleted with confirmation', async ({ page }: { page: Page }, title: string) => {
  await boardRow(page, title)
    .getByRole('button', { name: `Delete ${title}`, exact: true })
    .click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete board', exact: true }).click()
  await expect(dialog).toBeHidden()
})

Then('{string} is listed under Recently deleted', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'recently-deleted', async () => {
    const deleted = page.getByRole('region', { name: 'Recently deleted', exact: true })
    await expect(deleted.getByText(title, { exact: true })).toBeVisible()
    await expect(boardList(page).getByRole('button', { name: title, exact: true })).toHaveCount(0)
    expect((await boardNamed(page, title)).board.deletedAt).not.toBeNull()
  })
})

When('whiteboard {string} is restored', async ({ page }: { page: Page }, title: string) => {
  const deleted = page.getByRole('region', { name: 'Recently deleted', exact: true })
  await deleted.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Restore', exact: true }).click()
})

Then('whiteboard {string} is listed with {int} element(s)', async ({ page }: { page: Page }, title: string, count: number) => {
  await recordAssertion(page, 'restored', async () => {
    await expect(boardRow(page, title)).toContainText(count === 1 ? '1 element' : `${String(count)} elements`)
  })
})

Then('whiteboard {string} shows {string}', async ({ page }: { page: Page }, title: string, badge: string) => {
  await expect(boardRow(page, title)).toContainText(badge)
})

Then('the Host stores the converted Mermaid on whiteboard {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'mermaid-converted', async () => {
    await expect(canvas(page).locator('.excalidraw canvas').first()).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(
        async () => {
          const { client, board } = await boardNamed(page, title)
          const read = await client.read({ boardId: board.id })
          return { pending: read.pending, texts: [...read.texts].sort() }
        },
        { timeout: 30_000 },
      )
      .toEqual({ pending: null, texts: ['Build', 'Plan', 'Ship'] })
  })
  await page.screenshot({ path: test.info().outputPath('agent-diagrams.png') })
})

Then('the Whiteboard journey has no browser errors', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'clean-browser', () => {
    const unexpected = browserDiagnosticsFor(page).filter((_diagnostic, index) => navigationAborts.get(page)?.has(index) !== true)
    expect(unexpected, `Failed requests: ${(failedRequests.get(page) ?? []).join('; ')}`).toEqual([])
  })
  await page.screenshot({ path: test.info().outputPath('project-whiteboards.png') })
  await finishJourneyAssertions(page)
})
