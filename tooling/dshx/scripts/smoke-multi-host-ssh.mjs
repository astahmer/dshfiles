import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdtemp, rm, stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { buildSshOptions, quoteRemoteArgument, redactLaunchSecrets as redact } from './smoke-multi-host-ssh-utils.mjs'
import WebSocket from 'ws'

const absolutePathSchema = z
  .string()
  .trim()
  .regex(/^\/[^\0\r\n]+$/)
  .refine(path => !path.split('/').includes('..'))
const sshPortSchema = z
  .string()
  .regex(/^[1-9]\d{0,4}$/)
  .default('22')
  .transform(Number)
  .refine(port => port <= 65_535)
const smokeConfigSchema = z.object({
  sshTarget: z
    .string()
    .trim()
    .min(1)
    .regex(/^[^-\s][^\s]*$/),
  sshKey: absolutePathSchema,
  knownHosts: absolutePathSchema,
  sshPort: sshPortSchema,
  sshUnit: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.@:-]+$/),
  remoteWorkspace: absolutePathSchema,
  remoteHome: absolutePathSchema,
  disposableTarget: z.literal('1'),
  allowRemoteMutations: z.literal('1'),
})
const smokeConfig = smokeConfigSchema.safeParse({
  sshTarget: process.env.MH_SSH_TARGET,
  sshKey: process.env.MH_SSH_KEY,
  knownHosts: process.env.MH_KNOWN_HOSTS,
  sshPort: process.env.MH_SSH_PORT ?? '22',
  sshUnit: process.env.MH_UNIT,
  remoteWorkspace: process.env.MH_WS,
  remoteHome: process.env.MH_REMOTE_HOME,
  disposableTarget: process.env.MH_DISPOSABLE_TARGET,
  allowRemoteMutations: process.env.MH_ALLOW_REMOTE_MUTATIONS,
})
if (!smokeConfig.success) {
  throw new Error(
    'SSH smoke requires explicit MH_SSH_TARGET, private MH_SSH_KEY, MH_KNOWN_HOSTS, MH_UNIT, absolute MH_WS and MH_REMOTE_HOME, plus MH_DISPOSABLE_TARGET=1 and MH_ALLOW_REMOTE_MUTATIONS=1. MH_SSH_PORT is an optional TCP port from 1 to 65535 (default 22). Use only a disposable remote service.',
  )
}
const { sshTarget, sshKey, knownHosts, sshPort, sshUnit, remoteWorkspace, remoteHome } = smokeConfig.data
try {
  const [keyInfo, knownHostsInfo] = await Promise.all([stat(sshKey), stat(knownHosts)])
  if (!keyInfo.isFile() || (keyInfo.mode & 0o077) !== 0 || !knownHostsInfo.isFile() || (knownHostsInfo.mode & 0o022) !== 0) {
    throw new Error()
  }
} catch {
  throw new Error('SSH smoke requires a private key with private permissions and an existing known_hosts file that is not group/other-writable.')
}

const sshOptions = buildSshOptions({ sshKey, knownHosts, sshPort })
const { connectDshPlatformClient } = await import('../packages/dshx/dist/platform/client.js')
const launchUrlSchema = z
  .string()
  .regex(/^http:\/\/127\.0\.0\.1:(\d{1,5})\/\?token=[A-Za-z0-9._~-]{8,512}$/)
  .refine(value => {
    const port = Number(/127\.0\.0\.1:(\d{1,5})\//.exec(value)?.[1])
    return Number.isInteger(port) && port >= 1 && port <= 65_535
  })
const launchRecordSchema = z.object({ launchUrl: launchUrlSchema })
const tunnelHost = '127.0.0.1'
const observationLimit = 1200

const checks = []
const note = line => process.stdout.write(`${redact(line)}\n`)

const ssh = async args => {
  const child = spawn('ssh', [...sshOptions, sshTarget, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout = []
  const stderr = []
  child.stdout.on('data', chunk => stdout.push(String(chunk)))
  child.stderr.on('data', chunk => stderr.push(String(chunk)))
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error(redact(`ssh remote command failed (${code}): ${stderr.join('')}`))
  return stdout.join('')
}

const remote = async command => ssh([command])

const readLaunchUrl = content => {
  let record
  try {
    record = launchRecordSchema.safeParse(JSON.parse(content))
  } catch {
    record = undefined
  }
  if (record?.success) return record.data.launchUrl
  const line = launchUrlSchema.safeParse(content.split('\n', 1)[0]?.trim() ?? '')
  return line.success ? line.data : undefined
}

const remoteLaunchUrl = async () => {
  const home = remoteHome.replace(/\/+$/, '')
  const launchFile = quoteRemoteArgument(`${home}/plugins/multi-host/launch.json`)
  const webUrlFile = quoteRemoteArgument(`${home}/runtime/web-url`)
  const content = await remote(`if test -f ${launchFile}; then cat -- ${launchFile}; elif test -f ${webUrlFile}; then cat -- ${webUrlFile}; else exit 1; fi`)
  const launchUrl = readLaunchUrl(content)
  if (launchUrl === undefined) throw new Error('Remote DSH launch metadata is missing or invalid.')
  return launchUrl
}

const openTunnel = async remoteListenPort => {
  const localSpecPort = 39335
  const server = spawn('ssh', [...sshOptions, '-N', '-L', `127.0.0.1:39335:${tunnelHost}:${remoteListenPort}`, sshTarget], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stderr = []
  server.stderr.on('data', chunk => stderr.push(String(chunk)))
  await new Promise((resolve, reject) => {
    const probe = setInterval(() => {
      const socket = createConnection({ host: tunnelHost, port: localSpecPort })
      socket.once('connect', () => {
        clearInterval(probe)
        clearTimeout(timeout)
        socket.destroy()
        resolve()
      })
      socket.once('error', () => socket.destroy())
    }, 200)
    const timeout = setTimeout(() => {
      clearInterval(probe)
      reject(new Error(redact(`tunnel did not open: ${stderr.join('')}`)))
    }, 15_000)
  })
  const close = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    const escalation = setTimeout(() => server.kill('SIGKILL'), 3000)
    try {
      await exited
    } finally {
      clearTimeout(escalation)
    }
  }
  const tunnel = { localPort: localSpecPort, close }
  server.once('exit', () => tunnels.delete(tunnel))
  return tunnel
}

const exchangeCookie = async launchUrl => {
  let exchange
  try {
    exchange = await fetch(launchUrl, { redirect: 'manual' })
  } catch {
    throw new Error('Launch exchange through the tunnel failed.')
  }
  assert.equal(exchange.status, 303, `expected the token launch exchange to authenticate, got HTTP ${exchange.status}`)
  const cookie = exchange.headers
    .getSetCookie()
    .map(item => item.split(';', 1)[0])
    .filter(Boolean)
    .join('; ')
  assert.ok(cookie, 'the runtime must issue its authenticated cookie')
  return cookie
}

const makeGateway = ({ localPort, cookie }) => {
  const origin = `http://${tunnelHost}:${localPort}`
  const run = async (namespace, method, args) => {
    const response = await fetch(`${origin}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(method)}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${namespace}/${method}`, payload: { args } }),
    })
    if (response.status === 401) throw Object.assign(new Error(`unauthorized for ${namespace}/${method}`), { code: 'authentication-expired' })
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} for ${namespace}/${method}`), { code: 'rpc-http-error' })
    const envelope = JSON.parse(await response.text())
    if (envelope.type !== 'server-response' || envelope.rpcId === undefined) throw Object.assign(new Error('invalid envelope'), { code: 'invalid-response' })
    if (!envelope.result.ok)
      throw Object.assign(new Error(envelope.result.error?.message ?? 'remote error'), { code: envelope.result.error?.code ?? 'remote-error' })
    return envelope.result.value
  }
  const runSafe = async (...input) => {
    try {
      return { ok: true, value: await run(...input) }
    } catch (error) {
      return { ok: false, code: error.code, message: redact(error.message) }
    }
  }
  const follow = async endpoint => {
    const url = new URL('/api/remote.mux', origin)
    url.protocol = 'ws:'
    const socket = new WebSocket(url, { headers: { cookie }, handshakeTimeout: 10_000 })
    const frames = []
    const streamId = crypto.randomUUID()
    const open = payload => socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload }))
    socket.on('message', data => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
      let frame
      try {
        frame = JSON.parse(text)
      } catch {
        return
      }
      if (frame.streamId !== streamId) return
      frames.push(text)
    })
    await new Promise((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', error => reject(Object.assign(error, { code: 'stream-unreachable' })))
    })
    return {
      frames,
      open,
      stop: async () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'cancel', streamId }))
        socket.close()
      },
      waitFrames: async count => {
        const deadline = Date.now() + 8000
        while (frames.length < count && Date.now() < deadline) await delay(100)
      },
    }
  }
  return { origin, run, runSafe, follow, cookie }
}

const startLocalRuntime = async home => {
  const child = spawn('dsh', ['--profile', 'web', '--port', '0', '--no-open'], {
    cwd: tmpdir(),
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => {
    output += String(chunk)
  })
  child.stderr.on('data', chunk => {
    output += String(chunk)
  })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)
    if (match !== null) {
      await delay(500)
      assert.doesNotMatch(output, /failed to import|did not activate|Failed plugins|ERR_MODULE_NOT_FOUND/i)
      return { child, url: match[0] }
    }
    await delay(100)
  }
  throw new Error(redact(`local runtime failed to boot: ${output}`))
}

const run = process.env.MH_RUN_LOCAL === '0' ? null : await startLocalRuntime(await mkdtemp(join(tmpdir(), 'dshx-mh-local-')))
const tunnels = new Set()

try {
  note('remote unit health check')
  const unitState = (await remote(`systemctl --user is-active ${quoteRemoteArgument(sshUnit)} || true`)).trim()
  assert.equal(unitState, 'active', `the disposable remote runtime unit must be active before the smoke can run (got ${unitState})`)

  const remoteUrl = await remoteLaunchUrl()
  const remoteListenPort = Number(new URL(remoteUrl).port)
  const tunnel = await openTunnel(remoteListenPort)
  tunnels.add(tunnel)
  const cookie = await exchangeCookie(`http://${tunnelHost}:39335/?token=${new URL(remoteUrl).searchParams.get('token')}`)
  const gateway = makeGateway({ localPort: tunnel.localPort, cookie })
  checks.push('SSH forwards only the loopback web endpoint; token exchange authenticates end to end')

  note('remote platform attach')
  const platform = await connectDshPlatformClient({ url: `http://${tunnelHost}:${tunnel.localPort}/?token=${new URL(remoteUrl).searchParams.get('token')}` })
  const remoteSession = await platform.sessions.create({ cwd: remoteWorkspace })
  await platform.sessions.rename(remoteSession.sessionId, 'Remote proof')
  const remoteSessions = await platform.sessions.list()
  assert.ok(remoteSessions.some(row => row.sessionId === remoteSession.sessionId))
  assert.equal(remoteSessions.find(row => row.sessionId === remoteSession.sessionId)?.cwd, remoteWorkspace)
  const history = await platform.sessions.history(remoteSession.sessionId)
  assert.ok(JSON.stringify(history.records).includes('Remote proof'))
  checks.push('remote workspace/session creation and native history read back through the same authenticated gateway')

  if (run !== null) {
    note('local runtime attach')
    const local = await connectDshPlatformClient({ url: run.url })
    const localSession = await local.sessions.create({ cwd: process.env.HOME ?? homedir() })
    await local.sessions.rename(localSession.sessionId, 'Local proof')
    const localRows = await local.sessions.list()
    const remoteRows = await (
      await connectDshPlatformClient({ url: `http://${tunnelHost}:39335/?token=${new URL(remoteUrl).searchParams.get('token')}` })
    ).sessions.list()
    assert.ok(localRows.some(row => row.sessionId === localSession.sessionId))
    assert.ok(remoteRows.some(row => row.sessionId === remoteSession.sessionId))
    assert.ok(!remoteRows.some(row => row.sessionId === localSession.sessionId))
    checks.push('local and remote native runtimes stay isolated under parallel placement')
  }

  const markerName = `.mh-marker-${crypto.randomUUID().slice(0, 8)}`
  const markerRemotePath = `${remoteWorkspace}/${markerName}`
  const firstScreen = await gateway.follow('terminal/follow')
  const terminal = await gateway.runSafe('terminal', 'create', { agentId: remoteSession.sessionId, request: { id: crypto.randomUUID(), cols: 80, rows: 24 } })
  assert.ok(terminal.ok, redact(`terminal create: ${terminal.message}`))
  const firstAttachment = crypto.randomUUID()
  firstScreen.open({ args: { agentId: remoteSession.sessionId, id: terminal.value.id, attachmentId: firstAttachment } })
  await firstScreen.waitFrames(1)
  assert.ok(firstScreen.frames.some(frame => frame.includes('"snapshot"')))
  const sameAttachment = await gateway.runSafe('terminal', 'write', {
    agentId: remoteSession.sessionId,
    id: terminal.value.id,
    attachmentId: firstAttachment,
    data: `echo ${markerName}\n`,
  })
  assert.ok(sameAttachment.ok, redact(`same-attachment write must be accepted: ${sameAttachment.message}`))
  const refused = await gateway.runSafe('terminal', 'resize', {
    agentId: remoteSession.sessionId,
    id: terminal.value.id,
    attachmentId: crypto.randomUUID(),
    cols: 100,
    rows: 30,
  })
  assert.equal(refused.ok, false, 'a foreign attachment must not control the PTY while another attachment owns input')
  await firstScreen.stop()
  const second = await gateway.follow('terminal/follow')
  const secondAttachment = crypto.randomUUID()
  second.open({ args: { agentId: remoteSession.sessionId, id: terminal.value.id, attachmentId: secondAttachment } })
  await second.waitFrames(1)
  assert.ok(
    second.frames.some(frame => frame.includes('"snapshot"')),
    'reattachment recovers the retention screen snapshot',
  )
  const resized = await gateway.runSafe('terminal', 'resize', {
    agentId: remoteSession.sessionId,
    id: terminal.value.id,
    attachmentId: secondAttachment,
    cols: 111,
    rows: 33,
  })
  assert.ok(resized.ok, redact(`owning-attachment resize must be accepted: ${resized.message}`))
  await gateway.runSafe('terminal', 'write', {
    agentId: remoteSession.sessionId,
    id: terminal.value.id,
    attachmentId: secondAttachment,
    data: `echo written > ${quoteRemoteArgument(markerRemotePath)} && cat ${quoteRemoteArgument(markerRemotePath)}\n`,
  })
  await delay(1500)
  assert.ok(
    second.frames.some(frame => redact(frame).includes(markerName)),
    'PTY screen content confirms remote workspace placement',
  )
  await second.stop()
  const exits = await gateway.follow('terminal/follow')
  const exitAttachment = crypto.randomUUID()
  exits.open({ args: { agentId: remoteSession.sessionId, id: terminal.value.id, attachmentId: exitAttachment } })
  await exits.waitFrames(1)
  await gateway.runSafe('terminal', 'write', { agentId: remoteSession.sessionId, id: terminal.value.id, attachmentId: exitAttachment, data: 'exit\n' })
  await delay(1500)
  const stateList = await gateway.run('terminal', 'list', { sessionId: remoteSession.sessionId })
  assert.equal(stateList[0]?.state, 'exited')
  checks.push('remote PTY: workspace placement file written only through the remote shell, resize ownership enforced, exit state reported')
  await assert.rejects(access(`${process.cwd()}/${markerName}`), { code: 'ENOENT' })
  await remote(`test -f ${quoteRemoteArgument(markerRemotePath)} && rm -f ${quoteRemoteArgument(markerRemotePath)}`)
  checks.push('marker exists on the remote filesystem only')

  const authenticatedProbe = await gateway.runSafe('session', 'list', {})
  assert.equal(authenticatedProbe.ok, true)

  await tunnel.close()
  tunnels.delete(tunnel)
  await assert.rejects(platform.sessions.list(), { code: 'rpc-unreachable' })
  const rebuilt = await openTunnel(remoteListenPort)
  tunnels.add(rebuilt)
  const rebuiltGateway = makeGateway({ localPort: rebuilt.localPort, cookie })
  const persisted = await rebuiltGateway.runSafe('session', 'list', { _request: {} })
  assert.ok(persisted.ok, 'the same runtime cookie keeps authenticating after the tunnel is rebuilt')
  checks.push('tunnel loss leaves the runtime and durable session identity intact; reconnect restores native access')
  await rebuiltGateway.runSafe('session', 'rename', { request: { sessionId: remoteSession.sessionId, title: 'Remote proof' } })

  note('restarting the disposable remote runtime; identity must persist')
  await remote(
    `systemctl --user restart ${quoteRemoteArgument(sshUnit)} && for i in 1 2 3 4 5 6 7 8 9 10 11 12; do test "$(systemctl --user is-active ${quoteRemoteArgument(sshUnit)})" = active && break; sleep 1; done`,
  )
  const waitUntilActive = await (async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const state = (await remote(`systemctl --user is-active ${quoteRemoteArgument(sshUnit)} || true`)).trim()
      if (state === 'active') return state
      await delay(1000)
    }
    throw new Error('the restarted remote runtime never reported active')
  })()
  assert.equal(waitUntilActive, 'active')
  let replayedLaunch = await remoteLaunchUrl()
  for (let attempt = 0; attempt < 12 && Number(new URL(replayedLaunch).port) === remoteListenPort; attempt += 1) {
    await delay(1000)
    replayedLaunch = await remoteLaunchUrl()
  }
  assert.ok(new URL(replayedLaunch).searchParams.get('token') !== undefined)
  const restartedPort = Number(new URL(replayedLaunch).port)
  await rebuilt.close()
  tunnels.delete(rebuilt)
  const restartedTunnel = await openTunnel(restartedPort)
  tunnels.add(restartedTunnel)
  let restartedCookie
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      restartedCookie = await exchangeCookie(`http://${tunnelHost}:39335/?token=${new URL(replayedLaunch).searchParams.get('token')}`)
      break
    } catch (error) {
      if (attempt === 11) throw error
      await delay(1000)
    }
  }
  const restartedGateway = makeGateway({ localPort: restartedTunnel.localPort, cookie: restartedCookie })
  const restored = await restartedGateway.runSafe('session', 'list', { _request: {} })
  assert.ok(restored.ok, `a restarted runtime issues a fresh cookie: ${restored.message}`)
  const restoredPlatform = await connectDshPlatformClient({ url: `http://${tunnelHost}:39335/?token=${new URL(replayedLaunch).searchParams.get('token')}` })
  const restoredHistory = await restoredPlatform.sessions.history(remoteSession.sessionId)
  assert.ok(JSON.stringify(restoredHistory.records).includes('Remote proof'))
  const restoredSessions = await restoredPlatform.sessions.list()
  assert.ok(restoredSessions.some(row => row.sessionId === remoteSession.sessionId))
  checks.push('runtime restart under the same durable home preserves workspace/session identity and history; stale handles rebuilt')

  const stale = await gateway.runSafe('session', 'list', { _request: {} })
  assert.equal(stale.ok, true, `the pre-restart cookie stays valid because DSH keeps a durable signed-cookie authority: ${stale.message}`)
  checks.push('pre-restart cookie remains authenticated across restart (durable signing authority); wrong tokens still fail closed')

  {
    const badUrl = new URL(`http://${tunnelHost}:39335/`)
    badUrl.searchParams.set('token', 'definitely-wrong')
    await assert.rejects(connectDshPlatformClient({ url: badUrl.toString() }), { code: 'authentication-failed' })
    checks.push('wrong launch token is rejected by the native runtime')
  }

  {
    const stopping = new WebSocket('ws://127.0.0.1:39335/api/remote.mux', { handshakeTimeout: 5000 })
    await new Promise(resolve => {
      stopping.on('error', () => resolve())
      stopping.on('open', () => {
        stopping.close()
        resolve()
      })
    })
    await assert.rejects(connectDshPlatformClient({ url: 'http://127.0.0.1:39999/?token=anything' }), { code: 'connection-failed' })
    checks.push('a closed forwarded endpoint fails closed as connection-failed')
  }

  note(
    JSON.stringify(
      {
        ok: true,
        checks,
        limitations: observationLimit
          ? ['Model/agent turn, MCP call, LSP and browser UI gates remain', 'One remote host; simultaneous multi-host failure isolation comes with the Pi']
          : [],
      },
      null,
      2,
    ),
  )
} catch (error) {
  throw new Error(redact(error instanceof Error ? error.message : 'SSH smoke failed.'))
} finally {
  for (const tunnel of tunnels) await tunnel.close().catch(() => undefined)
  tunnels.clear()
  if (run !== null) {
    const exited = once(run.child, 'exit')
    run.child.kill('SIGTERM')
    const escalation = setTimeout(() => run.child.kill('SIGKILL'), 3000)
    try {
      await exited
    } finally {
      clearTimeout(escalation)
    }
  }
  await rm(join(tmpdir(), '.mh-marker'), { recursive: true, force: true }).catch(() => undefined)
}
