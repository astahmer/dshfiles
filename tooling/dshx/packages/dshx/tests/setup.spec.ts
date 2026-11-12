import * as Schema from 'effect/Schema'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli/run.js'
import { decodeJson } from '../src/json.js'
import { DSHFILES_ROOT } from '../src/project/local-bundles.js'
import { SetupChecks, type SetupProbe } from '../src/setup/setup-checks.js'
import { SetupPlan, type SetupContext, type SetupStateView, type SetupStep } from '../src/setup/setup-plan.js'
import { SetupHttp, type SetupApi, type SetupServer } from '../src/setup/setup-server.js'

interface Reply {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

/** A raw request, so a test can send the Host and Origin headers a browser would never let a page forge. */
const send = (
  server: SetupServer,
  input: { readonly method?: string; readonly path: string; readonly headers?: Record<string, string>; readonly body?: string },
) =>
  new Promise<Reply>((resolveReply, reject) => {
    const outgoing = request(
      {
        host: '127.0.0.1',
        port: server.port,
        method: input.method ?? 'GET',
        path: input.path,
        headers: { host: `127.0.0.1:${String(server.port)}`, ...input.headers },
      },
      response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => (body += chunk))
        response.on('end', () => resolveReply({ status: response.statusCode ?? 0, headers: response.headers, body }))
      },
    )
    outgoing.on('error', reject)
    outgoing.end(input.body)
  })

const json = { 'content-type': 'application/json' }
const planReplySchema = Schema.Struct({ data: Schema.Struct({ problem: Schema.Struct({ message: Schema.String }) }) })
const eventTypeSchema = Schema.Struct({ type: Schema.String })
const tokenOf = (server: SetupServer): string => new URL(server.url).hash.slice('#t='.length)

describe('dshx setup server', () => {
  let staticRoot: string
  let server: SetupServer
  const applied: unknown[] = []
  const state: SetupStateView = {
    checks: [],
    blocking: false,
    packs: [],
    presets: [],
    profiles: [],
    dshHome: '/tmp/home',
    defaults: { profile: 'main', preset: 'daily', packs: undefined },
  }
  const api: SetupApi = {
    state: async () => state,
    plan: async request => ({
      plan: null,
      problem: { message: `planned ${request.profile}`, hint: '' },
      marker: null,
      unbuilt: [],
      buildCommand: null,
      startCommand: '',
      titles: {},
      hash: 'h',
    }),
    apply: async (body, emit) => {
      applied.push(body)
      emit({ type: 'step', step: { id: 'compose', label: 'Link', status: 'running' } })
      emit({ type: 'error', error: { message: 'stopped', hint: '' } })
    },
  }
  const signIn = async (): Promise<string> => {
    const reply = await send(server, { method: 'POST', path: '/api/session', headers: json, body: JSON.stringify({ token: tokenOf(server) }) })
    expect(reply.status).toBe(200)
    const cookie = [reply.headers['set-cookie'] ?? []].flat()[0] ?? ''
    expect(cookie).toMatch(/^dshx_setup=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/$/u)
    return cookie.split(';')[0] ?? ''
  }

  beforeEach(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), 'dshx-setup-ui-'))
    writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>setup</title>')
    server = await SetupHttp.start({ api, staticRoot })
  })

  afterEach(async () => {
    await server.close()
    rmSync(staticRoot, { recursive: true, force: true })
  })

  it('listens on 127.0.0.1 with a 256-bit token in the fragment only', () => {
    const url = new URL(server.url)
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.search).toBe('')
    expect(Buffer.from(tokenOf(server), 'base64url')).toHaveLength(32)
  })

  it('exchanges the token once for an HttpOnly cookie, and refuses the API without that cookie', async () => {
    expect((await send(server, { path: '/api/state' })).status).toBe(401)
    expect((await send(server, { method: 'POST', path: '/api/session', headers: json, body: JSON.stringify({ token: 'wrong' }) })).status).toBe(401)
    const cookie = await signIn()
    const reused = await send(server, { method: 'POST', path: '/api/session', headers: json, body: JSON.stringify({ token: tokenOf(server) }) })
    expect(reused.status).toBe(401)
    expect(reused.body).toContain('already used')
    expect((await send(server, { path: '/api/state', headers: { cookie: 'dshx_setup=forged' } })).status).toBe(401)
    const reply = await send(server, { path: '/api/state', headers: { cookie } })
    expect(reply.status).toBe(200)
    expect(decodeJson(Schema.Json, reply.body)).toEqual({ ok: true, data: state })
  })

  it('refuses another Host (DNS rebinding) and another Origin (CSRF), even with the cookie', async () => {
    const cookie = await signIn()
    const rebound = await send(server, { path: '/api/state', headers: { cookie, host: `evil.example:${String(server.port)}` } })
    expect(rebound.status).toBe(421)
    expect((await send(server, { path: '/', headers: { host: 'evil.example' } })).status).toBe(421)
    const crossSite = await send(server, {
      method: 'POST',
      path: '/api/plan',
      headers: { ...json, cookie, origin: 'https://evil.example' },
      body: '{}',
    })
    expect(crossSite.status).toBe(403)
    const fetchSite = await send(server, { path: '/api/state', headers: { cookie, 'sec-fetch-site': 'cross-site' } })
    expect(fetchSite.status).toBe(403)
    const sameOrigin = await send(server, {
      method: 'POST',
      path: '/api/plan',
      headers: { ...json, cookie, origin: `http://127.0.0.1:${String(server.port)}` },
      body: '{"profile":"main","packs":[],"extend":false}',
    })
    expect(decodeJson(planReplySchema, sameOrigin.body).data.problem.message).toBe('planned main')
    const malformed = await send(server, {
      method: 'POST',
      path: '/api/plan',
      headers: { ...json, cookie },
      body: '{"profile":"../web","packs":[],"extend":false}',
    })
    expect(malformed.status).toBe(400)
  })

  it('takes JSON bodies only, at most 64 KB, and streams apply as NDJSON', async () => {
    const cookie = await signIn()
    expect((await send(server, { method: 'POST', path: '/api/plan', headers: { cookie, 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
    const large = JSON.stringify({ pad: 'x'.repeat(70 * 1024) })
    expect((await send(server, { method: 'POST', path: '/api/plan', headers: { ...json, cookie }, body: large })).status).toBe(413)
    const stream = await send(server, {
      method: 'POST',
      path: '/api/apply',
      headers: { ...json, cookie },
      body: JSON.stringify({ request: { profile: 'main', packs: [], extend: false }, hash: 'h' }),
    })
    expect(stream.headers['content-type']).toContain('application/x-ndjson')
    expect(
      stream.body
        .trim()
        .split('\n')
        .map(line => decodeJson(eventTypeSchema, line).type),
    ).toEqual(['step', 'error'])
    expect(applied).toContainEqual({ request: { profile: 'main', packs: [], extend: false }, hash: 'h' })
  })

  it('serves the page with a strict CSP and never a file outside it', async () => {
    const page = await send(server, { path: '/' })
    expect(page.status).toBe(200)
    expect(page.headers['content-security-policy']).toContain("script-src 'self'")
    expect(page.headers['cache-control']).toBe('no-store')
    const escaped = await send(server, { path: '/../../package.json' })
    expect(escaped.body).toBe('<!doctype html><title>setup</title>')
    const encoded = await send(server, { path: '/%2e%2e/%2e%2e/package.json' })
    expect(encoded.body).toBe('<!doctype html><title>setup</title>')
  })

  it('stops on shutdown', async () => {
    const cookie = await signIn()
    const reply = await send(server, { method: 'POST', path: '/api/shutdown', headers: { ...json, cookie }, body: '{}' })
    expect(reply.status).toBe(200)
    await server.closed
  })
})

describe('dshx setup checks', () => {
  const probe = (overrides: Partial<SetupProbe>): SetupProbe => ({
    root: DSHFILES_ROOT,
    dshHome: join(tmpdir(), 'dshx-setup-checks-missing-home'),
    env: process.env,
    nodeVersion: `v${readFileSync(join(DSHFILES_ROOT, '.node-version'), 'utf8').trim()}`,
    nodeExecPath: process.execPath,
    run: async command => (command === 'gh' ? { found: false, exitCode: null, stdout: '' } : { found: true, exitCode: 0, stdout: `${command} 1.0.0` }),
    runningHosts: async () => [],
    ...overrides,
  })
  const stateOf = async (overrides: Partial<SetupProbe>) =>
    Object.fromEntries((await SetupChecks.inspect(probe(overrides))).checks.map(check => [check.id, check.state]))

  it('fails a Node other than the pinned one and a Nix-built Node, and only warns for optional tools', async () => {
    expect(await stateOf({})).toMatchObject({ 'node-version': 'ok', 'node-origin': 'ok', pnpm: 'ok', checkout: 'ok', gh: 'warn' })
    expect(await stateOf({ nodeVersion: 'v22.0.0' })).toMatchObject({ 'node-version': 'fail' })
    expect(await stateOf({ nodeExecPath: '/nix/store/abc-nodejs-24/bin/node' })).toMatchObject({ 'node-origin': 'fail' })
    const noTools = await SetupChecks.inspect(
      probe({ run: async command => (command === 'pnpm' ? { found: true, exitCode: 0, stdout: '12.5.1' } : { found: false, exitCode: null, stdout: '' }) }),
    )
    expect(Object.fromEntries(noTools.checks.map(check => [check.id, check.state]))).toMatchObject({
      fnm: 'warn',
      jj: 'warn',
      git: 'warn',
      gh: 'warn',
      dsh: 'fail',
    })
    expect(SetupChecks.blocking(noTools.checks)).toBe(true)
  })

  it('keeps directories out of the visible detail', async () => {
    const { checks } = await SetupChecks.inspect(probe({}))
    expect(checks.find(check => check.id === 'dsh-home')).toMatchObject({ detail: 'New', path: join(tmpdir(), 'dshx-setup-checks-missing-home') })
    expect(checks.find(check => check.id === 'checkout')).toMatchObject({ detail: 'Dependencies installed', path: DSHFILES_ROOT })
  })

  it('never shows what gh prints, only whether it is signed in', async () => {
    const checks = await SetupChecks.inspect(
      probe({
        run: async (command, args) => ({
          found: true,
          exitCode: 0,
          stdout: command === 'gh' && args[0] === 'auth' ? 'Logged in to github.com account someone' : '1.0',
        }),
      }),
    )
    expect(checks.checks.find(check => check.id === 'gh')).toMatchObject({ state: 'ok', detail: 'Signed in' })
    expect(JSON.stringify(checks)).not.toContain('someone')
  })
})

const markerSchema = Schema.Struct({ schemaVersion: Schema.Literal(1), composedBy: Schema.Literal('dshx setup'), packs: Schema.Array(Schema.String) })

describe('dshx setup plan and apply', () => {
  let home: string
  let running: readonly number[]
  const context = (): SetupContext => ({ root: DSHFILES_ROOT, dshHome: home, env: process.env, runningHosts: async () => running })
  const profileRoot = () => join(home, 'profiles/probe-setup')
  const request = { profile: 'probe-setup', packs: ['versioning'], extend: false }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshx-setup-'))
    running = []
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('previews the exact plan with the setup marker and writes nothing', async () => {
    const result = await SetupPlan.plan(context(), request)
    expect(result.problem).toBeNull()
    expect(result.plan).toMatchObject({ profile: 'probe-setup', created: true, dryRun: true })
    expect(result.plan?.plugins).toEqual(expect.arrayContaining(['@dshfiles/onboarding', '@dshfiles/ai-accounts', '@dshfiles/jj-integration']))
    expect(result.marker).toEqual({ path: join(profileRoot(), 'dshfiles-setup.json'), packs: ['core', 'versioning'] })
    expect(result.startCommand).toMatch(/^DSH_HOME=\S+ fnm exec --using=\S+ \S+ --profile probe-setup web$/u)
    expect(Object.keys(result.titles)).toEqual(result.plan?.plugins)
    expect(Object.values(result.titles).filter(title => title === '' || title.startsWith('@dshfiles/'))).toEqual([])
    expect(readdirSync(home)).toEqual([])
  })

  it('applies the reviewed plan, records the marker, and changes nothing on a second run', async () => {
    const reviewed = await SetupPlan.plan(context(), request)
    const steps: SetupStep[] = []
    await SetupPlan.apply(context(), { request, hash: reviewed.hash, onStep: step => steps.push(step) })
    expect(steps.map(step => `${step.id}:${step.status}`)).toEqual(['compose:running', 'compose:done', 'record:running', 'record:done'])
    const marker = decodeJson(markerSchema, readFileSync(join(profileRoot(), 'dshfiles-setup.json'), 'utf8'))
    expect(marker.packs).toEqual(['core', 'versioning'])
    const manifest = readFileSync(join(profileRoot(), 'package.json'), 'utf8')
    expect(manifest).toContain('"@dshfiles/onboarding"')

    const again = await SetupPlan.plan(context(), request)
    expect(again.plan?.upToDate).toBe(true)
    expect(again.marker).toBeNull()
    const repeated: SetupStep[] = []
    await SetupPlan.apply(context(), { request, hash: again.hash, onStep: step => repeated.push(step) })
    expect(repeated.map(step => step.id)).toEqual(['compose', 'compose'])
    expect(readFileSync(join(profileRoot(), 'package.json'), 'utf8')).toBe(manifest)
  }, 240_000)

  it('refuses a plan that changed since review, and writes nothing', async () => {
    await expect(SetupPlan.apply(context(), { request, hash: 'stale', onStep: () => undefined })).rejects.toThrow('changed since you reviewed')
    expect(existsSync(profileRoot())).toBe(false)
  })

  it('never writes the seeded web profile or a profile a running DSH serves', async () => {
    const web = await SetupPlan.plan(context(), { ...request, profile: 'web' })
    expect(web.problem?.message).toContain('follows the repository')
    await expect(SetupPlan.apply(context(), { request: { ...request, profile: 'web' }, hash: web.hash, onStep: () => undefined })).rejects.toThrow(
      'follows the repository',
    )
    expect(existsSync(join(home, 'profiles/web'))).toBe(false)

    running = [4242]
    const served = await SetupPlan.plan(context(), request)
    expect(served.problem?.hint).toContain('Stop that DSH yourself')
    expect(served.plan).toBeNull()
  })

  it('keeps an existing profile with other plugins unless asked to extend it', async () => {
    mkdirSync(profileRoot(), { recursive: true })
    const manifest = { name: 'dsh-profile-probe-setup', private: true, dependencies: {}, dsh: { profile: { bundles: ['@dshfiles/backlog'] } } }
    writeFileSync(join(profileRoot(), 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const refused = await SetupPlan.plan(context(), request)
    expect(refused.problem?.hint).toContain('--extend')
    const extended = await SetupPlan.plan(context(), { ...request, extend: true })
    expect(extended.plan?.kept).toEqual(['@dshfiles/backlog'])
    expect(extended.marker).toBeNull()
  })
})

describe('dshx setup --yes', () => {
  let home: string
  const capture = () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let out = ''
    let err = ''
    stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')))
    return { io: { stdin: new PassThrough(), stdout, stderr }, output: () => out, errors: () => err }
  }
  const envelopeSchema = Schema.Struct({
    ok: Schema.Boolean,
    data: Schema.optional(
      Schema.Struct({ marker: Schema.NullOr(Schema.Struct({ path: Schema.String, packs: Schema.Array(Schema.String) })), startCommand: Schema.String }),
    ),
    error: Schema.optional(Schema.Struct({ message: Schema.String })),
  })

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dshx-setup-yes-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('runs a preset headless, the same plan the page applies, and refuses web and an unknown preset', async () => {
    const run = capture()
    const status = await runCli(['setup', '--yes', '--json', '--preset', 'essentials', '--profile', 'probe-setup', '--home', home], { io: run.io })
    expect(status, `${run.output()}\n${run.errors()}`).toBe(0)
    const envelope = decodeJson(envelopeSchema, run.output())
    expect(envelope.data?.marker?.packs).toEqual(['core'])
    expect(envelope.data?.startCommand).toContain('--profile probe-setup web')
    expect(existsSync(join(home, 'profiles/probe-setup/dshfiles-setup.json'))).toBe(true)

    const web = capture()
    expect(await runCli(['setup', '--yes', '--json', '--profile', 'web', '--home', home], { io: web.io })).toBe(1)
    expect(decodeJson(envelopeSchema, web.output()).error?.message).toContain('follows the repository')

    const unknown = capture()
    expect(await runCli(['setup', '--yes', '--preset', 'nope', '--home', home], { io: unknown.io })).toBe(2)
    expect(unknown.errors()).toContain('essentials, daily, team, everything')

    const alias = capture()
    expect(await runCli(['init', '--ui', '--help'], { io: alias.io })).toBe(0)
    expect(alias.output()).toContain('dshx setup')
  }, 240_000)
})
