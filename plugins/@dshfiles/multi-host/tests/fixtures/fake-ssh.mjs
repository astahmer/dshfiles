// A stand-in for the OpenSSH client: it runs the remote command on this machine and fakes `-N -L` forwards with a
// local TCP proxy. FAKE_SSH_LOG records what it was asked and which signals it received; FAKE_SSH_TUNNEL picks how a
// forward behaves (ready, silent, exit, refused); FAKE_SSH_IGNORE_TERM keeps it alive after SIGTERM;
// FAKE_SSH_FORCE_STDERR / FAKE_SSH_FORCE_STDOUT_BYTES replace the remote command with a canned failure or output.
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'

const args = process.argv.slice(2)
const log = line => {
  if (process.env.FAKE_SSH_LOG) appendFileSync(process.env.FAKE_SSH_LOG, `${line}\n`)
}
log(`pid ${process.pid}`)
log(`argv ${JSON.stringify(args)}`)

let remoteCommand
process.on('SIGTERM', () => {
  log('signal SIGTERM')
  if (process.env.FAKE_SSH_IGNORE_TERM === '1') return
  remoteCommand?.kill('SIGKILL')
  process.exit(143)
})

const optionsTaking = new Set(['-o', '-L', '-p', '-i', '-l'])
const positional = []
let forward
for (let index = 0; index < args.length; index += 1) {
  const value = args[index]
  if (value === '-L') forward = args[index + 1]
  if (optionsTaking.has(value)) {
    index += 1
    continue
  }
  if (value.startsWith('-')) continue
  positional.push(value)
}

if (forward !== undefined) {
  const [localAddress, localPort, remoteHost, remotePort] = forward.split(':')
  const scenario = process.env.FAKE_SSH_TUNNEL ?? 'ready'
  if (scenario === 'exit') {
    process.stderr.write('debug1: channel_setup_fwd_listener_tcpip: cannot listen to port\n')
    process.exit(255)
  }
  if (scenario === 'refused') {
    process.stderr.write(`ssh: connect to host ${positional[0]} port 22: Connection refused\n`)
    process.exit(255)
  }
  if (scenario === 'silent') {
    process.stderr.write('debug1: Connecting to remote host\n')
    setInterval(() => undefined, 60_000)
  } else {
    const server = createServer(client => {
      const upstream = createConnection({ host: remoteHost, port: Number(remotePort) })
      client.pipe(upstream).pipe(client)
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
    })
    server.listen({ host: localAddress, port: Number(localPort) }, () => {
      process.stderr.write(`debug1: Local forwarding listening on ${localAddress} port ${localPort}.\n`)
    })
  }
} else if (process.env.FAKE_SSH_FORCE_STDERR !== undefined) {
  process.stderr.write(`${process.env.FAKE_SSH_FORCE_STDERR}\n`)
  process.exit(255)
} else if (process.env.FAKE_SSH_FORCE_STDOUT_BYTES !== undefined) {
  process.stdout.write('x'.repeat(Number(process.env.FAKE_SSH_FORCE_STDOUT_BYTES)), () => process.exit(0))
} else {
  const command = positional.slice(1).join(' ')
  remoteCommand = spawn('sh', ['-c', command], { stdio: 'inherit' })
  remoteCommand.on('exit', code => {
    // DSH signals the whole process group, so the local stand-in for the remote command dies on SIGTERM too.
    if (process.env.FAKE_SSH_IGNORE_TERM === '1') setInterval(() => undefined, 60_000)
    else process.exit(code ?? 255)
  })
}
