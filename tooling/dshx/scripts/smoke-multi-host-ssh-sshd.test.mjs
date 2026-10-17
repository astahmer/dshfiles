import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { once } from 'node:events'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { buildSshOptions, reserveLoopbackPort, waitForSshLocalForward } from './smoke-multi-host-ssh-utils.mjs'

const findExecutable = async name => {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = resolve(directory || '.', name)
    const executable = await access(candidate, constants.X_OK).then(
      () => true,
      () => false,
    )
    if (executable) return candidate
  }
}

const generateKey = (sshKeygenPath, path) => {
  const result = spawnSync(sshKeygenPath, ['-q', '-t', 'ed25519', '-N', '', '-f', path], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (result.error?.code === 'ENOENT') return false
  assert.equal(result.error, undefined, result.stderr)
  assert.equal(result.status, 0, result.stderr)
  return true
}

const waitForLoopbackListener = async ({ serverProcess, port }) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) return false
    const connected = await new Promise(resolveConnection => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolveConnection(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolveConnection(false)
      })
    })
    if (connected) return true
    await delay(50)
  }
  return false
}

const processGroupExists = processGroupId => {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

const waitForProcessExit = async (serverProcess, timeoutMs) => {
  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) return true
  let timeout
  const exited = once(serverProcess, 'exit').then(
    () => true,
    () => false,
  )
  const timedOut = new Promise(resolveExit => {
    timeout = setTimeout(() => resolveExit(false), timeoutMs)
  })
  return Promise.race([exited, timedOut]).finally(() => clearTimeout(timeout))
}

const waitForProcessGroupExit = async (processGroupId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processGroupExists(processGroupId)) return true
    await delay(25)
  }
  return !processGroupExists(processGroupId)
}

const signalProcessGroup = (processGroupId, signal) => {
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

const stopServer = async serverProcess => {
  if (serverProcess?.pid === undefined) return
  const processGroupId = serverProcess.pid
  signalProcessGroup(processGroupId, 'SIGTERM')
  const stopped = await waitForProcessExit(serverProcess, 3000)
  const groupStopped = await waitForProcessGroupExit(processGroupId, 3000)
  if (stopped && groupStopped) return

  signalProcessGroup(processGroupId, 'SIGKILL')
  const killed = await waitForProcessExit(serverProcess, 1000)
  const groupKilled = await waitForProcessGroupExit(processGroupId, 1000)
  assert.ok(killed && groupKilled, `OpenSSH process group ${processGroupId} did not stop after SIGKILL.`)
}

const stopSshClient = async clientProcess => {
  if (clientProcess?.pid === undefined || clientProcess.exitCode !== null || clientProcess.signalCode !== null) return
  const stopped = waitForProcessExit(clientProcess, 3000)
  clientProcess.kill('SIGTERM')
  if (await stopped) return
  clientProcess.kill('SIGKILL')
  assert.ok(await waitForProcessExit(clientProcess, 1000), `OpenSSH client ${clientProcess.pid} did not stop after SIGKILL.`)
}

test('loopback OpenSSH verifies its local forward with scratch keys and known_hosts', { timeout: 30_000 }, async context => {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'dsh-loopback-sshd-'))
  const resolvedScratchRoot = resolve(scratchRoot)
  assert.equal(resolvedScratchRoot, scratchRoot)
  assert.ok(resolvedScratchRoot.startsWith(`${resolve(tmpdir())}${sep}`))
  let serverProcess
  let serverStderr = ''

  try {
    const sshdPath = await findExecutable('sshd')
    const sshKeygenPath = await findExecutable('ssh-keygen')
    const sshPath = await findExecutable('ssh')
    if (sshdPath === undefined || sshKeygenPath === undefined || sshPath === undefined) {
      context.skip('OpenSSH client/server or ssh-keygen is not installed; no SSH server was started.')
      return
    }
    const serverVersion = spawnSync(sshdPath, ['-V'], { encoding: 'utf8', timeout: 5000 })
    assert.equal(serverVersion.error, undefined, serverVersion.stderr)

    const hostKeyPath = join(scratchRoot, 'host_key')
    const clientKeyPath = join(scratchRoot, 'client_key')
    const authorizedKeysPath = join(scratchRoot, 'authorized_keys')
    const knownHostsPath = join(scratchRoot, 'known_hosts')
    const configPath = join(scratchRoot, 'sshd_config')
    const pidFilePath = join(scratchRoot, 'sshd.pid')
    if (!generateKey(sshKeygenPath, hostKeyPath) || !generateKey(sshKeygenPath, clientKeyPath)) {
      context.skip('OpenSSH key generator is not installed; no SSH server was started.')
      return
    }

    const [clientPublicKey, hostPublicKey] = await Promise.all([readFile(`${clientKeyPath}.pub`, 'utf8'), readFile(`${hostKeyPath}.pub`, 'utf8')])
    await writeFile(authorizedKeysPath, clientPublicKey, { mode: 0o600 })
    const port = await reserveLoopbackPort()
    const config = [
      `Port ${port}`,
      'AddressFamily inet',
      'ListenAddress 127.0.0.1',
      `HostKey ${hostKeyPath}`,
      `PidFile ${pidFilePath}`,
      `AuthorizedKeysFile ${authorizedKeysPath}`,
      'AuthenticationMethods publickey',
      'PubkeyAuthentication yes',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'PermitRootLogin prohibit-password',
      'UsePAM no',
      'StrictModes yes',
      'AllowAgentForwarding no',
      'AllowTcpForwarding yes',
      'GatewayPorts no',
      'X11Forwarding no',
      'UseDNS no',
      'PrintMotd no',
      'PrintLastLog no',
      'LogLevel ERROR',
    ].join('\n')
    await writeFile(configPath, `${config}\n`, { mode: 0o600 })
    await writeFile(knownHostsPath, `[127.0.0.1]:${port} ${hostPublicKey.trim()}\n`, { mode: 0o600 })

    const configCheck = spawnSync(sshdPath, ['-T', '-f', configPath], { encoding: 'utf8', timeout: 5000 })
    assert.equal(configCheck.error, undefined, configCheck.stderr)
    assert.equal(configCheck.status, 0, configCheck.stderr)

    serverProcess = spawn(sshdPath, ['-D', '-e', '-f', configPath], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
    serverProcess.stderr.on('data', chunk => {
      serverStderr += String(chunk)
    })
    const listening = await waitForLoopbackListener({ serverProcess, port })
    if (!listening) {
      const reason = `exit=${serverProcess.exitCode ?? serverProcess.signalCode ?? 'still-running'}, stderr=${serverStderr.trim() || '<empty>'}`
      if (/Bind to port \d+ on 127\.0\.0\.1 failed: (?:Permission denied|Operation not permitted)/i.test(serverStderr)) {
        context.skip(`The test sandbox denied binding the loopback SSH port: ${reason}`)
        return
      }
      assert.fail(`OpenSSH did not listen on 127.0.0.1:${port}: ${reason}`)
    }

    const username = userInfo().username
    const connection = spawnSync(
      sshPath,
      [...buildSshOptions({ sshKey: clientKeyPath, knownHosts: knownHostsPath, sshPort: port }), `${username}@127.0.0.1`, 'printf fixture-ok'],
      { encoding: 'utf8', timeout: 10_000 },
    )
    assert.equal(connection.error, undefined, connection.stderr)
    assert.equal(connection.status, 0, connection.stderr)
    assert.equal(connection.stdout, 'fixture-ok')

    const occupiedPort = await reserveLoopbackPort()
    const occupiedServer = createServer()
    await new Promise((resolveListen, reject) => {
      occupiedServer.once('error', reject)
      occupiedServer.listen(occupiedPort, '127.0.0.1', resolveListen)
    })
    try {
      const localPort = await reserveLoopbackPort()
      assert.notEqual(localPort, occupiedPort, 'the randomized SSH port must not reuse an already listening port')
      const forward = spawn(
        sshPath,
        [...buildSshOptions({ sshKey: clientKeyPath, knownHosts: knownHostsPath, sshPort: port }), '-v', '-N', '-L', `127.0.0.1:${localPort}:127.0.0.1:${port}`, `${username}@127.0.0.1`],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      )
      let forwardDiagnostics = ''
      forward.stderr.on('data', chunk => {
        forwardDiagnostics = `${forwardDiagnostics}${String(chunk)}`.slice(-16_384)
      })
      try {
        await waitForSshLocalForward({ child: forward, localPort, timeoutMs: 8000 })
        assert.match(forwardDiagnostics, new RegExp(`^debug\\d+: Local forwarding listening on 127\\.0\\.0\\.1 port ${localPort}\\.$`, 'm'))
        assert.equal(forward.exitCode, null)
        assert.equal(forward.signalCode, null)
      } finally {
        await stopSshClient(forward)
      }
    } finally {
      await new Promise((resolveClose, reject) => occupiedServer.close(error => (error ? reject(error) : resolveClose())))
    }
  } finally {
    try {
      await stopServer(serverProcess)
    } finally {
      await rm(scratchRoot, { recursive: true, force: true })
    }
  }
})
