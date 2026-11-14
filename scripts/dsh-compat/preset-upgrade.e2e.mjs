/**
 * Upgrade regression: a custom agent preset saved on dsh 0.2.1 must still give
 * a working new thread after the upgrade to 0.2.2.
 *
 * It runs both real cores, stock, on one throwaway DSH home with no private
 * account state: the model is a local fake Anthropic endpoint. The journey:
 *
 * 1. 0.2.1 boots with the representative preset (fixtures/preset-0.2.1.patch.yml)
 *    as the default, and a thread on it works: the fixture is a real 0.2.1 preset.
 * 2. Control: 0.2.2 on the unmigrated profile marks it broken and refuses a
 *    thread on it (`agent-preset/invalid`). This is the regression.
 * 3. The migration plans exactly the known changes, backs the file up, writes it.
 * 4. Host restart on 0.2.2: the preset mounts; a new thread is created on it,
 *    from the API and from the New session button; each opens in a real browser
 *    whose composer is editable, keeps text and sends; the Host records the
 *    message, the turn completes, and the model request carries the preset's
 *    custom persona and its tools.
 *
 * Run: fnm exec --using="$(cat .node-version)" node --test scripts/dsh-lkg/preset-upgrade.e2e.mjs
 * Cores are installed once into ~/.cache/dshfiles/preset-upgrade-e2e
 * (DSH_PRESET_E2E_CACHE), the same way `dsh-lkg upgrade` installs a candidate.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { startFakeAnthropic } from './fake-anthropic.mjs'
import { Preflight } from './preflight.mjs'
import { PresetChecks } from './preset-checks.mjs'
import { PresetMigration } from './presets.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OLD = '0.2.1-rc.2'
const NEW = '0.2.2-rc.2'
const PRESET = 'reviewer'
const PERSONA = 'meticulous code reviewer'
const CACHE = process.env.DSH_PRESET_E2E_CACHE?.trim() || join(homedir(), '.cache', 'dshfiles', 'preset-upgrade-e2e')
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'preset-0.2.1.patch.yml'), 'utf8')

/** One exact core, installed like `dsh-lkg upgrade` installs a candidate: a private dir and a local virtual store. */
const ensureCore = version => {
  const root = join(CACHE, `dsh-${version}`)
  const entry = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(entry)) return { root, entry }
  mkdirSync(root, { recursive: true })
  if (!existsSync(join(root, 'package.json'))) writeFileSync(join(root, 'package.json'), '{"name":"dsh-core-cache","private":true}\n')
  const installed = spawnSync('pnpm', ['add', '--config.enableGlobalVirtualStore=false', `@deepseek-ai/dsh@${version}`], { cwd: root, encoding: 'utf8' })
  if (!existsSync(entry)) throw new Error(`could not install @deepseek-ai/dsh@${version} into ${root}: ${`${installed.stdout}${installed.stderr}`.slice(-600)}`)
  return { root, entry }
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

/** Boot one core on the shared home and return its authenticated RPC. */
const bootHost = async ({ core, home, userHome, model }) => {
  const port = await freePort()
  const env = {
    PATH: process.env.PATH,
    HOME: userHome,
    DSH_HOME: home,
    DEEPSEEK_API_KEY: 'e2e-fake-key',
    DEEPSEEK_BASE_URL: `${model.url}/anthropic`,
  }
  const child = spawn(process.execPath, [core.entry, 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => (output += String(chunk)))
  child.stderr.on('data', chunk => (output += String(chunk)))
  const stop = async () => {
    if (child.exitCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    await exited
    clearTimeout(timer)
  }
  let url
  for (let attempt = 0; attempt < 240 && url === undefined; attempt++) {
    if (child.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 500))
    url = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/u.exec(output)?.[1]
  }
  if (url === undefined) {
    await stop()
    throw new Error(`dsh ${core.version} never printed its URL:\n${output.slice(-2000)}`)
  }
  const response = await fetch(url, { redirect: 'manual' })
  const cookie = response.headers.getSetCookie()[0]
  const origin = new URL(url).origin
  const rpc = async (namespace, method, args) => {
    const reply = await fetch(`${origin}/api/${namespace}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: `${namespace}/${method}`, payload: { args } }),
    })
    return { status: reply.status, body: await reply.text() }
  }
  return { origin, cookie, rpc, stop, output: () => output }
}

const valueOf = async response => {
  const parsed = JSON.parse((await response).body)
  if (parsed.result?.ok === false) throw new Error(JSON.stringify(parsed.result.error))
  return parsed.result?.value ?? parsed.result
}

const sessionEvents = async (rpc, sessionId) => {
  const projections = await valueOf(rpc('session', 'projections', { request: { sessionId } }))
  const page = await valueOf(
    rpc('session', 'page', { request: { address: { kind: 'session', sessionId }, throughSeq: projections?.asOfSeq ?? 0, maxMessages: 100 } }),
  )
  return page.records.map(record => record.event)
}

const waitForTurnEnd = async (rpc, sessionId, timeoutMs = 90_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const end = (await sessionEvents(rpc, sessionId)).findLast(event => event.type === 'turn/end')
    if (end !== undefined) return end.data?.reason
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`the turn on ${sessionId} never ended`)
}

const withBrowser = async (host, run) => {
  const { chromium } = createRequire(join(HERE, '..', '..', 'tooling', 'dshx', 'packages', 'dshx', 'package.json'))('playwright')
  const browser = await PresetChecks.launchChromium(chromium)
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const [pair] = host.cookie.split(';')
    const separator = pair.indexOf('=')
    await context.addCookies([{ name: pair.slice(0, separator), value: pair.slice(separator + 1), url: host.origin }])
    return await run(await context.newPage())
  } finally {
    await browser.close()
  }
}

const requestText = request => JSON.stringify(request.system ?? '')
const toolNames = request => (request.tools ?? []).map(tool => tool.name)

test('a custom 0.2.1 agent preset gives a usable new thread after the upgrade to 0.2.2', { timeout: 15 * 60_000 }, async t => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24, `dsh ${NEW} needs Node >= 24.9; run under fnm exec --using="$(cat .node-version)"`)
  const oldCore = { ...ensureCore(OLD), version: OLD }
  const newCore = { ...ensureCore(NEW), version: NEW }
  const root = mkdtempSync(join(tmpdir(), 'dsh-preset-upgrade-'))
  const home = join(root, 'dsh-home')
  const userHome = join(root, 'user-home')
  const cwd = join(root, 'workspace')
  for (const directory of [home, userHome, cwd]) mkdirSync(directory, { recursive: true })
  const profile = join(home, 'profiles', 'web')
  // What the source launcher's preflight receives: the new core is the one 'this checkout' installs.
  const startupOptions = core => ({
    sourceRoot: newCore.root,
    dshHome: home,
    profile: 'web',
    coreEntry: core.entry,
    nodeBinary: process.execPath,
    coreEntrySource: 'launcher.json',
    env: { PATH: process.env.PATH, HOME: userHome },
  })
  const model = await startFakeAnthropic()
  const evidence = join(root, 'evidence')
  mkdirSync(evidence)
  t.after(async () => {
    await model.close()
    if (process.env.DSH_PRESET_E2E_KEEP === '1') t.diagnostic(`kept ${root}`)
    else rmSync(root, { recursive: true, force: true })
  })

  await t.test(`the representative preset works on dsh ${OLD}`, async () => {
    // The first boot writes the stock profile; the user's saved preset then goes into its patch.
    const first = await bootHost({ core: oldCore, home, userHome, model })
    await first.stop()
    writeFileSync(join(profile, 'cordis.patch.yml'), FIXTURE)
    const host = await bootHost({ core: oldCore, home, userHome, model })
    try {
      const roster = await PresetChecks.roster({ rpc: host.rpc, presets: [PRESET] })
      assert.ok(roster.ok, roster.detail)
      const created = await PresetChecks.threads({ rpc: host.rpc, presets: [PRESET], cwd })
      assert.ok(created.check.ok, created.check.detail)
    } finally {
      await host.stop()
    }
  })

  await t.test(`preflight refuses dsh ${OLD} forced under a plugin built for ${NEW}, naming both cores`, () => {
    // A copy of the profile that selects one owned bundle requiring the new core, run by the old core: DSH itself only
    // prints a stderr line and starts without the bundle's services.
    const copyHome = join(root, 'old-core-home')
    cpSync(join(home, 'profiles'), join(copyHome, 'profiles'), { recursive: true })
    const copied = join(copyHome, 'profiles', 'web')
    const manifest = JSON.parse(readFileSync(join(copied, 'package.json'), 'utf8'))
    const bundle = join(HERE, '..', '..', 'plugins', '@dshfiles', 'tool-ask-user')
    manifest.dependencies = { ...manifest.dependencies, '@dshfiles/tool-ask-user': `link:${bundle}` }
    manifest.dsh.profile.bundles.push('@dshfiles/tool-ask-user')
    writeFileSync(join(copied, 'package.json'), JSON.stringify(manifest, null, 2))
    mkdirSync(join(copied, 'node_modules', '@dshfiles'), { recursive: true })
    symlinkSync(bundle, join(copied, 'node_modules', '@dshfiles', 'tool-ask-user'))
    const result = Preflight.run({ ...startupOptions(oldCore), dshHome: copyHome, coreEntrySource: 'DSH_CORE_ENTRY' })
    assert.equal(result.ok, false)
    assert.match(
      result.notes.join('\n'),
      new RegExp(`runs dsh ${OLD.replaceAll('.', '\\.')} .*not the core this checkout installs \\(dsh ${NEW.replaceAll('.', '\\.')}`),
    )
    const skip = result.problems.find(problem => problem.check === 'composition')
    assert.match(skip?.message ?? '', /would skip bundle @dshfiles\/tool-ask-user, so every service it provides would be missing/)
    assert.match(skip?.message ?? '', /unset DSH_CORE_ENTRY/)
  })

  await t.test(`control: dsh ${NEW} refuses the unmigrated preset`, async () => {
    const host = await bootHost({ core: newCore, home, userHome, model })
    try {
      const roster = await PresetChecks.roster({ rpc: host.rpc, presets: [PRESET] })
      assert.equal(roster.ok, false)
      assert.match(roster.detail, /list-agents/)
      const created = await PresetChecks.threads({ rpc: host.rpc, presets: [PRESET], cwd })
      assert.equal(created.check.ok, false)
      assert.match(created.check.detail, /agent-preset\/invalid/)
    } finally {
      await host.stop()
    }
  })

  await t.test('the migration backs up the profile and rewrites only the broken references', step => {
    const plan = PresetMigration.plan({ profileDir: profile, coreRoot: newCore.root, from: OLD, home })
    step.diagnostic(PresetMigration.format(plan).join('\n'))
    assert.deepEqual(plan.errors, [])
    assert.deepEqual(plan.presets, [{ id: PRESET, selectedBy: ['registry default'] }])
    assert.deepEqual(
      plan.changes.map(change => change.rule),
      ['list-agents-merged', 'subagent-model-selection-split'],
    )
    // The startup preflight is what applies it, as the supervisor runs it before every Host start.
    const preflight = Preflight.run({ ...startupOptions(newCore), apply: true, hostsRunning: () => [] })
    step.diagnostic(Preflight.format(preflight, { profile: 'web' }).join('\n'))
    assert.deepEqual(preflight.problems, [])
    const [written] = preflight.migrated
    assert.equal(readFileSync(written.backup, 'utf8'), FIXTURE)
    assert.ok(Preflight.run({ ...startupOptions(newCore), apply: true, hostsRunning: () => [] }).ok, 'the next start has nothing left to do')
    const migrated = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
    const code = migrated
      .split('\n')
      .filter(line => !line.trimStart().startsWith('#'))
      .join('\n')
    assert.ok(!code.includes('list-agents') && !code.includes('modelSelectionSettings'), code)
    assert.ok(migrated.includes(PERSONA) && migrated.includes('maxBytes: 32768') && migrated.includes('modelDiscovery: true'))
  })

  await t.test(`after a Host restart on dsh ${NEW}, new threads on the preset work end to end`, async () => {
    const host = await bootHost({ core: newCore, home, userHome, model })
    try {
      const roster = await PresetChecks.roster({ rpc: host.rpc, presets: [PRESET] })
      assert.ok(roster.ok, roster.detail)
      const created = await PresetChecks.threads({ rpc: host.rpc, presets: [PRESET], cwd })
      assert.ok(created.check.ok, created.check.detail)
      const [{ sessionId }] = created.threads

      // The API-created thread runs a real turn on the preset.
      let before = model.requests.length
      await valueOf(
        host.rpc('session', 'prompt', {
          request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: 'Review nothing; reply OK.' }] },
        }),
      )
      const reason = await waitForTurnEnd(host.rpc, sessionId)
      assert.equal(reason?.kind, 'completed', JSON.stringify(reason))
      const sent = model.requests.slice(before).find(request => requestText(request).includes(PERSONA))
      assert.ok(sent !== undefined, `no model request carried the preset's persona (saw ${String(model.requests.length - before)} request(s))`)
      for (const tool of ['list_agents', 'send_message', 'subagent', 'list_subagent_models', 'todo_write']) {
        assert.ok(toolNames(sent).includes(tool), `the preset's request lacks ${tool}: ${toolNames(sent).join(', ')}`)
      }

      // The user's path: the new-thread composer, choose the workspace, type, send.
      await withBrowser(host, async page => {
        before = model.requests.length
        const composer = await PresetChecks.composer(page, { origin: host.origin, rpc: host.rpc, workspace: cwd, submit: true })
        await page.screenshot({ path: join(evidence, 'new-thread.png') })
        assert.ok(composer.ok, composer.detail)
        assert.notEqual(composer.sessionId, sessionId)
        assert.match(await page.locator('body').innerText(), /Reviewer/u, 'the composer does not show the Reviewer preset')
        const uiReason = await waitForTurnEnd(host.rpc, composer.sessionId)
        assert.equal(uiReason?.kind, 'completed', JSON.stringify(uiReason))
        await page.waitForTimeout(1_000)
        await page.screenshot({ path: join(evidence, 'new-thread-answered.png') })
        const uiRequest = model.requests.slice(before).find(request => JSON.stringify(request.messages ?? '').includes(composer.text))
        assert.ok(uiRequest !== undefined, 'the message sent from the composer never reached the model')
        assert.ok(requestText(uiRequest).includes(PERSONA), 'the new thread did not run on the custom preset')
        assert.ok(toolNames(uiRequest).includes('list_agents'), `the new thread lacks list_agents: ${toolNames(uiRequest).join(', ')}`)
      })
    } finally {
      writeFileSync(join(evidence, 'host-0.2.2.log'), host.output().replace(/token=[\w-]+/gu, 'token=<redacted>'))
      await host.stop()
    }
  })
})
