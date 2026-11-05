import { expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { HttpClientRequest } from 'effect/http'
import { fakeNotion } from '../../../../../plugins/@dshfiles/backlog-notion/src/notion-fake.js'
import { bootComposedPluginProfile } from '../boot.js'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'

interface LoopbackNotion {
  readonly fake: ReturnType<typeof fakeNotion>
  readonly baseUrl: string
  readonly pageUrl: string
}

const notions = new WeakMap<Page, LoopbackNotion>()
const notionOf = (page: Page): LoopbackNotion => {
  const notion = notions.get(page)
  if (notion === undefined) throw new Error('No fake Notion is running for this page.')
  return notion
}

const portSchema = Schema.Struct({ port: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535)) })

/** Serves the in-memory fake Notion over loopback HTTP, so the scratch Host's provider reaches it through its base URL. */
const serveOnLoopback = async (fake: ReturnType<typeof fakeNotion>): Promise<{ readonly server: Server; readonly baseUrl: string }> => {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const headers = Object.fromEntries(Object.entries(request.headers).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value] as const] : [])))
    const base = HttpClientRequest.make(request.method === 'POST' ? 'POST' : request.method === 'PATCH' ? 'PATCH' : 'GET')(`${url.origin}${url.pathname}`).pipe(
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.setUrlParams([...url.searchParams]),
    )
    const outgoing = body === '' ? base : HttpClientRequest.bodyText(base, body, 'application/json')
    const answer = await Effect.runPromise(
      Effect.flatMap(fake.client.execute(outgoing), result => Effect.map(result.text, text => ({ status: result.status, headers: result.headers, text }))),
    )
    response.writeHead(answer.status, {
      'content-type': 'application/json',
      ...(answer.headers['retry-after'] === undefined ? {} : { 'retry-after': answer.headers['retry-after'] }),
    })
    response.end(answer.text)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = Schema.decodeUnknownOption(portSchema)(server.address())
  if (Option.isNone(address)) throw new Error('The fake Notion has no loopback port.')
  return { server, baseUrl: `http://127.0.0.1:${String(address.value.port)}` }
}

const remoteSync = (page: Page) => page.getByRole('region', { name: 'Remote sync' })
const notionConnection = (page: Page) => remoteSync(page).getByRole('region', { name: 'Connection Notion' })

Given('a fake Notion workspace holds the page {string}', async ({ page }: { page: Page }, title: string) => {
  const fake = fakeNotion()
  const created = fake.add({ title, status: 'In progress', tags: ['Bug'], markdown: 'Imported from the fake Notion.' })
  const { server, baseUrl } = await serveOnLoopback(fake)
  page.once('close', () => server.close())
  notions.set(page, { fake, baseUrl, pageUrl: `https://www.notion.so/acme/Page-${created.id.replace(/-/gu, '')}` })
})

Given('the backlog is booted with the Notion provider against the fake Notion', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/backlog', '@dshfiles/backlog-notion'],
    profileLabel: '@dshfiles/backlog-notion-fake-notion',
    hostEnv: { NOTION_API_KEY: notionOf(page).fake.key },
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('a Notion connection to the fake Notion is tested and saved', async ({ page }: { page: Page }) => {
  const section = remoteSync(page)
  await section.getByRole('button', { name: 'Add Notion connection', exact: true }).click()
  const form = section.getByRole('form', { name: 'New Notion connection' })
  await form.getByRole('textbox', { name: 'API base URL', exact: true }).fill(notionOf(page).baseUrl)
  await form.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('Backlog sync (Acme)')
  await expect(form.getByRole('status')).toContainText('1 available')
  await form.getByRole('button', { name: 'Save connection', exact: true }).click()
})

Then('the Notion connection names its bot and data source', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-notion-connection', async () => {
    await expect(notionConnection(page)).toBeVisible()
    await expect(notionConnection(page).getByRole('button', { name: 'Add binding', exact: true })).toBeVisible()
    expect(notionOf(page).fake.requests.every(request => request.version === '2026-03-11' && request.authorized)).toBe(true)
  })
})

When('the Notion data source is bound with the status property {string}', async ({ page }: { page: Page }, property: string) => {
  await notionConnection(page).getByRole('button', { name: 'Add binding', exact: true }).click()
  const binding = notionConnection(page).getByRole('form', { name: 'New binding' })
  await binding.getByRole('textbox', { name: 'Status property', exact: true }).fill(property)
  await binding.getByRole('button', { name: 'Save binding', exact: true }).click()
  await expect(notionConnection(page).getByRole('group', { name: /^Binding notion-/u })).toBeVisible()
})

When('the fake Notion page is imported', async ({ page }: { page: Page }) => {
  const form = remoteSync(page).getByRole('form', { name: 'Import a remote item' })
  await form.getByRole('textbox', { name: 'Remote item to import', exact: true }).fill(notionOf(page).pageUrl)
  await form.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(form.getByRole('alert')).toHaveCount(0)
  await expect(form.getByRole('textbox', { name: 'Remote item to import', exact: true })).toHaveValue('', { timeout: 15_000 })
})

Then('the backlog shows the imported Notion page {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-notion-imported', async () => {
    await page.getByRole('button', { name: 'Backlog views', exact: true }).click()
    await expect(page.getByRole('feed', { name: 'Backlog feed' })).toContainText(title)
    expect(notionOf(page).fake.requests.some(request => request.path.endsWith('/markdown'))).toBe(true)
  })
  await finishJourneyAssertions(page)
})
