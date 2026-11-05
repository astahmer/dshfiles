import { expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { HttpClientRequest } from 'effect/http'
import { fakeJira } from '../../../../../plugins/@dshfiles/backlog-jira/src/jira-fake.js'
import { bootComposedPluginProfile } from '../boot.js'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'

interface LoopbackJira {
  readonly fake: ReturnType<typeof fakeJira>
  readonly baseUrl: string
}

const sites = new WeakMap<Page, LoopbackJira>()
const jiraOf = (page: Page): LoopbackJira => {
  const site = sites.get(page)
  if (site === undefined) throw new Error('No fake Jira is running for this page.')
  return site
}

const portSchema = Schema.Struct({ port: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535)) })
const methods = ['GET', 'POST', 'PUT', 'DELETE'] as const
const methodOf = (method: string | undefined) => methods.find(candidate => candidate === method) ?? 'GET'

/**
 * Serves the in-memory fake Jira over loopback HTTP, so the scratch Host's provider reaches it through its base URL.
 * The query string moves into the request's URL params, where the fake reads it, as the provider's client sends it.
 */
const serveOnLoopback = async (fake: ReturnType<typeof fakeJira>): Promise<{ readonly server: Server; readonly baseUrl: string }> => {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const headers = Object.fromEntries(Object.entries(request.headers).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value] as const] : [])))
    const base = HttpClientRequest.make(methodOf(request.method))(`${url.origin}${url.pathname}`).pipe(
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
    response.end(answer.status === 204 ? undefined : answer.text)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = Schema.decodeUnknownOption(portSchema)(server.address())
  if (Option.isNone(address)) throw new Error('The fake Jira has no loopback port.')
  return { server, baseUrl: `http://127.0.0.1:${String(address.value.port)}` }
}

const remoteSync = (page: Page) => page.getByRole('region', { name: 'Remote sync' })
const jiraConnection = (page: Page) => remoteSync(page).getByRole('region', { name: 'Connection Jira' })
const feedItem = (page: Page, title: string) => page.getByRole('feed', { name: 'Backlog feed' }).getByRole('article', { name: /^Item b:/u }).filter({ hasText: title })

Given('a fake Jira site holds the issue {string}', async ({ page }: { page: Page }, summary: string) => {
  const fake = fakeJira()
  fake.add({ summary, description: 'Imported from the fake Jira.', labels: ['provider'] })
  const { server, baseUrl } = await serveOnLoopback(fake)
  page.once('close', () => server.close())
  sites.set(page, { fake, baseUrl })
})

Given('the backlog is booted with the Jira provider against the fake Jira', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/backlog', '@dshfiles/backlog-jira'],
    profileLabel: '@dshfiles/backlog-jira-fake-jira',
    hostEnv: { JIRA_API_TOKEN: jiraOf(page).fake.token },
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('a Jira connection to the fake Jira is tested and saved with its account email', async ({ page }: { page: Page }) => {
  const section = remoteSync(page)
  await section.getByRole('button', { name: 'Add Jira connection', exact: true }).click()
  const form = section.getByRole('form', { name: 'New Jira connection' })
  await form.getByRole('textbox', { name: 'API base URL', exact: true }).fill(jiraOf(page).baseUrl)
  await form.getByRole('textbox', { name: 'Account email', exact: true }).fill(jiraOf(page).fake.email)
  await form.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(form.getByRole('status')).toContainText('Ada Lovelace')
  await expect(form.getByRole('status')).toContainText('1 available')
  await form.getByRole('button', { name: 'Save connection', exact: true }).click()
})

Then('the Jira connection names its account and project', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-jira-connection', async () => {
    await expect(jiraConnection(page)).toBeVisible()
    await expect(jiraConnection(page).getByRole('button', { name: 'Add binding', exact: true })).toBeVisible()
    expect(jiraOf(page).fake.requests.every(request => request.authorized)).toBe(true)
  })
})

When('the Jira project is bound', async ({ page }: { page: Page }) => {
  await jiraConnection(page).getByRole('button', { name: 'Add binding', exact: true }).click()
  const binding = jiraConnection(page).getByRole('form', { name: 'New binding' })
  await expect(binding.getByRole('textbox', { name: 'Extra JQL', exact: true })).toBeVisible()
  await binding.getByRole('button', { name: 'Save binding', exact: true }).click()
  await expect(jiraConnection(page).getByRole('group', { name: /^Binding jira-/u })).toBeVisible()
})

When('the fake Jira issue {string} is imported', async ({ page }: { page: Page }, key: string) => {
  const form = remoteSync(page).getByRole('form', { name: 'Import a remote item' })
  await form.getByRole('textbox', { name: 'Remote item to import', exact: true }).fill(key)
  await form.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(form.getByRole('alert')).toHaveCount(0)
  await expect(form.getByRole('textbox', { name: 'Remote item to import', exact: true })).toHaveValue('', { timeout: 15_000 })
})

Then('the backlog shows the imported Jira issue {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-jira-imported', async () => {
    await page.getByRole('button', { name: 'Backlog views', exact: true }).click()
    await expect(feedItem(page, title)).toBeVisible()
    expect(jiraOf(page).fake.requests.some(request => request.path === '/issue/ENG-1')).toBe(true)
  })
})

When('the imported Jira issue is marked done and synced', async ({ page }: { page: Page }) => {
  const item = feedItem(page, 'Ship the Jira provider')
  await item.click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: 'Status', exact: true }).hover()
  await page.getByRole('menu').last().getByRole('menuitemradio', { name: 'Done', exact: true }).click()
  await item.click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: 'Sync now with ENG-1', exact: true }).click()
})

Then('the fake Jira issue moved to Done through two transitions', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-jira-transitioned', async () => {
    const fake = jiraOf(page).fake
    await expect.poll(() => [...fake.issues.values()][0]?.status.name, { timeout: 15_000 }).toBe('Done')
    const transitions = fake.requests.filter(request => request.method === 'POST' && request.path.endsWith('/transitions')).map(request => request.json)
    expect(transitions).toEqual([{ transition: { id: '11' } }, { transition: { id: '22' } }])
  })
  await finishJourneyAssertions(page)
})
