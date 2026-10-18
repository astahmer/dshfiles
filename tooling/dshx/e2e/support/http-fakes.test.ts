import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { z } from 'zod'
import { createFakeCommandCodeApp, startFakeCommandCode } from '../../packages/dshx/src/scratch/fake-command-code.ts'
import type { FakeCommandCodeState } from '../../packages/dshx/src/scratch/fake-command-code.ts'
import { card, createFakeHubApp, type FakeHubState } from './fake-hub.ts'
import { createFakeOAuthMcpApp } from './fake-oauth-mcp.ts'

const createOAuthState = () => ({
  codes: new Map<string, { readonly challenge: string; readonly redirectUri: string; readonly clientId: string }>(),
  issuedTokens: new Set<string>(),
  clients: new Map<string, readonly string[]>(),
  registeredClientNames: [] as string[],
  acceptedTokens: new Set<string>(),
})

const origin = 'http://127.0.0.1:45678'

const createCommandState = (): FakeCommandCodeState => ({ requests: [], held: new Set(), oneShotCalls: new Set() })

const sha256 = (value: string): string => createHash('sha256').update(value).digest('base64url')

const createHubState = (): FakeHubState => ({
  items: [
    card({ slug: 'first', name: 'First Plugin', scope: '@e2e/first', compat: '>=0.2.0', stars: 2 }),
    card({ slug: 'second', name: 'Second Plugin', scope: '@e2e/second', compat: '>=0.2.0', stars: 8 }),
  ],
  tarball: '/tmp/fake-hub-target.tgz',
  queries: [],
  failList: false,
  failDetail: false,
})

test('Command Code routes use explicit paths and pure chat dispatch', async () => {
  const state = createCommandState()
  const app = createFakeCommandCodeApp(state)
  const billing = await app.request(`${origin}/alpha/billing/credits`, { headers: { authorization: 'Bearer key-BROKEN' } })
  assert.equal(billing.status, 503)
  const models = await app.request(`${origin}/provider/v1/models`)
  assert.deepEqual(await models.json(), { data: [] })
  const missing = await app.request(`${origin}/unknown`)
  assert.equal(missing.status, 404)

  const response = await app.request(`${origin}/provider/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer key-123456', 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '[[call read {"file_path":"README.md"}]]' }] }),
  })
  assert.equal(response.status, 200)
  const stream = await response.text()
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream\b/)
  assert.match(stream, /call_0_read/)
  assert.match(stream, /"finish_reason":"tool_calls"/)
  assert.match(stream, /data: \[DONE\]/)
  assert.equal(state.requests[0]?.kind, 'turn')

  const missingCredential = await app.request(`${origin}/provider/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer dshx-dev-fake-MISSING', 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Reproduce missing credential recovery.' }] }),
  })
  assert.equal(missingCredential.status, 401)
  assert.deepEqual(await missingCredential.json(), {
    error: { code: 'MISSING_CREDENTIAL', message: 'The fake account has no usable credential.', type: 'authentication_error' },
  })

  const heldResponse = await app.request(`${origin}/provider/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer key-123456', 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '[[hold]]' }] }),
  })
  const heldBody = heldResponse.text()
  assert.equal(state.held.size, 1)
  const release = [...state.held][0]
  assert.ok(release)
  release()
  assert.match(await heldBody, /Held turn released\./)
  assert.equal(state.held.size, 0)
})

test('loopback Command Code serves the same Hono app to a real client', async () => {
  const fake = await startFakeCommandCode()
  try {
    const response = await fetch(`${fake.baseUrl}/provider/v1/models`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { data: [] })
  } finally {
    await fake.close()
  }
})

test('Framework Hub routes filter, sort, fail and serve install detail', async () => {
  const state = createHubState()
  const app = createFakeHubApp(state)
  const filtered = await app.request(`${origin}/api/marketplace/plugins?q=first&sort=stars`)
  const listing = z.object({ items: z.array(z.object({ slug: z.string() })), total: z.number() }).parse(await filtered.json())
  assert.equal(listing.total, 1)
  assert.equal(listing.items[0]?.slug, 'first')
  assert.equal(state.queries[0]?.get('q'), 'first')

  const sorted = await app.request(`${origin}/api/marketplace/plugins?sort=stars`)
  const sortedListing = z.object({ items: z.array(z.object({ slug: z.string() })) }).parse(await sorted.json())
  assert.deepEqual(
    sortedListing.items.map(item => item.slug),
    ['second', 'first'],
  )

  state.failList = true
  assert.equal((await app.request(`${origin}/api/marketplace/plugins`)).status, 503)
  state.failList = false
  const detail = await app.request(`${origin}/api/marketplace/plugins/first`)
  const detailBody = z.object({ plugin: z.object({ slug: z.string() }), installTargets: z.array(z.object({ spec: z.string() })) }).parse(await detail.json())
  assert.equal(detailBody.plugin.slug, 'first')
  assert.equal(detailBody.installTargets[0]?.spec, state.tarball)
  state.failDetail = true
  assert.equal((await app.request(`${origin}/api/marketplace/plugins/first`)).status, 503)
  assert.equal((await app.request(`${origin}/unknown`)).status, 404)
})

test('OAuth metadata uses request origin and avoids caching', async () => {
  const response = await createFakeOAuthMcpApp(createOAuthState()).request(`${origin}/.well-known/oauth-authorization-server`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), {
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  })
})

test('OAuth registration, PKCE and MCP routes enforce issued credentials', async () => {
  const state = createOAuthState()
  const app = createFakeOAuthMcpApp(state)
  const invalidRegistration = await app.request(`${origin}/register`, { method: 'POST', body: '{}' })
  assert.equal(invalidRegistration.status, 400)
  assert.deepEqual(await invalidRegistration.json(), { error: 'invalid_client_metadata' })

  const redirectUri = 'http://127.0.0.1:9000/callback'
  const registration = await app.request(`${origin}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'journey', redirect_uris: [redirectUri] }),
  })
  assert.equal(registration.status, 201)
  const client = z.object({ client_id: z.string() }).parse(await registration.json())
  assert.equal(state.registeredClientNames[0], 'journey')

  const verifier = 'the-verifier-used-by-this-route-test'
  const challenge = sha256(verifier)
  const authorization = new URL(`${origin}/authorize`)
  authorization.searchParams.set('client_id', client.client_id)
  authorization.searchParams.set('redirect_uri', redirectUri)
  authorization.searchParams.set('code_challenge', challenge)
  authorization.searchParams.set('code_challenge_method', 'S256')
  authorization.searchParams.set('state', 'state-token')
  const authorized = await app.request(authorization)
  assert.equal(authorized.status, 302)
  const callback = new URL(authorized.headers.get('location') ?? '')
  assert.equal(callback.searchParams.get('state'), 'state-token')
  assert.equal(callback.searchParams.get('iss'), origin)

  const invalidToken = await app.request(`${origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code') ?? '',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: 'wrong-verifier',
    }),
  })
  assert.equal(invalidToken.status, 400)
  assert.deepEqual(await invalidToken.json(), { error: 'invalid_grant' })

  const tokenResponse = await app.request(`${origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code') ?? '',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  })
  assert.equal(tokenResponse.status, 200)
  const tokenData = z.object({ access_token: z.string() }).parse(await tokenResponse.json())
  const unauthorized = await app.request(`${origin}/mcp`)
  assert.equal(unauthorized.status, 401)
  assert.match(unauthorized.headers.get('www-authenticate') ?? '', /oauth-protected-resource\/mcp/)

  const initialized = await app.request(`${origin}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenData.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
  })
  assert.equal(initialized.status, 200)
  assert.equal(initialized.headers.get('mcp-session-id'), 'fake-session')
  assert.equal(z.object({ result: z.object({ protocolVersion: z.string() }) }).parse(await initialized.json()).result.protocolVersion, '2025-06-18')
  assert.equal(state.acceptedTokens.has(tokenData.access_token), true)
})
