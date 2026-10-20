#!/usr/bin/env node
/**
 * Last Known Good (LKG) snapshots for this DSH installation.
 *
 * A snapshot is a complete, self-contained runtime — core build, plugin
 * bundles, web profile and the launcher — cloned with APFS copy-on-write so a
 * version costs almost no disk. A deployment is promoted only after the
 * candidate boots on its own port with its own writable state and answers an
 * authenticated request; until then the previous known-good snapshot is the
 * one `dsh-recover` starts.
 *
 * This tool is for the operator. It refuses to run from inside a DSH agent
 * session unless DSH_LKG_ADMIN=1 is set explicitly, and every promoted version
 * is frozen with macOS immutable flags.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const STORE = resolve(process.env.DSH_LKG_ROOT?.trim() || join(homedir(), '.dsh-lkg'))
const VERSIONS = join(STORE, 'versions')
const STATE = join(STORE, 'state')
const LOGS = join(STORE, 'logs')
const CURRENT = join(STORE, 'current')
/** Versions kept besides `current`: recovery only ever goes back to the last known good, never n-2. */
const DEFAULT_KEEP = 0
/** A staging tree older than this belongs to no running snapshot. */
const STALE_STAGING_MS = 60 * 60_000
const HEALTH_TIMEOUT_MS = 90_000
const CLIENT_SETTLE_MS = 45_000
const TURN_TIMEOUT_MS = 180_000
const TURN_PROMPT = 'Health check from dsh-lkg: reply with the single word OK. Do not call any tools.'
// The parts of a DSH_HOME a snapshot owns or that are disposable; dsh-recover skips the same ones.
const LIVE_HOME_EXCLUDES = new Set(['profiles', 'logs', 'cache', 'runtime', 'jj-isolation'])
/**
 * Failure codes that mean the provider or the account refused the request, not
 * that this runtime cannot assemble or run a turn. Anything else — `UNKNOWN`
 * (prompt-assembly errors such as an unknown `{{cwd}}` variable), `NO_ADAPTER`,
 * `INVALID_REQUEST`, or a code this list has never seen — fails closed.
 */
const PROVIDER_FAILURE_CODES = new Set([
  'ACCOUNT_FAILOVER',
  'ACCOUNT_QUOTA',
  'AUTH',
  'AUTHCODE_EXPIRED',
  'EMPTY_RESPONSE',
  'FORBIDDEN',
  'INVALID_CREDENTIAL',
  'MISSING_CREDENTIAL',
  'NETWORK',
  'PI_AI_ERROR',
  'PROVIDER_HTTP_ERROR',
  'QUOTA',
  'RATE_LIMIT',
  'SERVER',
  'STREAM_CLOSED',
  'TIMEOUT',
  'TRANSPORT',
  'UNAUTHORIZED',
])

const fail = message => {
  process.stderr.write(`dsh-lkg: ${message}\n`)
  process.exit(1)
}

const log = message => process.stdout.write(`${message}\n`)

/**
 * The store is operator-owned. A DSH agent inherits this environment, so the
 * explicit variable is the difference between a human running the tool and an
 * agent reaching for it.
 */
const requireOperator = () => {
  if (process.env.DSH_LKG_ADMIN === '1') return
  if (process.env.DSH_AGENT_ID || process.env.DSH_SESSION_ID) {
    fail('refusing to touch the recovery store from a DSH agent session. Run it yourself, or set DSH_LKG_ADMIN=1 if you really mean to.')
  }
}

const run = (argv, options = {}) => {
  const result = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const supportsClone = () => {
  const probe = join(process.env.TMPDIR ?? '/tmp', `dsh-lkg-clone-${randomUUID()}`)
  try {
    mkdirSync(probe)
    writeFileSync(join(probe, 'a'), 'x')
    const copied = run(['cp', '-c', join(probe, 'a'), join(probe, 'b')])
    return copied.status === 0
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

/** Copy a tree, preferring APFS clones and preserving symlinks. */
const cloneTree = (from, to, { dereference = false } = {}) => {
  mkdirSync(dirname(to), { recursive: true })
  const flags = ['-R', ...(dereference ? ['-L'] : []), ...(supportsClone() ? ['-c'] : [])]
  const copied = run(['cp', ...flags, from, to])
  if (copied.status !== 0) fail(`could not copy ${from}: ${copied.stderr.trim() || copied.status}`)
}

const frozen = path => {
  const result = run(['chflags', '-R', 'uchg', path])
  return result.status === 0
}

const thawed = path => {
  run(['chflags', '-R', 'nouchg', path])
}

const isFrozen = path => run(['ls', '-lO', path]).stdout.includes('uchg')

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

const versionIds = () => {
  if (!existsSync(VERSIONS)) return []
  return readdirSync(VERSIONS)
    .filter(name => !name.startsWith('.'))
    .filter(name => existsSync(join(VERSIONS, name, 'manifest.json')))
    .sort()
}

const currentVersionId = () => {
  try {
    return basename(resolve(dirname(CURRENT), readlinkRelative(CURRENT)))
  } catch {
    return undefined
  }
}

const readlinkRelative = path => {
  const result = run(['readlink', path])
  if (result.status !== 0) throw new Error(`not a link: ${path}`)
  return result.stdout.trim()
}

const dshEntryOf = root => join(root, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

/**
 * The pnpm global store directory moves on every `pnpm add -g`, so the install
 * root is resolved from the `dsh` shim on PATH: its target is the real package
 * inside `<root>/node_modules/.pnpm/`, and `<root>/node_modules` is the tree
 * DSH resolves.
 */
const installedGlobalRoot = () => {
  const shim = run(['sh', '-c', 'command -v dsh']).stdout.trim()
  if (shim.length === 0) fail('no dsh on PATH; set DSH_LKG_GLOBAL to the global install root')
  return globalRootOfShim(shim)
}

const globalRootOfShim = shim => {
  const target = /cmd-shim-target=(.+)$/m.exec(readFileSync(shim, 'utf8'))?.[1]?.trim()
  const packageDirectory = realpathSync(target === undefined ? shim : dirname(dirname(target)))
  const marker = '/node_modules/.pnpm/'
  const index = packageDirectory.indexOf(marker)
  if (index === -1) fail(`cannot locate the global install root from ${packageDirectory}; set DSH_LKG_GLOBAL`)
  return packageDirectory.slice(0, index)
}

const linkedPluginDirectories = profileSource => {
  const linkedDir = join(profileSource, 'node_modules', '@dshfiles')
  if (!existsSync(linkedDir)) return []
  return readdirSync(linkedDir).flatMap(name => {
    const real = run(['realpath', join(linkedDir, name)]).stdout.trim()
    return real.length === 0 || !existsSync(real) ? [] : [{ name, real }]
  })
}

/**
 * What a snapshot would capture, cheaply: the core version, the profile's
 * manifest and patch, and every linked plugin's built output (path, size,
 * mtime). Two equal fingerprints mean a new snapshot would be the same runtime.
 */
const liveFingerprint = (profileSource, globalRoot) => {
  const hash = createHash('sha256')
  hash.update(readJson(join(globalRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))?.version ?? 'unknown')
  for (const file of ['package.json', 'cordis.patch.yml']) {
    const path = join(profileSource, file)
    if (existsSync(path)) hash.update(readFileSync(path))
  }
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        const stats = statSync(path)
        hash.update(`${path}\0${String(stats.size)}\0${String(stats.mtimeMs)}\n`)
      }
    }
  }
  for (const plugin of linkedPluginDirectories(profileSource)) {
    hash.update(plugin.name)
    const dist = join(plugin.real, 'dist')
    if (existsSync(dist)) walk(dist)
  }
  return hash.digest('hex')
}

const freePort = async () => {
  const { createServer } = await import('node:net')
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * The Host can boot cleanly while the browser half fails: a client plugin that
 * throws in `apply` only shows up as the "Failed to load plugins" card. Load the
 * real page in headless Chromium and refuse the snapshot when that card names
 * entries that did not activate. Playwright comes from dshx's own dependencies.
 */
const clientBootCheck = async ({ origin, cookie }) => {
  if (origin === undefined || cookie === undefined) return { name: 'client-boot', ok: false, detail: 'the page was never reachable' }
  let chromium
  try {
    chromium = createRequire(join(HERE, '..', '..', 'tooling', 'dshx', 'packages', 'dshx', 'package.json'))('playwright').chromium
  } catch (error) {
    return { name: 'client-boot', ok: false, detail: `playwright is unavailable: ${String(error).slice(0, 160)}` }
  }
  const [pair] = cookie.split(';')
  const separator = pair.indexOf('=')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    await context.addCookies([{ name: pair.slice(0, separator), value: pair.slice(separator + 1), url: origin }])
    const page = await context.newPage()
    await page.goto(origin, { waitUntil: 'load', timeout: 60_000 })
    // DSH publishes its own boot readiness promise; a failed entry still shows
    // the "Failed to load plugins" card after that promise settles.
    const outcome = await page.evaluate(async settleMs => {
      const signal = window.__DSH_BOOT_READY__?.promise
      const readiness =
        signal === undefined
          ? 'missing'
          : await Promise.race([
              Promise.resolve(signal).then(
                () => 'resolved',
                () => 'rejected',
              ),
              new Promise(resolve => setTimeout(() => resolve('timed out'), settleMs)),
            ])
      await new Promise(resolve => setTimeout(resolve, 2000))
      return { readiness, text: document.body.innerText }
    }, CLIENT_SETTLE_MS)
    const failure = /Failed to load plugins[\s\S]{0,3000}/.exec(outcome.text)?.[0]
    if (failure !== undefined) return { name: 'client-boot', ok: false, detail: failure.replace(/\s+/g, ' ').slice(0, 3000) }
    if (outcome.readiness !== 'resolved') return { name: 'client-boot', ok: false, detail: `DSH client readiness ${outcome.readiness}` }
    return { name: 'client-boot', ok: true, detail: 'DSH client readiness resolved with no failed entries' }
  } catch (error) {
    return { name: 'client-boot', ok: false, detail: String(error).slice(0, 200) }
  } finally {
    await browser.close()
  }
}

/**
 * Decide whether one health-check turn proves the runtime works, from the
 * Session events it produced. A completed turn passes. A turn that failed
 * because the provider or account refused it passes too: the Host assembled and
 * sent the request, so the runtime is fine and the account is not this check's
 * business. Every other ending fails, including no ending at all.
 */
const classifyTurn = events => {
  const header = events.findLast(event => event.type === 'request/header')?.data?.header?.config
  const route = header === undefined ? 'no request sent' : `${header.provider}/${header.model}`
  const end = events.findLast(event => event.type === 'turn/end')
  if (end === undefined) {
    const lastAttempt = events.findLast(event => event.type === 'assistant/attempt')
    const failure = lastAttempt?.data?.stream?.findLast(item => item.chunk?.type === 'finish')?.chunk?.reason?.failure
    if (failure !== undefined && PROVIDER_FAILURE_CODES.has(failure.code)) {
      return { ok: true, outcome: 'retrying', detail: `${route}: provider still refusing (${failure.code}): ${failure.message}` }
    }
    return { ok: false, outcome: 'pending', detail: `${route}: the turn never ended` }
  }
  const reason = end.data?.reason ?? {}
  if (reason.kind === 'completed' || reason.kind === 'max-tokens') return { ok: true, outcome: 'completed', detail: `${route}: turn ${reason.kind}` }
  if (reason.kind === 'error') {
    const code = reason.error?.code ?? 'UNKNOWN'
    const message = String(reason.error?.message ?? '').slice(0, 300)
    if (PROVIDER_FAILURE_CODES.has(code)) return { ok: true, outcome: 'provider', detail: `${route}: provider refused (${code}): ${message}` }
    return { ok: false, outcome: 'host', detail: `${route}: turn failed (${code}): ${message}` }
  }
  return { ok: false, outcome: 'host', detail: `${route}: turn ended ${String(reason.kind)}` }
}

/**
 * Run one real turn through the Session RPC the browser uses: create a Session,
 * optionally pin its model, prompt it, and read its log until the turn ends.
 */
const turnCheck = async ({ rpc, cwd, model }) => {
  const valueOf = async response => {
    const parsed = response.status === 200 ? JSON.parse(response.body) : undefined
    if (parsed?.result?.ok === false || parsed?.error !== undefined || parsed === undefined) {
      throw new Error(`HTTP ${response.status}: ${response.body.slice(0, 300)}`)
    }
    return parsed.result?.value ?? parsed.result
  }
  try {
    const created = await valueOf(await rpc('session', 'create', { request: { cwd } }))
    const sessionId = created.sessionId
    if (model !== undefined) {
      const slash = model.indexOf('/')
      await valueOf(await rpc('session', 'selectModel', { request: { sessionId, provider: model.slice(0, slash), model: model.slice(slash + 1) } }))
    }
    await valueOf(
      await rpc('session', 'prompt', {
        request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: TURN_PROMPT }] },
      }),
    )
    const deadline = Date.now() + TURN_TIMEOUT_MS
    let verdict
    while (Date.now() < deadline) {
      await sleep(2000)
      const projections = await valueOf(await rpc('session', 'projections', { request: { sessionId } }))
      if (projections?.kind !== 'sequenced') continue
      const page = await valueOf(
        await rpc('session', 'page', { request: { address: { kind: 'session', sessionId }, throughSeq: projections.asOfSeq, maxMessages: 50 } }),
      )
      verdict = classifyTurn(page.records.map(record => record.event))
      if (verdict.outcome !== 'pending' && verdict.outcome !== 'retrying') break
    }
    await rpc('session', 'cancel', { request: { sessionId } }).catch(() => undefined)
    verdict ??= { ok: false, outcome: 'pending', detail: 'the Session log never became readable' }
    return { name: 'turn', ok: verdict.ok, detail: `${verdict.outcome}: ${verdict.detail}` }
  } catch (error) {
    return { name: 'turn', ok: false, detail: String(error).slice(0, 400) }
  }
}

/** Clone the live DSH_HOME's data (accounts, credentials, plugin storage, threads) the way dsh-recover does. */
const cloneLiveData = (liveHome, home) => {
  if (!existsSync(liveHome)) return
  for (const entry of readdirSync(liveHome)) {
    if (LIVE_HOME_EXCLUDES.has(entry)) continue
    cloneTree(join(liveHome, entry), join(home, entry))
  }
  run(['find', join(home, 'sessions'), '-name', 'session.lock', '-delete'])
}

/**
 * Boot one version on a private port with private state and require that it
 * activates cleanly and answers an authenticated request. Nothing is promoted
 * on a partial pass.
 */
const healthCheck = async (root, { keepState = false, turn } = {}) => {
  const checks = []
  const entry = dshEntryOf(root)
  const nodePath = readFileSync(join(root, 'runtime', 'node-path'), 'utf8').trim()
  if (!existsSync(nodePath)) return { healthy: false, checks: [{ name: 'node', ok: false, detail: `recorded node is gone: ${nodePath}` }] }
  checks.push({ name: 'node', ok: true, detail: nodePath })
  if (!existsSync(entry)) return { healthy: false, checks: [...checks, { name: 'core', ok: false, detail: `missing ${entry}` }] }

  const home = join(STATE, `verify-${randomUUID()}`)
  mkdirSync(home, { recursive: true })
  // A real turn needs the live accounts and credentials; the other checks run on an empty state.
  if (turn !== undefined) cloneLiveData(resolve(process.env.DSH_LKG_LIVE_HOME?.trim() || join(homedir(), '.dsh')), home)
  cloneTree(join(root, 'profile'), join(home, 'profiles', 'web'))
  // The snapshot's payload is frozen; a state the Host runs from must not be, or
  // the Host cannot maintain its own profile and the state cannot be removed.
  thawed(join(home, 'profiles', 'web'))
  const port = await freePort()
  const child = spawn(nodePath, [entry, 'web', '--port', String(port), '--no-open'], {
    env: { ...process.env, DSH_HOME: home, DSH_LKG_RECOVER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => (output += String(chunk)))
  child.stderr.on('data', chunk => (output += String(chunk)))
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  let url
  while (Date.now() < deadline) {
    const match = /(http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/.exec(output)
    if (match) {
      url = match[1]
      break
    }
    if (child.exitCode !== null) break
    await sleep(500)
  }
  // A skipped bundle is not an activation failure to DSH, but it means the
  // snapshot would start without its plugins — exactly what this check exists
  // to refuse.
  const allowedSkips = (process.env.DSH_LKG_ALLOW_SKIPPED ?? '')
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0)
  const failures = output
    .split('\n')
    .filter(line => /did not activate|failed to import|startup failed|skipping profile bundle/i.test(line))
    .filter(line => !allowedSkips.some(name => line.includes(`skipping profile bundle "${name}"`)))
  if (failures.length > 0) checks.push({ name: 'activation', ok: false, detail: failures.join(' | ').slice(0, 600) })
  else checks.push({ name: 'activation', ok: true, detail: 'no activation failures or skipped bundles reported' })

  let answered = false
  let origin
  let cookie
  if (url !== undefined) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      answered = response.status === 200 || response.status === 303
      const parsed = new URL(url)
      origin = parsed.origin
      cookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? undefined
      checks.push({ name: 'authenticated-index', ok: answered, detail: `HTTP ${response.status}` })
    } catch (error) {
      checks.push({ name: 'authenticated-index', ok: false, detail: String(error).slice(0, 200) })
    }
  } else {
    checks.push({ name: 'authenticated-index', ok: false, detail: 'the Host never printed a tokenized URL' })
  }

  /**
   * A launch URL that answers proves the shell boots, not that the Host works.
   * These two call the authenticated API the way the client does, then load a
   * real thread, so a snapshot that serves a page but cannot answer its own
   * sessions API is refused rather than promoted.
   */
  const rpc = async (namespace, method, args) => {
    const response = await fetch(`${origin}/api/${namespace}/${method}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: `${namespace}/${method}`, payload: { args } }),
    })
    return { status: response.status, body: await response.text() }
  }

  if (origin === undefined || cookie === undefined || !answered) {
    checks.push({ name: 'session-api', ok: false, detail: 'no authenticated session cookie, so the API cannot be called' })
    checks.push({ name: 'thread-load', ok: false, detail: 'the API was never reached' })
  } else {
    let listed
    try {
      const response = await rpc('session', 'list', { _request: {} })
      const parsed = response.status === 200 ? JSON.parse(response.body) : undefined
      // The RPC envelope is `{ result: { ok, value } }`.
      const value = parsed?.result?.value ?? parsed?.result ?? parsed
      const items = Array.isArray(value?.items) ? value.items : undefined
      listed = items
      checks.push({
        name: 'session-api',
        ok: items !== undefined,
        detail: items === undefined ? `HTTP ${response.status}: ${response.body.slice(0, 200)}` : `HTTP 200, ${String(items.length)} thread(s)`,
      })
    } catch (error) {
      checks.push({ name: 'session-api', ok: false, detail: String(error).slice(0, 200) })
    }

    // Load a real thread when the snapshot has one. A fresh recovery state has
    // none, so a thread is created in this throwaway state instead — that is
    // what proves the load path rather than only the list endpoint.
    let threadId = listed?.[0]?.id ?? listed?.[0]?.sessionId
    let created = false
    if (threadId === undefined) {
      try {
        const response = await rpc('session', 'create', { request: {} })
        const parsed = response.status === 200 ? JSON.parse(response.body) : undefined
        const result = parsed?.result?.value ?? parsed?.result ?? parsed
        threadId = result?.session?.id ?? result?.id ?? result?.sessionId
        created = threadId !== undefined
      } catch {
        threadId = undefined
      }
    }
    if (threadId === undefined) {
      checks.push({ name: 'thread-load', ok: true, detail: 'no thread to load and this Host would not create one; the list endpoint answered instead' })
    } else {
      try {
        const projections = await rpc('session', 'projections', { request: { sessionId: threadId } })
        const asOfSeq = projections.status === 200 ? JSON.parse(projections.body)?.result?.value?.asOfSeq : undefined
        const response = await rpc('session', 'page', {
          request: { address: { kind: 'session', sessionId: threadId }, throughSeq: asOfSeq ?? 0, maxMessages: 20 },
        })
        const parsed = response.status === 200 ? JSON.parse(response.body) : undefined
        const records = parsed?.result?.ok === false ? undefined : (parsed?.result?.value ?? parsed?.result)?.records
        checks.push({
          name: 'thread-load',
          ok: Array.isArray(records),
          detail: `${created ? 'created then loaded' : 'loaded'} ${threadId}: ${Array.isArray(records) ? `${String(records.length)} record(s)` : `HTTP ${response.status} ${response.body.slice(0, 160)}`}`,
        })
      } catch (error) {
        checks.push({ name: 'thread-load', ok: false, detail: String(error).slice(0, 200) })
      }
    }
  }

  if (turn !== undefined) {
    if (origin === undefined || cookie === undefined || !answered) checks.push({ name: 'turn', ok: false, detail: 'the API was never reached' })
    else {
      const cwd = join(home, 'turn-cwd')
      mkdirSync(cwd, { recursive: true })
      checks.push(await turnCheck({ rpc, cwd, model: turn.model }))
    }
  }

  checks.push(await clientBootCheck({ origin, cookie }))

  child.kill('SIGTERM')
  await sleep(1500)
  if (child.exitCode === null) child.kill('SIGKILL')
  writeFileSync(join(LOGS, `health-${basename(root).replace(/^\./, '')}.log`), output.replace(/token=[A-Za-z0-9_-]+/g, 'token=<redacted>'))
  if (!keepState) rmSync(home, { recursive: true, force: true })
  const healthy = checks.every(check => check.ok)
  return { healthy, checks, url: url === undefined ? null : url.replace(/token=[A-Za-z0-9_-]+/, 'token=<redacted>') }
}

const writeLauncher = () => {
  mkdirSync(join(STORE, 'bin'), { recursive: true })
  const source = join(HERE, 'dsh-recover')
  const target = join(STORE, 'bin', 'dsh-recover')
  thawed(target)
  copyFileSync(source, target)
  chmodSync(target, 0o755)
  return target
}

/**
 * Build, health-check and promote a new LKG. With `candidateGlobal` it instead
 * builds a throwaway candidate from that core install, checks it and removes it
 * again: nothing is frozen, promoted, or left under `versions/`.
 */
const snapshot = async ({ label, ifChanged = false, candidateGlobal, turn } = {}) => {
  requireOperator()
  const candidate = candidateGlobal !== undefined
  mkdirSync(VERSIONS, { recursive: true })
  mkdirSync(STATE, { recursive: true })
  mkdirSync(LOGS, { recursive: true })
  const id =
    new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14) +
    '-' +
    randomUUID().slice(0, 8)
  const staging = join(VERSIONS, `.${id}.staging`)
  const final = join(VERSIONS, candidate ? `.${id}.candidate` : id)
  rmSync(staging, { recursive: true, force: true })

  const profileSource = resolve(process.env.DSH_LKG_PROFILE?.trim() || join(homedir(), '.dsh', 'profiles', 'web'))
  const globalRoot = resolve(candidateGlobal ?? (process.env.DSH_LKG_GLOBAL?.trim() || installedGlobalRoot()))
  if (!existsSync(globalRoot)) fail(`global install not found: ${globalRoot}`)
  if (!existsSync(profileSource)) fail(`web profile not found: ${profileSource}`)
  const fingerprint = liveFingerprint(profileSource, globalRoot)
  const currentId = currentVersionId()
  const currentManifest = currentId === undefined ? undefined : readJson(join(VERSIONS, currentId, 'manifest.json'))
  if (ifChanged && !candidate && currentManifest?.fingerprint === fingerprint) {
    log(`dsh-lkg: ${currentId} already captures this installation; nothing to do`)
    return { id: currentId, health: currentManifest.health }
  }
  log(`dsh-lkg: building ${id}${label === undefined ? '' : ` (${label})`}`)

  // 1. Core: the exact package tree the running dsh resolves, symlinks intact.
  cloneTree(join(globalRoot, 'node_modules'), join(staging, 'runtime', 'node_modules'))
  writeFileSync(join(staging, 'runtime', 'node-path'), `${process.execPath}\n`)

  // 2. Plugin bundles, taken from whatever the profile actually links to, so a
  //    plugin living in a sibling workspace is captured too. Each distinct
  //    source keeps its own `plugins/` layout, because a package's own
  //    node_modules links are relative to it.
  const linkedRoots = new Map()
  const linkedPackages = []
  // Packages resolve bare imports by walking up to the pnpm workspace root, so
  // each workspace is captured with its layout intact: every node_modules from
  // the workspace root down to the plugins directory, then the plugins.
  const workspaceRootOf = directory => {
    for (let current = directory; current !== dirname(current); current = dirname(current)) {
      if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    }
    return directory
  }
  const capturedModules = new Set()
  for (const { name, real } of linkedPluginDirectories(profileSource)) {
    const pluginsDirectory = dirname(dirname(real))
    const workspace = workspaceRootOf(pluginsDirectory)
    if (!linkedRoots.has(workspace)) linkedRoots.set(workspace, `roots/${String(linkedRoots.size)}`)
    const workspaceTarget = linkedRoots.get(workspace)
    for (let current = pluginsDirectory; ; current = dirname(current)) {
      const modules = join(current, 'node_modules')
      if (existsSync(modules) && !capturedModules.has(modules)) {
        capturedModules.add(modules)
        cloneTree(modules, join(staging, workspaceTarget, relative(workspace, current), 'node_modules'))
      }
      if (current === workspace || current === dirname(current)) break
    }
    linkedPackages.push({ name, real, relative: join(workspaceTarget, relative(workspace, pluginsDirectory)) })
  }
  for (const entry of linkedPackages) {
    cloneTree(entry.real, join(staging, entry.relative, '@dshfiles', entry.name))
  }
  // node_modules link workspace packages that live outside plugins/ (dshx under
  // tooling/, for one) by relative symlink; capture each one at its own path so
  // those links resolve inside the snapshot, then follow its node_modules too.
  const capturedPackages = new Set(linkedPackages.map(entry => entry.real))
  const pendingModules = [...capturedModules]
  while (pendingModules.length > 0) {
    const modules = pendingModules.pop()
    const workspace = workspaceRootOf(modules)
    const workspaceTarget = linkedRoots.get(workspace)
    if (workspaceTarget === undefined) continue
    const candidates = readdirSync(modules, { withFileTypes: true }).flatMap(entry =>
      entry.name.startsWith('@') && entry.isDirectory()
        ? readdirSync(join(modules, entry.name), { withFileTypes: true }).map(scoped => ({
            path: join(modules, entry.name, scoped.name),
            link: scoped.isSymbolicLink(),
          }))
        : [{ path: join(modules, entry.name), link: entry.isSymbolicLink() }],
    )
    for (const candidate of candidates) {
      if (!candidate.link) continue
      let real
      try {
        real = realpathSync(candidate.path)
      } catch {
        continue
      }
      const inside = relative(workspace, real)
      if (inside.startsWith('..') || inside.split('/').includes('node_modules') || capturedPackages.has(real)) continue
      capturedPackages.add(real)
      cloneTree(real, join(staging, workspaceTarget, inside))
      const nested = join(real, 'node_modules')
      if (existsSync(nested) && !capturedModules.has(nested)) {
        capturedModules.add(nested)
        pendingModules.push(nested)
      }
    }
  }

  // 3. Profile, with every linked plugin rewritten into the snapshot. The
  //    links target the final location, not the staging one: staging is renamed
  //    away on promotion, which would leave every link dangling.
  cloneTree(profileSource, join(staging, 'profile'))
  const profileNodeModules = join(staging, 'profile', 'node_modules', '@dshfiles')
  for (const entry of linkedPackages) {
    const link = join(profileNodeModules, entry.name)
    thawed(link)
    rmSync(link, { recursive: true, force: true })
    symlinkSync(join(final, entry.relative, '@dshfiles', entry.name), link)
  }
  const profileManifest = join(staging, 'profile', 'package.json')
  if (existsSync(profileManifest)) {
    const parsed = JSON.parse(readFileSync(profileManifest, 'utf8'))
    for (const entry of linkedPackages) {
      parsed.dependencies[`@dshfiles/${entry.name}`] = `link:${join(final, entry.relative, '@dshfiles', entry.name)}`
    }
    writeFileSync(profileManifest, `${JSON.stringify(parsed, null, 2)}\n`)
  }

  const manifest = {
    schema: 'dsh-lkg/version/v1',
    id,
    label: label ?? null,
    fingerprint,
    createdAt: new Date().toISOString(),
    source: {
      profile: profileSource,
      global: globalRoot,
      node: process.execPath,
      pluginRoots: [...linkedRoots.keys()],
      plugins: linkedPackages.map(entry => entry.name),
    },
    versions: {
      dsh: readJson(join(globalRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))?.version ?? null,
      node: run([process.execPath, '--version']).stdout.trim(),
      pnpm: run(['pnpm', '--version']).stdout.trim() || null,
    },
    health: { healthy: false, checkedAt: null, checks: [] },
  }
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  // 4. Prove it works before the known-good pointer moves. The candidate is
  //    renamed into place first, because its links target that final path, but
  //    `current` still names the previous snapshot until the check passes.
  renameSync(staging, final)
  log(`dsh-lkg: health check (own port, own state${turn === undefined ? '' : ', live data, one real turn'})`)
  const health = await healthCheck(final, { turn })
  for (const check of health.checks) log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`)
  manifest.health = { healthy: health.healthy, checkedAt: new Date().toISOString(), checks: health.checks, url: health.url ?? null }
  if (candidate) {
    thawed(final)
    if (!health.healthy && process.env.DSH_LKG_KEEP_FAILED === '1') renameSync(final, join(VERSIONS, `.${id}.failed`))
    else rmSync(final, { recursive: true, force: true })
    return { id, health: { ...health, log: join(LOGS, `health-${basename(final).replace(/^\./, '')}.log`) } }
  }
  if (!health.healthy) {
    thawed(final)
    if (process.env.DSH_LKG_KEEP_FAILED === '1') renameSync(final, join(VERSIONS, `.${id}.failed`))
    else rmSync(final, { recursive: true, force: true })
    fail(`the candidate did not pass its health check (host log: ${join(LOGS, `health-${id}.log`)}); the previous known-good snapshot is still current`)
  }
  const manifestPath = join(final, 'manifest.json')
  thawed(manifestPath)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  frozen(join(final, 'runtime'))
  for (const target of linkedRoots.values()) frozen(join(final, target))
  frozen(join(final, 'profile'))
  const launcher = writeLauncher()
  const link = join(STORE, `.current.${randomUUID()}`)
  symlinkSync(final, link)
  renameSync(link, CURRENT)
  log(`dsh-lkg: promoted ${id}; dsh-recover is ${launcher}`)
  reapVersions(DEFAULT_KEEP)
  return { id, health }
}

const dshVersionAt = globalRoot => readJson(join(globalRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))?.version

/**
 * `pnpm add -g` swaps the live core in place, so a new version is installed
 * into a private PNPM_HOME first and must run the live profile, plugins and
 * data — including one real turn — before the live install is touched.
 */
const upgrade = async (version, { turnModel } = {}) => {
  requireOperator()
  if (version === undefined || !/^\d[\w.+-]*$/.test(version)) fail('upgrade needs an exact @deepseek-ai/dsh version, e.g. 0.2.2')
  if (process.env.DSH_LKG_GLOBAL?.trim()) fail('upgrade manages the pnpm global install; unset DSH_LKG_GLOBAL')
  log('dsh-lkg: making sure a healthy snapshot captures the installation before the upgrade')
  const before = await snapshot({ label: 'before upgrade', ifChanged: true })
  if (before.health?.healthy !== true) fail(`the current snapshot ${before.id} is not recorded healthy; run \`verify\` or \`snapshot\` first`)

  const work = join(STATE, `upgrade-${version}-${randomUUID().slice(0, 8)}`)
  const abort = message => {
    rmSync(work, { recursive: true, force: true })
    fail(`${message}; the live install is untouched`)
  }
  mkdirSync(work, { recursive: true })
  log(`dsh-lkg: installing @deepseek-ai/dsh@${version} into ${work}`)
  // pnpm puts a global install under PNPM_HOME and refuses one whose bin dir is
  // not on PATH; a private PNPM_HOME keeps the live install out of reach.
  const installed = run(['pnpm', 'add', '-g', `@deepseek-ai/dsh@${version}`], {
    cwd: homedir(),
    env: { ...process.env, PNPM_HOME: work, PATH: `${join(work, 'bin')}:${process.env.PATH ?? ''}` },
  })
  const shim = join(work, 'bin', 'dsh')
  if (installed.status !== 0 || !existsSync(shim)) abort(`pnpm could not install ${version}: ${`${installed.stdout}${installed.stderr}`.trim().slice(-800)}`)
  const candidateGlobal = globalRootOfShim(shim)
  const candidateVersion = dshVersionAt(candidateGlobal)
  if (candidateVersion !== version) abort(`pnpm installed ${candidateVersion ?? 'nothing'} instead of ${version}`)

  log(`dsh-lkg: checking dsh ${version} against the live profile, plugins and data`)
  const candidate = await snapshot({ label: `candidate dsh ${version}`, candidateGlobal, turn: { model: turnModel } })
  if (!candidate.health.healthy) {
    const failed = candidate.health.checks.filter(check => !check.ok).map(check => check.name)
    abort(`dsh ${version} failed ${failed.join(', ')} (host log: ${candidate.health.log})`)
  }
  rmSync(work, { recursive: true, force: true })

  const liveVersion = dshVersionAt(installedGlobalRoot())
  if (liveVersion === version) log(`dsh-lkg: dsh ${version} is already the live install`)
  else {
    log(`dsh-lkg: dsh ${version} passed; installing it globally (was ${liveVersion ?? 'unknown'})`)
    const live = spawnSync('pnpm', ['add', '-g', `@deepseek-ai/dsh@${version}`], { cwd: homedir(), stdio: 'inherit' })
    if (live.status !== 0) fail(`the global install of ${version} failed; dsh-recover still starts ${before.id}`)
  }
  const after = await snapshot({ label: `dsh ${version}`, ifChanged: true })
  log(`dsh-lkg: dsh ${version} is live and ${after.id} is current; restart \`dsh web\` when it suits you`)
}

const list = () => {
  const current = currentVersionId()
  const ids = versionIds()
  if (ids.length === 0) {
    log('dsh-lkg: no snapshots yet')
    return
  }
  for (const id of ids.reverse()) {
    const manifest = readJson(join(VERSIONS, id, 'manifest.json'))
    const health = manifest?.health?.healthy === true ? 'healthy' : 'UNVERIFIED'
    const frozenState = isFrozen(join(VERSIONS, id, 'runtime')) ? 'frozen' : 'writable'
    log(`${id === current ? '*' : ' '} ${id}  ${health}  ${frozenState}  ${manifest?.label ?? ''}`)
  }
}

const verify = async (target, { turn } = {}) => {
  const id = target === undefined || target === 'current' ? currentVersionId() : target
  if (id === undefined) fail('no current snapshot')
  const root = join(VERSIONS, id)
  if (!existsSync(root)) fail(`unknown version ${id}`)
  const health = await healthCheck(root, { turn })
  for (const check of health.checks) log(`  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`)
  const manifestPath = join(root, 'manifest.json')
  const manifest = readJson(manifestPath) ?? {}
  thawed(manifestPath)
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, health: { healthy: health.healthy, checkedAt: new Date().toISOString(), checks: health.checks } }, null, 2)}\n`,
  )
  if (!health.healthy) process.exitCode = 1
}

const reap = keep => {
  requireOperator()
  reapVersions(keep)
}

const reapVersions = keep => {
  const current = currentVersionId()
  const ids = versionIds()
  const keepIds = new Set(keep > 0 ? ids.slice(-keep) : [])
  if (current !== undefined) keepIds.add(current)
  for (const id of ids) {
    if (keepIds.has(id)) continue
    const root = join(VERSIONS, id)
    thawed(root)
    rmSync(root, { recursive: true, force: true })
    log(`dsh-lkg: removed ${id}`)
  }
  for (const name of readdirSync(VERSIONS).filter(entry => entry.startsWith('.') && entry.endsWith('.staging'))) {
    const staging = join(VERSIONS, name)
    if (Date.now() - statSync(staging).mtimeMs < STALE_STAGING_MS) continue
    thawed(staging)
    rmSync(staging, { recursive: true, force: true })
    log(`dsh-lkg: removed abandoned ${name}`)
  }
}

const unlock = id => {
  requireOperator()
  const root = join(VERSIONS, id)
  if (!existsSync(root)) fail(`unknown version ${id}`)
  thawed(root)
  log(`dsh-lkg: ${id} is writable again`)
}

const remove = id => {
  requireOperator()
  if (id === undefined) fail('remove needs a version id')
  if (id === currentVersionId()) fail('refusing to remove the current known-good snapshot; promote another one first')
  const root = join(VERSIONS, id)
  if (!existsSync(root)) fail(`unknown version ${id}`)
  thawed(root)
  rmSync(root, { recursive: true, force: true })
  log(`dsh-lkg: removed ${id}`)
}

const status = () => {
  const current = currentVersionId()
  log(`store:    ${STORE}`)
  log(`current:  ${current ?? '(none)'}`)
  log(`versions: ${String(versionIds().length)}`)
  log(`launcher: ${join(STORE, 'bin', 'dsh-recover')}`)
  log(`state:    ${STATE}`)
}

const usage = () => {
  log(`dsh-lkg <command>

  snapshot [--label <text>] [--if-changed]
                              build, health-check and promote a new LKG;
                              --if-changed skips when current already matches
  list                        versions, health and freeze state
  verify [<id>|current] [--turn] [--turn-model <provider/model>]
                              re-run the health check on a version; --turn
                              also sends one real prompt on a clone of ~/.dsh
  upgrade <version> [--turn-model <provider/model>]
                              install @deepseek-ai/dsh@<version> globally only
                              after an isolated candidate passes every check,
                              including --turn
  reap [--keep <n>]           drop old versions (default ${DEFAULT_KEEP})
  unlock <id>                 clear immutable flags for maintenance
  remove <id>                 drop one version (never the current one)
  status                      where the store lives

Operator commands (snapshot, upgrade, reap, unlock) refuse to run from a DSH agent
session unless DSH_LKG_ADMIN=1 is set.`)
}

const main = async () => {
  const [command, ...rest] = process.argv.slice(2)
  const flag = name => {
    const index = rest.indexOf(name)
    return index === -1 ? undefined : rest[index + 1]
  }
  const flagValues = new Set(['--label', '--keep', '--turn-model'].flatMap(name => (flag(name) === undefined ? [] : [flag(name)])))
  const positional = () => rest.find(value => !value.startsWith('--') && !flagValues.has(value))
  const turnModel = () => {
    const model = flag('--turn-model')
    if (model !== undefined && !/^[^/\s]+\/\S+$/.test(model)) fail('--turn-model takes provider/model')
    return model
  }
  switch (command) {
    case 'snapshot':
      await snapshot({ label: flag('--label'), ifChanged: rest.includes('--if-changed') })
      return
    case 'list':
      list()
      return
    case 'verify':
      await verify(positional(), { turn: rest.includes('--turn') || flag('--turn-model') !== undefined ? { model: turnModel() } : undefined })
      return
    case 'upgrade':
      await upgrade(positional(), { turnModel: turnModel() })
      return
    case 'reap':
      reap(Number.parseInt(flag('--keep') ?? String(DEFAULT_KEEP), 10))
      return
    case 'unlock':
      unlock(rest[0] ?? fail('unlock needs a version id'))
      return
    case 'remove':
      remove(rest.find(value => !value.startsWith('--')))
      return
    case 'status':
      status()
      return
    default:
      usage()
      process.exitCode = command === undefined ? 0 : 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()

export { classifyTurn, cloneTree, healthCheck, snapshot }
