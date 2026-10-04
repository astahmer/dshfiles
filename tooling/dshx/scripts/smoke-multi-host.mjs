import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { connectDshPlatformClient } from '../packages/dshx/src/platform/client.ts'

const root = await mkdtemp(join(tmpdir(), 'dshx-multi-host-'))
const runtimes = new Map()
const tunnels = new Set()
const checks = []
const workspacePath = join(root, 'workspace')
await mkdir(workspacePath)

const stopRuntime = async runtime => {
  if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) return
  const exited = once(runtime.child, 'exit')
  runtime.child.kill('SIGTERM')
  const escalation = setTimeout(() => runtime.child.kill('SIGKILL'), 3000)
  try {
    await exited
  } finally {
    clearTimeout(escalation)
  }
}

const startRuntime = async ({ id, home }) => {
  const child = spawn('dsh', ['--profile', 'web', '--port', '0', '--no-open'], {
    cwd: workspacePath,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: 'en_US.UTF-8',
      DSH_HOME: home,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const runtime = { id, home, child, output: '', url: undefined }
  runtimes.set(id, runtime)
  child.on('error', () => {})
  const collect = chunk => {
    runtime.output = (runtime.output + chunk.toString('utf8')).slice(-128_000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) break
    const match = runtime.output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/)
    if (match !== null) {
      runtime.url = match[0]
      await delay(500)
      assert.doesNotMatch(runtime.output, /failed to import|did not activate|Failed plugins|ERR_MODULE_NOT_FOUND/i)
      return runtime
    }
    await delay(100)
  }
  const redacted = runtime.output.replace(/token=[^\s]+/g, 'token=<redacted>')
  throw new Error(`Disposable runtime ${id} failed to boot: ${redacted}`)
}

const createTunnel = async runtime => {
  const endpoint = new URL(runtime.url)
  const sockets = new Set()
  const server = createServer(incoming => {
    const outgoing = createConnection({ host: '127.0.0.1', port: Number(endpoint.port) })
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      socket.on('error', () => {
        incoming.destroy()
        outgoing.destroy()
      })
    }
    incoming.once('close', () => outgoing.destroy())
    outgoing.once('close', () => incoming.destroy())
    incoming.pipe(outgoing)
    outgoing.pipe(incoming)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address !== null && typeof address !== 'string')
  const url = new URL(runtime.url)
  url.port = String(address.port)
  const tunnel = {
    url: url.toString(),
    close: async () => {
      const closed = once(server, 'close')
      server.close()
      for (const socket of sockets) socket.destroy()
      await closed
      tunnels.delete(tunnel)
    },
  }
  tunnels.add(tunnel)
  return tunnel
}

const targetClient = async ({ runtimeId, url }) => {
  assert(runtimes.has(runtimeId), 'Unknown runtime must fail before connecting')
  return { runtimeId, client: await connectDshPlatformClient({ url }) }
}

try {
  const first = await startRuntime({ id: 'runtime-a', home: join(root, 'runtime-a') })
  const second = await startRuntime({ id: 'runtime-b', home: join(root, 'runtime-b') })
  checks.push('two independent stock DSH web runtimes boot without activation failures')

  const tunnel = await createTunnel(second)
  const targets = await Promise.all([targetClient({ runtimeId: first.id, url: first.url }), targetClient({ runtimeId: second.id, url: tunnel.url })])
  const [local, forwarded] = targets
  const firstSession = await local.client.sessions.create({ cwd: workspacePath })
  const secondSession = await forwarded.client.sessions.create({ cwd: workspacePath })
  await local.client.sessions.rename(firstSession.sessionId, 'Runtime A proof')
  await forwarded.client.sessions.rename(secondSession.sessionId, 'Runtime B proof')
  const firstRows = await local.client.sessions.list()
  const secondRows = await forwarded.client.sessions.list()
  assert(firstRows.some(row => row.sessionId === firstSession.sessionId))
  assert(secondRows.some(row => row.sessionId === secondSession.sessionId))
  assert(!firstRows.some(row => row.sessionId === secondSession.sessionId))
  assert(!secondRows.some(row => row.sessionId === firstSession.sessionId))
  checks.push('same workspace path stays in separate runtime/session namespaces')

  const history = await forwarded.client.sessions.history(secondSession.sessionId)
  assert(JSON.stringify(history.records).includes('Runtime B proof'))
  checks.push('HTTP mutations and WebSocket history work through a byte-forwarding tunnel')

  const wrongTokenUrl = new URL(tunnel.url)
  wrongTokenUrl.searchParams.set('token', new URL(first.url).searchParams.get('token'))
  await assert.rejects(connectDshPlatformClient({ url: wrongTokenUrl.toString() }), { code: 'authentication-failed' })
  await assert.rejects(targetClient({ runtimeId: 'missing', url: first.url }))
  checks.push('wrong runtime launch token and unknown runtime are rejected')

  await tunnel.close()
  await assert.rejects(forwarded.client.sessions.rename(secondSession.sessionId, 'Must not execute'), { code: 'rpc-unreachable' })
  assert((await local.client.sessions.list()).some(row => row.sessionId === firstSession.sessionId))
  const reconnectedTunnel = await createTunnel(second)
  const reconnected = await targetClient({ runtimeId: second.id, url: reconnectedTunnel.url })
  const restoredHistory = await reconnected.client.sessions.history(secondSession.sessionId)
  assert(JSON.stringify(restoredHistory.records).includes('Runtime B proof'))
  assert(!JSON.stringify(restoredHistory.records).includes('Must not execute'))
  checks.push('tunnel loss leaves runtime/state alive; explicit reconnect never replays mutation')

  await reconnectedTunnel.close()
  await stopRuntime(second)
  const restarted = await startRuntime({ id: second.id, home: second.home })
  const restartedClient = await targetClient({ runtimeId: restarted.id, url: restarted.url })
  const persistedHistory = await restartedClient.client.sessions.history(secondSession.sessionId)
  assert(JSON.stringify(persistedHistory.records).includes('Runtime B proof'))
  checks.push('runtime restart with the same DSH_HOME preserves durable session history')

  process.stdout.write(
    `${JSON.stringify({ ok: true, checks, limitations: ['No SSH server or second physical machine exercised', 'No agent/model turn, PTY, LSP, browser UI or daemon supervision exercised'] }, null, 2)}\n`,
  )
} finally {
  await Promise.allSettled([...tunnels].map(tunnel => tunnel.close()))
  await Promise.allSettled([...runtimes.values()].map(stopRuntime))
  await rm(root, { recursive: true, force: true })
}
