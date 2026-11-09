import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { renderTerminalQr } from '../plugins/@dshfiles/phone-access/src/qr.ts'

const { values } = parseArgs({
  options: {
    'proxy-port': { type: 'string', default: '3443' },
    'no-serve': { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
  },
})

const run = (command: string, args: string[]): string => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const tailnetHost = (): string | undefined => {
  try {
    // SAFETY: `tailscale status --json` is the documented CLI shape; a missing field is handled below.
    const status = JSON.parse(run('tailscale', ['status', '--json'])) as { Self?: { DNSName?: string } }
    const name = status.Self?.DNSName?.replace(/\.$/, '')
    return name && name.endsWith('.ts.net') ? name : undefined
  } catch {
    return undefined
  }
}

const listening = async (port: number): Promise<boolean> => {
  const { connect } = await import('node:net')
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

const launchUrl = (): URL => {
  const recorded = join(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'runtime', 'web-url')
  const url = new URL(readFileSync(recorded, 'utf8').trim())
  if (!url.searchParams.get('token')) throw new Error(`no launch token in ${recorded}`)
  return url
}

const host = tailnetHost()
if (host === undefined) {
  console.error('dsh phone: Tailscale is not running with a tailnet DNS name. Start Tailscale, or run `tailscale up`.')
  process.exit(1)
}

const proxyPort = Number(values['proxy-port'])
if (!Number.isSafeInteger(proxyPort) || proxyPort < 1 || proxyPort > 65_535) throw new Error('invalid --proxy-port')
const launch = launchUrl()
const nativePort = Number(launch.port || 80)
const target = (await listening(proxyPort)) ? proxyPort : nativePort
const origin = `https://${host}`

if (!values['no-serve']) {
  run('tailscale', ['serve', '--bg', '--https=443', `http://127.0.0.1:${target}`])
}

const signIn = new URL('/', origin)
signIn.searchParams.set('token', launch.searchParams.get('token') ?? '')

if (values.check) {
  console.log(`dsh phone: tailnet ${host}, serving 127.0.0.1:${target} as ${origin}`)
  console.log('dsh phone: sign-in URL is ready (not printed in check mode)')
  process.exit(0)
}

console.log(`Scan with the phone (Tailscale signed in to the same tailnet):\n\n${renderTerminalQr(signIn.href)}\n\nor open: ${origin}/\n`)
