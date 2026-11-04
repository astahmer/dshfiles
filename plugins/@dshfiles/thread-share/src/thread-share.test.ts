import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { HostContext } from '@dshfiles/dshx/effect'
import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { afterEach, expect, it } from 'vitest'
import shareHost from './host.js'
import { threadShareApi } from './share-api.js'
import { PASSPHRASE_FAILURE_LIMIT, REQUEST_LIMIT } from './share-route.js'
import { NAMESPACE } from './share-store.js'
import { Effect, Layer, Option } from 'effect'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const unused = () => Promise.reject(new Error('not used by this test'))

const SHARED_TEXT = 'The shared thread answer.'
const OTHER_TEXT = 'A private answer from another thread.'

/** A real test Host with JSON storage, a fake web server and a sessions owner standing in for session-controller. */
const fixture = async (options: { readonly subprocess?: boolean } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'thread-share-'))
  const host = await createTestHost()
  cleanups.push(async () => {
    await host.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const ctx = host.ctx
  if (options.subprocess === true) await ctx.plugin(LocalSubprocessRuntime)
  else ctx.provide('subprocess', { spawn: unused })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const routes: WebRoute[] = []
  ctx.provide('webServer', {
    port: 3080,
    host: '127.0.0.1',
    protocol: 'http:',
    getOrigin: () => 'http://127.0.0.1:3080',
    register: (route: WebRoute) => {
      routes.push(route)
      return () => routes.splice(routes.indexOf(route), 1)
    },
  })
  const transcripts = new Map<string, string>([
    ['session-1', SHARED_TEXT],
    ['session-2', OTHER_TEXT],
  ])
  const reads: string[] = []
  await host.mount(
    defineHost({
      name: '@dshfiles/session-controller',
      apis: [
        sessionsApi.host({
          list: () => ({
            threads: [
              { sessionId: 'session-1', title: 'Fix login', cwd: '/Users/alice/work/app', running: false, updatedAt: 2 },
              { sessionId: 'session-2', title: 'Private', running: false, updatedAt: 1 },
            ],
            total: 2,
            truncated: false,
          }),
          messages: ({ input }) => {
            reads.push(input.sessionId)
            const text = transcripts.get(input.sessionId)
            if (text === undefined) return Promise.reject(new Error(`unknown session ${input.sessionId}`))
            return {
              sessionId: input.sessionId,
              running: false,
              entries: [
                { seq: 1, role: 'user', text: 'Please help.' },
                { seq: 2, role: 'assistant', text },
              ],
              truncated: false,
            }
          },
          create: unused,
          prompt: unused,
          wait: unused,
          interrupt: unused,
          command: unused,
          message: unused,
          compact: unused,
          selectModel: unused,
          selectAgent: unused,
          instructions: unused,
          setInstruction: unused,
          generate: unused,
        }),
      ],
    }),
    { packageId: '@dshfiles/session-controller' },
  )
  await host.mount(shareHost, { packageId: '@dshfiles/thread-share' })
  const route = routes.find(candidate => candidate.path === '/thread-share')
  if (route === undefined) throw new Error('the Host registered no /thread-share route')
  expect(route.kind).toBe('prefix')
  const server: Server = createServer((request, response) => void route.handler(request, response))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise(resolve => server.close(() => resolve())))
  // SAFETY: a TCP server listening on a port reports an AddressInfo, never a pipe path.
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  /** Move a share's expiry into the past by rewriting its stored record, without faking the clock. */
  const ageShare = (id: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* PluginStorage
        const stored = yield* storage.get(`share/${id}`)
        if (Option.isNone(stored) || typeof stored.value.value !== 'object' || stored.value.value === null || Array.isArray(stored.value.value))
          return yield* Effect.die('no stored share')
        yield* storage.set(`share/${id}`, { ...stored.value.value, expiresAt: Date.now() - 1 })
      }).pipe(Effect.provide(PluginStorage.layerFor(NAMESPACE).pipe(Layer.provide(HostContext.layer({ ctx, packageId: '@dshfiles/thread-share' }))))),
    )
  return { origin, transcripts, reads, ageShare, api: createHostApiClient(ctx, threadShareApi, '@acme/settings') }
}

const get = (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, redirect: 'manual' })

it('serves only the shared thread: another session and other paths are unreachable', async () => {
  const { origin, api, reads } = await fixture()
  const created = await api.create({ sessionId: 'session-1', kind: 'live', access: 'link', expiry: '1d' })
  expect(created.path).toMatch(/^\/thread-share\/s\/dshs_[\w-]{43}$/)
  expect(created.links).toContainEqual({ label: 'DSH server', url: `http://127.0.0.1:3080${created.path}` })
  expect(created.share).toMatchObject({ sessionId: 'session-1', title: 'Fix login', status: 'active', views: 0 })
  reads.length = 0

  const recorder = recordSpans()
  try {
    const page = await get(`${origin}${created.path}?sessionId=session-2`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain(SHARED_TEXT)
    expect(html).not.toContain(OTHER_TEXT)
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive, nosnippet')
    expect(page.headers.get('cache-control')).toContain('no-store')
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(recorder.span('thread share request').attributes).toMatchObject({ 'dshx.thread_share.outcome': 'served', 'dshx.thread_share.kind': 'live' })
  } finally {
    recorder.stop()
  }
  expect(reads).toEqual(['session-1'])

  const otherToken = `dshs_${'A'.repeat(43)}`
  for (const path of [
    `/thread-share/s/${otherToken}`,
    '/thread-share/s/session-2',
    '/thread-share/sessions',
    '/thread-share',
    `/thread-share/s/${created.path.split('/').at(-1) ?? ''}/extra`,
  ]) {
    const refused = await get(`${origin}${path}`)
    expect(refused.status, path).toBe(404)
    const body = await refused.text()
    expect(body).not.toContain(OTHER_TEXT)
    expect(body).toContain('Ask the person who shared it for a new link.')
  }
  expect(reads).toEqual(['session-1'])
  expect((await fetch(`${origin}${created.path}`, { method: 'DELETE' })).status).toBe(405)
}, 60_000)

it('redacts secrets and host paths on the share page', async () => {
  const { origin, api, transcripts } = await fixture()
  transcripts.set('session-1', 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz in /Users/alice/work/app/src/main.ts, see /Users/alice/.zshrc')
  const created = await api.create({ sessionId: 'session-1', kind: 'live', access: 'link', expiry: '1h' })
  const html = await (await get(`${origin}${created.path}`)).text()
  expect(html).not.toContain('sk-ant-api03')
  expect(html).not.toContain('alice')
  expect(html).toContain('[redacted]')
  expect(html).toContain('&lt;workspace&gt;/src/main.ts')
  expect(html).toContain('~/.zshrc')
}, 60_000)

it('asks for the passphrase of a protected share and locks it after repeated failures', async () => {
  const { origin, api } = await fixture()
  const created = await api.create({ sessionId: 'session-1', kind: 'live', access: 'protected', passphrase: 'open sesame 42', expiry: '7d' })
  const url = `${origin}${created.path}`
  const form = await get(url)
  expect(form.status).toBe(200)
  const formHtml = await form.text()
  expect(formHtml).toContain('This shared thread is protected')
  expect(formHtml).not.toContain(SHARED_TEXT)

  const post = (passphrase: string) =>
    fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ passphrase }),
    })
  const wrong = await post('not the passphrase')
  expect(wrong.status).toBe(401)
  expect(await wrong.text()).toContain('Wrong passphrase')

  const right = await post('open sesame 42')
  expect(right.status).toBe(303)
  const cookie = right.headers.get('set-cookie') ?? ''
  expect(cookie).toMatch(/^dshs_grant=[\w-]+; Path=\/thread-share\/s\/dshs_[\w-]+; Max-Age=\d+; HttpOnly; SameSite=Lax$/)
  const granted = await get(url, { cookie: cookie.split(';')[0] ?? '' })
  expect(await granted.text()).toContain(SHARED_TEXT)
  expect((await get(url, { cookie: 'dshs_grant=forged' })).status).toBe(200)
  expect(await (await get(url, { cookie: 'dshs_grant=forged' })).text()).not.toContain(SHARED_TEXT)

  for (let attempt = 1; attempt < PASSPHRASE_FAILURE_LIMIT.limit; attempt += 1) expect((await post(`wrong ${String(attempt)}`)).status).toBe(401)
  const locked = await post('open sesame 42')
  expect(locked.status).toBe(429)
  expect(locked.headers.get('retry-after')).toMatch(/^\d+$/)
}, 120_000)

it('counts views, revokes only with confirm, and hides expired shares', async () => {
  const { origin, api, ageShare } = await fixture()
  const created = await api.create({ sessionId: 'session-1', kind: 'live', access: 'link', expiry: '1h' })
  await get(`${origin}${created.path}`)
  await get(`${origin}${created.path}`)
  expect((await api.list({})).shares).toEqual([expect.objectContaining({ id: created.share.id, views: 2, status: 'active' })])

  // SAFETY: the bare call omits the confirm the schema requires, to prove the method refuses it.
  await expect(api.revoke({ id: created.share.id } as unknown as { id: string; confirm: true })).rejects.toThrow()
  expect((await get(`${origin}${created.path}`)).status).toBe(200)

  const revoked = await api.revoke({ id: created.share.id, confirm: true })
  expect(revoked.share.status).toBe('revoked')
  expect((await get(`${origin}${created.path}`)).status).toBe(404)
  expect((await api.list({})).shares).toEqual([])
  expect((await api.list({ includeInactive: true })).shares).toEqual([expect.objectContaining({ id: created.share.id, status: 'revoked' })])
  await expect(api.revoke({ id: 'missing', confirm: true })).rejects.toThrow(/No share missing exists/)

  const expiring = await api.create({ sessionId: 'session-1', kind: 'live', access: 'link', expiry: '1h' })
  expect((await get(`${origin}${expiring.path}`)).status).toBe(200)
  // The stored record is aged through the plugin's own storage service, as if its hour had passed.
  await ageShare(expiring.share.id)
  expect((await get(`${origin}${expiring.path}`)).status).toBe(404)
  expect((await api.list({ includeInactive: true })).shares.find(row => row.id === expiring.share.id)?.status).toBe('expired')
}, 60_000)

it('freezes a snapshot share and exports a self-contained HTML file', async () => {
  const { origin, api, transcripts } = await fixture()
  const created = await api.create({ sessionId: 'session-1', kind: 'snapshot', access: 'link', expiry: 'never' })
  transcripts.set('session-1', 'Edited after sharing.')
  const html = await (await get(`${origin}${created.path}`)).text()
  expect(html).toContain(SHARED_TEXT)
  expect(html).not.toContain('Edited after sharing.')
  expect(html).toContain('Read-only snapshot taken')

  const exported = await api.exportHtml({ sessionId: 'session-1' })
  expect(exported.fileName).toBe('fix-login.html')
  expect(exported.html).toContain('Edited after sharing.')
  expect(exported.html).not.toMatch(/<script|https?:\/\/|<link /)
  await expect(api.exportHtml({ sessionId: 'session-404' })).rejects.toThrow(/could not be read/)
}, 60_000)

it('rate-limits one client across share pages', async () => {
  const { origin } = await fixture()
  const statuses: number[] = []
  for (let index = 0; index <= REQUEST_LIMIT.limit; index += 1) statuses.push((await get(`${origin}/thread-share/s/dshs_${'B'.repeat(43)}`)).status)
  expect(statuses.slice(0, REQUEST_LIMIT.limit).every(status => status === 404)).toBe(true)
  expect(statuses.at(-1)).toBe(429)
}, 60_000)

it('publishes only share pages through a bounded tunnel process and stops it', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'thread-share-bin-'))
  cleanups.push(() => rm(bin, { recursive: true, force: true }))
  // A stand-in for cloudflared: prints the quick-tunnel URL line and stays up until killed. Nothing is published.
  await writeFile(join(bin, 'cloudflared'), '#!/bin/sh\necho "INF |  https://fake-tunnel-test.trycloudflare.com  |" >&2\nexec sleep 300\n')
  await chmod(join(bin, 'cloudflared'), 0o755)
  const previousPath = process.env.PATH
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`
  cleanups.push(async () => {
    process.env.PATH = previousPath
  })
  const { api } = await fixture({ subprocess: true })
  const before = await api.publishStatus({})
  expect(before.tools.cloudflared).toEqual({ available: true, path: join(bin, 'cloudflared') })
  expect(before.active).toBeNull()

  const recorder = recordSpans()
  const started = await (async () => {
    try {
      const status = await api.publishStart({ provider: 'cloudflared', minutes: 15, confirm: true })
      expect(recorder.span('thread share publish start').attributes).toMatchObject({
        'dshx.thread_share.provider': 'cloudflared',
        'process.executable.name': 'cloudflared',
      })
      return status
    } finally {
      recorder.stop()
    }
  })()
  expect(started.active).toMatchObject({ provider: 'cloudflared', state: 'published', publicUrl: 'https://fake-tunnel-test.trycloudflare.com' })
  const listener = `http://127.0.0.1:${String(started.active?.localPort)}`
  const created = await api.create({ sessionId: 'session-1', kind: 'live', access: 'link', expiry: '1h' })
  expect(created.links).toContainEqual({ label: 'Public (cloudflared)', url: `https://fake-tunnel-test.trycloudflare.com${created.path}` })
  expect(await (await get(`${listener}${created.path}`)).text()).toContain(SHARED_TEXT)
  for (const path of ['/', '/api/sessions', '/mcp', '/index.html']) expect((await get(`${listener}${path}`)).status, path).toBe(404)

  const stopped = await api.publishStop({})
  expect(stopped.active).toBeNull()
  await expect(get(`${listener}${created.path}`)).rejects.toThrow()
}, 60_000)
