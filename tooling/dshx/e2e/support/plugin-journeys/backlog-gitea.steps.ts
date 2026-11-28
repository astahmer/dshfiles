import { expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { HttpClientRequest } from 'effect/http'
import { fakeGitea } from '../../../../../plugins/@dshfiles/backlog-gitea/src/gitea-fake.js'
import { bootComposedPluginProfile } from '../boot.js'
import { Given, Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion, visitIsolatedPluginProfile } from '../steps.js'

interface LoopbackGitea {
  readonly fake: ReturnType<typeof fakeGitea>
  readonly baseUrl: string
}

const sites = new WeakMap<Page, LoopbackGitea>()
const giteaOf = (page: Page): LoopbackGitea => {
  const site = sites.get(page)
  if (site === undefined) throw new Error('No fake Gitea is running for this page.')
  return site
}

const portSchema = Schema.Struct({ port: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535)) })
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const methodOf = (method: string | undefined) => methods.find(candidate => candidate === method) ?? 'GET'

/**
 * Serves the in-memory fake Gitea over loopback HTTP, so the scratch Host's provider reaches it through its base URL
 * (plain http is accepted for loopback). The query string moves into the request's URL params, where the fake reads it.
 */
const serveOnLoopback = async (fake: ReturnType<typeof fakeGitea>): Promise<{ readonly server: Server; readonly baseUrl: string }> => {
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
  if (Option.isNone(address)) throw new Error('The fake Gitea has no loopback port.')
  return { server, baseUrl: `http://127.0.0.1:${String(address.value.port)}` }
}

const remoteSync = (page: Page) => page.getByRole('region', { name: 'Remote sync' })
const giteaConnection = (page: Page) => remoteSync(page).getByRole('region', { name: 'Connection Gitea' })
const feedItem = (page: Page, title: string) =>
  page
    .getByRole('feed', { name: 'Backlog feed' })
    .getByRole('article', { name: /^Item b:/u })
    .filter({ hasText: title })

Given('a fake Gitea instance holds the issue {string}', async ({ page }: { page: Page }, title: string) => {
  const fake = fakeGitea()
  const { server, baseUrl } = await serveOnLoopback(fake)
  fake.state.site = baseUrl
  fake.add({ title, body: 'Imported from the fake Gitea.', labels: ['provider'] })
  page.once('close', () => server.close())
  sites.set(page, { fake, baseUrl })
})

Given('the backlog is booted with the Gitea provider against the fake Gitea', async ({ page }: { page: Page }) => {
  const profile = await bootComposedPluginProfile({
    packageIds: ['@dshfiles/backlog', '@dshfiles/backlog-gitea'],
    profileLabel: '@dshfiles/backlog-gitea-fake-gitea',
    hostEnv: { GITEA_TOKEN: giteaOf(page).fake.token },
  })
  await visitIsolatedPluginProfile(page, profile)
})

When('a Gitea connection to the fake Gitea is tested and saved', async ({ page }: { page: Page }) => {
  const section = remoteSync(page)
  await section.getByRole('button', { name: 'Add Gitea connection', exact: true }).click()
  const form = section.getByRole('form', { name: 'New Gitea connection' })
  const instanceUrl = form.getByRole('textbox', { name: 'Instance URL', exact: true })
  await expect(instanceUrl).toHaveAttribute('placeholder', 'https://gitea.example.com')
  await expect(form.getByRole('button', { name: 'Test connection', exact: true })).toBeDisabled()
  await expect(instanceUrl).toHaveAccessibleDescription(/Gitea needs its Instance URL/u)
  await instanceUrl.fill(giteaOf(page).baseUrl)
  await form.getByRole('button', { name: 'Test connection', exact: true }).click()
  await expect(form.getByRole('status')).toContainText(giteaOf(page).fake.login)
  await expect(form.getByRole('status')).toContainText('1 available')
  await form.getByRole('button', { name: 'Save connection', exact: true }).click()
})

Then('the Gitea connection names its account and repository', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-gitea-connection', async () => {
    await expect(giteaConnection(page)).toBeVisible()
    await expect(giteaConnection(page).getByRole('button', { name: 'Add binding', exact: true })).toBeVisible()
    expect(giteaOf(page).fake.requests.every(request => request.authorized)).toBe(true)
  })
})

When('the Gitea repository is bound', async ({ page }: { page: Page }) => {
  await giteaConnection(page).getByRole('button', { name: 'Add binding', exact: true }).click()
  const binding = giteaConnection(page).getByRole('form', { name: 'New binding' })
  await expect(binding.getByRole('textbox', { name: 'Create missing labels', exact: true })).toBeVisible()
  await binding.getByRole('button', { name: 'Save binding', exact: true }).click()
  await expect(giteaConnection(page).getByRole('group', { name: /^Binding gitea-/u })).toBeVisible()
})

When('the fake Gitea issue {string} is imported', async ({ page }: { page: Page }, key: string) => {
  const form = remoteSync(page).getByRole('form', { name: 'Import a remote item' })
  await form.getByRole('textbox', { name: 'Remote item to import', exact: true }).fill(key)
  await form.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(form.getByRole('alert')).toHaveCount(0)
  await expect(form.getByRole('textbox', { name: 'Remote item to import', exact: true })).toHaveValue('', { timeout: 15_000 })
})

Then('the backlog shows the imported Gitea issue {string}', async ({ page }: { page: Page }, title: string) => {
  await recordAssertion(page, 'backlog-gitea-imported', async () => {
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Backlog settings' })).toHaveCount(0)
    await page.getByRole('navigation', { name: 'Backlog views' }).getByRole('button', { name: 'Feed', exact: true }).click()
    await expect(feedItem(page, title)).toBeVisible()
    expect(giteaOf(page).fake.requests.some(request => request.path === '/repos/acme/app/issues/1')).toBe(true)
  })
})

When('the imported Gitea issue is marked done and synced', async ({ page }: { page: Page }) => {
  const item = feedItem(page, 'Ship the Gitea provider')
  await item.click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: 'Status', exact: true }).hover()
  await page.getByRole('menu').last().getByRole('menuitemradio', { name: 'Done', exact: true }).click()
  await item.click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: 'Sync now with acme/app#1', exact: true }).click()
})

Then('the fake Gitea issue is closed', async ({ page }: { page: Page }) => {
  await recordAssertion(page, 'backlog-gitea-closed', async () => {
    const fake = giteaOf(page).fake
    await expect.poll(() => fake.issues.get(1)?.state, { timeout: 15_000 }).toBe('closed')
    const edits = fake.requests.filter(request => request.method === 'PATCH' && request.path === '/repos/acme/app/issues/1').map(request => request.json)
    expect(edits).toContainEqual(expect.objectContaining({ state: 'closed' }))
  })
  await finishJourneyAssertions(page)
})
