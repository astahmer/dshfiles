import { createServer } from 'node:net'

export const buildSshOptions = ({ sshKey, knownHosts, sshPort = 22 }) => [
  '-p',
  String(sshPort),
  '-F',
  '/dev/null',
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  `UserKnownHostsFile=${knownHosts}`,
  '-o',
  'GlobalKnownHostsFile=/dev/null',
  '-o',
  'IdentitiesOnly=yes',
  '-i',
  sshKey,
  '-o',
  'ForwardAgent=no',
  '-o',
  'ExitOnForwardFailure=yes',
  '-o',
  'ConnectTimeout=15',
]

export const reserveLoopbackPort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(error => reject(error ?? new Error('Could not reserve a loopback port.')))
        return
      }
      server.close(error => {
        if (error !== undefined) reject(error)
        else resolvePort(address.port)
      })
    })
  })

export const waitForSshLocalForward = ({ child, localPort, timeoutMs = 15_000 }) =>
  new Promise((resolveReady, reject) => {
    const stderr = child.stderr
    if (stderr === null) {
      reject(new Error('SSH stderr is not piped, so local-forward readiness cannot be verified.'))
      return
    }

    const readyLinePattern = new RegExp(`^debug\\d+: Local forwarding listening on 127\\.0\\.0\\.1 port ${localPort}\\.$`, 'm')
    let stderrTail = ''
    let timeout
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      stderr.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const finish = error => {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolveReady()
      else reject(error)
    }
    const onData = chunk => {
      const output = `${stderrTail}${String(chunk)}`
      if (readyLinePattern.test(output)) {
        stderrTail = output.slice(-16_384)
        finish()
        return
      }
      stderrTail = output.slice(-16_384)
    }
    const onExit = (code, signal) =>
      finish(
        new Error(
          `SSH exited before its local forward on port ${localPort} was ready (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}): ${stderrTail}`,
        ),
      )
    const onError = error => finish(error)

    stderr.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onError)
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode)
      return
    }
    timeout = setTimeout(
      () => finish(new Error(`SSH did not confirm its local forward on port ${localPort} within ${timeoutMs} ms: ${stderrTail}`)),
      timeoutMs,
    )
  })

export const quoteRemoteArgument = value => `'${value.replaceAll("'", "'\\''")}'`

export const redactLaunchSecrets = value =>
  String(value)
    .replace(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9._~-]+/g, '<launch-url-redacted>')
    .replace(/token=[A-Za-z0-9._~-]+/g, 'token=<redacted>')
