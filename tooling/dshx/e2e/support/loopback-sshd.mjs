import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { delimiter, join, resolve, sep } from 'node:path'
import { tmpdir, userInfo } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'

const boundPortSchema = z.object({ port: z.number().int().min(1).max(65_535) })

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

export const reserveLoopbackPort = async () =>
  new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = boundPortSchema.safeParse(server.address())
      if (!address.success) {
        server.close()
        reject(new Error('Could not reserve a loopback port.'))
        return
      }
      server.close(error => (error ? reject(error) : resolvePort(address.data.port)))
    })
  })

const generateKey = (sshKeygenPath, path) => {
  const result = spawnSync(sshKeygenPath, ['-q', '-t', 'ed25519', '-N', '', '-f', path], {
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`ssh-keygen failed: ${result.stderr.trim()}`)
}

const waitForLoopbackListener = async ({ serverProcess, port }) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

const waitForProcessExit = async (child, timeoutMs) => {
  if (child.exitCode !== null || child.signalCode !== null) return true
  let timeout
  const exited = new Promise(resolveExit => child.once('exit', () => resolveExit(true)))
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

const stopProcessGroup = async child => {
  if (child?.pid === undefined) return
  const processGroupId = child.pid
  signalProcessGroup(processGroupId, 'SIGTERM')
  const stopped = await waitForProcessExit(child, 3000)
  const groupStopped = await waitForProcessGroupExit(processGroupId, 3000)
  if (stopped && groupStopped) return
  signalProcessGroup(processGroupId, 'SIGKILL')
  const killed = await waitForProcessExit(child, 1000)
  const groupKilled = await waitForProcessGroupExit(processGroupId, 1000)
  if (!killed || !groupKilled) throw new Error(`Owned OpenSSH process group ${processGroupId} did not stop after SIGKILL.`)
}

export const startLoopbackSshd = async () => {
  const scratchRoot = await mkdtemp(join(tmpdir(), 'dsh-multi-host-sshd-'))
  const resolvedScratchRoot = resolve(scratchRoot)
  if (resolvedScratchRoot !== scratchRoot || !resolvedScratchRoot.startsWith(`${resolve(tmpdir())}${sep}`)) {
    await rm(scratchRoot, { recursive: true, force: true })
    throw new Error('The SSH fixture scratch path did not resolve under the system temporary directory.')
  }

  let serverProcess
  let closed = false
  let serverStderr = ''
  try {
    const [sshdPath, sshKeygenPath, sshPath] = await Promise.all([findExecutable('sshd'), findExecutable('ssh-keygen'), findExecutable('ssh')])
    if (sshdPath === undefined || sshKeygenPath === undefined || sshPath === undefined) {
      throw new Error('Loopback SSH E2E requires OpenSSH sshd, ssh, and ssh-keygen on PATH.')
    }
    const serverVersion = spawnSync(sshdPath, ['-V'], { encoding: 'utf8', timeout: 5000 })
    if (serverVersion.error !== undefined || serverVersion.status !== 0) {
      throw new Error(`Could not verify the OpenSSH server binary: ${serverVersion.stderr.trim()}`)
    }

    const hostKeyPath = join(scratchRoot, 'host_key')
    const clientKeyPath = join(scratchRoot, 'client_key')
    const authorizedKeysPath = join(scratchRoot, 'authorized_keys')
    const knownHostsPath = join(scratchRoot, 'known_hosts')
    const configPath = join(scratchRoot, 'sshd_config')
    const pidFilePath = join(scratchRoot, 'sshd.pid')
    await Promise.all([generateKey(sshKeygenPath, hostKeyPath), generateKey(sshKeygenPath, clientKeyPath)])
    const [clientPublicKey, hostPublicKey] = await Promise.all([readFile(`${clientKeyPath}.pub`, 'utf8'), readFile(`${hostKeyPath}.pub`, 'utf8')])
    await writeFile(authorizedKeysPath, clientPublicKey, { mode: 0o600 })

    const port = await reserveLoopbackPort()
    const username = userInfo().username
    const targetAlias = `multi-host-loopback-${port}`
    const hostKeyAlias = `[127.0.0.1]:${port}`
    const config = [
      `Port ${port}`,
      'AddressFamily inet',
      'ListenAddress 127.0.0.1',
      `HostKey ${hostKeyPath}`,
      `PidFile ${pidFilePath}`,
      `AuthorizedKeysFile ${authorizedKeysPath}`,
      `AllowUsers ${username}`,
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
    await writeFile(knownHostsPath, `${hostKeyAlias} ${hostPublicKey.trim()}\n`, { mode: 0o600 })

    const configCheck = spawnSync(sshdPath, ['-T', '-f', configPath], { encoding: 'utf8', timeout: 5000 })
    if (configCheck.error !== undefined || configCheck.status !== 0) {
      throw new Error(`OpenSSH rejected its scratch-only configuration: ${configCheck.stderr.trim()}`)
    }

    const start = async () => {
      serverStderr = ''
      serverProcess = spawn(sshdPath, ['-D', '-e', '-f', configPath], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
      serverProcess.stderr?.on('data', chunk => {
        serverStderr = `${serverStderr}${String(chunk)}`.slice(-4096)
      })
      if (!(await waitForLoopbackListener({ serverProcess, port }))) {
        throw new Error(
          `OpenSSH did not listen on loopback port ${port}: exit=${serverProcess.exitCode ?? serverProcess.signalCode ?? 'running'}, stderr=${serverStderr.trim() || '<empty>'}`,
        )
      }
    }
    await start()

    return {
      scratchRoot,
      port,
      username,
      targetAlias,
      hostKeyAlias,
      sshPath,
      sshdPath,
      clientKeyPath,
      knownHostsPath,
      async seedClientHome(homeRoot) {
        const sshDirectory = join(homeRoot, '.ssh')
        const wrapperDirectory = join(homeRoot, 'bin')
        const configPath = join(sshDirectory, 'config')
        const wrapperInvocationLogPath = join(scratchRoot, 'ssh-wrapper-invocations.log')
        const tunnelProcessLogPath = join(scratchRoot, 'ssh-tunnel-processes.log')
        const quote = value => `'${value.replaceAll("'", "'\\''")}'`
        await Promise.all([mkdir(sshDirectory, { recursive: true, mode: 0o700 }), mkdir(wrapperDirectory, { recursive: true, mode: 0o700 })])
        await writeFile(
          configPath,
          [
            `Host ${targetAlias}`,
            '  HostName 127.0.0.1',
            `  Port ${port}`,
            `  User ${username}`,
            `  HostKeyAlias ${hostKeyAlias}`,
            `  IdentityFile ${clientKeyPath}`,
            '  IdentitiesOnly yes',
            `  UserKnownHostsFile ${knownHostsPath}`,
            '  GlobalKnownHostsFile /dev/null',
            '  StrictHostKeyChecking yes',
            '  BatchMode yes',
            '  ForwardAgent no',
          ].join('\n') + '\n',
          { mode: 0o600 },
        )
        const wrapperScript =
          [
            '#!/bin/sh',
            `printf '%s\\n' invoked >> ${quote(wrapperInvocationLogPath)}`,
            'tunnel_process=',
            'tunnel_forward=',
            'for argument in "$@"; do',
            '  case "$argument" in',
            '    -N) tunnel_process=yes ;;',
            '    -L) tunnel_forward=yes ;;',
            '  esac',
            'done',
            'if [ "$tunnel_process" = yes ] && [ "$tunnel_forward" = yes ]; then',
            `  printf 'persistent-forward %s\\n' "$$" >> ${quote(tunnelProcessLogPath)}`,
            'fi',
            `exec ${quote(sshPath)} -F ${quote(configPath)} "$@"`,
          ].join('\n') + '\n'
        await writeFile(join(wrapperDirectory, 'ssh'), wrapperScript, { mode: 0o700 })
        return { hostPathPrefix: wrapperDirectory, wrapperInvocationLogPath, tunnelProcessLogPath }
      },
      async stop() {
        if (serverProcess === undefined) return
        try {
          await stopProcessGroup(serverProcess)
        } finally {
          serverProcess = undefined
        }
      },
      async restart() {
        if (closed) throw new Error('The loopback SSH fixture is already closed.')
        if (serverProcess !== undefined) await this.stop()
        await start()
      },
      async close() {
        if (closed) return
        closed = true
        try {
          await this.stop()
        } finally {
          await rm(scratchRoot, { recursive: true, force: true })
        }
      },
      diagnostics: () => serverStderr,
    }
  } catch (error) {
    try {
      await stopProcessGroup(serverProcess)
    } finally {
      await rm(scratchRoot, { recursive: true, force: true })
    }
    throw error
  }
}
