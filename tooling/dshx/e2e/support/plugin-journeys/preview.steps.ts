import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { createScratchDirectory, registerWorkspaceFolder, startThreadWithModel } from '../threads.js'

const THREAD_COMPOSER = /^(Describe what you want to build|Message or run a task), \/ commands, @ files or sessions$/
const PAGE_TEXT = 'Hello from the preview fixture'
const SERVER_SOURCE = `import { createServer } from 'node:http'
createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' })
  response.end('<!doctype html><title>Preview fixture</title><h1>${PAGE_TEXT}</h1>')
}).listen(Number(process.argv[2]), '127.0.0.1')
`

const ports = new Map<Page, number>()

const freePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })

const requirePort = (page: Page): number => {
  const port = ports.get(page)
  if (port === undefined) throw new Error('No preview server was started for this scenario.')
  return port
}

const sendDirective = async (page: Page, directive: string): Promise<void> => {
  const finished = page.getByText('Tool finished.', { exact: true })
  const before = await finished.count()
  const composer = page.getByRole('textbox', { name: THREAD_COMPOSER })
  await composer.fill(directive)
  await composer.press('Enter')
  await expect(finished).toHaveCount(before + 1, { timeout: 60_000 })
}

const callDirective = (tool: string, input: Record<string, unknown>): string => `[[call ${tool} ${JSON.stringify(input)}]]`

const chip = (page: Page) => page.getByRole('button', { name: 'Dev servers and previews', exact: true })

const serverAnswers = async (port: number): Promise<boolean> =>
  fetch(`http://127.0.0.1:${String(port)}/`).then(
    response => response.ok,
    () => false,
  )

When('the fake model starts an HTTP server from bash in a fresh workspace', async ({ page }: { page: Page }) => {
  const root = await createScratchDirectory('dshx-preview-e2e-')
  const workspace = join(root, 'preview-project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'server.mjs'), SERVER_SOURCE)
  const port = await freePort()
  ports.set(page, port)
  await registerWorkspaceFolder(page, workspace)
  await startThreadWithModel(page, { project: 'preview-project', model: 'commandcode_work/gpt-6-luna' })
  await sendDirective(
    page,
    callDirective('bash', { command: `node server.mjs ${String(port)}`, description: 'Start the preview fixture server', run_in_background: true }),
  )
  await expect.poll(() => serverAnswers(port), { timeout: 20_000 }).toBe(true)
})

Then("the thread header lists the server's port", async ({ page }: { page: Page }) => {
  const port = requirePort(page)
  await recordAssertion(page, 'preview-chip-lists-port', async () => {
    await expect(chip(page)).toHaveText(`:${String(port)}`, { timeout: 30_000 })
  })
})

When('the fake model opens and snapshots the server page in the preview browser', async ({ page }: { page: Page }) => {
  const port = requirePort(page)
  await sendDirective(page, callDirective('preview_open', { url: `http://127.0.0.1:${String(port)}/` }))
  await sendDirective(page, callDirective('preview_snapshot', { pageId: 'p1' }))
})

Then('the preview page is listed beside the server and its snapshot holds the page text', async ({ page }: { page: Page }) => {
  const port = requirePort(page)
  await recordAssertion(page, 'preview-page-listed', async () => {
    await expect(chip(page)).toHaveText(`:${String(port)}`)
    await chip(page).click()
    const list = page.getByRole('region', { name: 'Dev servers' })
    await expect(list).toBeVisible()
    await expect(list.getByText('Preview fixture', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(list.getByText(`:${String(port)} node`)).toBeVisible()
  })
  await recordAssertion(page, 'preview-snapshot-holds-page-text', async () => {
    await page.keyboard.press('Escape')
    await page
      .getByRole('button', { name: /^Completed in / })
      .last()
      .click()
    await page.getByRole('button', { name: 'Called tools', exact: true }).last().click()
    const pageText = page.getByText(PAGE_TEXT).last()
    await expect(async () => {
      if (await pageText.isVisible()) return
      await page
        .getByRole('button', { name: /snapshot/i })
        .last()
        .click({ timeout: 2_000 })
      await expect(pageText).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
  })
})

Then('stopping the server from the thread header ends its process', async ({ page }: { page: Page }) => {
  const port = requirePort(page)
  await recordAssertion(page, 'preview-stop-ends-server', async () => {
    await chip(page).click()
    const list = page.getByRole('region', { name: 'Dev servers' })
    await list.getByRole('button', { name: 'Stop', exact: true }).click()
    await list.getByRole('button', { name: 'Confirm stop', exact: true }).click()
    await expect.poll(() => serverAnswers(port), { timeout: 20_000 }).toBe(false)
  })
  await finishJourneyAssertions(page)
})
