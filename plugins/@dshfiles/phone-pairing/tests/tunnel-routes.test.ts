import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JsonValue } from '@dshfiles/dshx/json'
import { ServeRoutesModel, startTunnel } from '../src/tunnel.ts'

const { parse: parseServeStatus, freePort: freeServePort } = ServeRoutesModel

/**
 * A stand-in `tailscale` first on PATH: it records every command and keeps a serve table in a JSON file, so
 * these tests never run the machine's real Tailscale or touch its network settings.
 */
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.FAKE_TS_LOG, args.join(' ') + '\\n')
const state = JSON.parse(fs.readFileSync(process.env.FAKE_TS_STATE, 'utf8'))
if (args[0] === 'status') { console.log(JSON.stringify({ Self: { DNSName: 'machine.example.ts.net.' } })); process.exit(0) }
if (args[1] === 'status') { console.log(JSON.stringify(state)); process.exit(0) }
const https = (args.find(arg => arg.startsWith('--https=')) || '').slice('--https='.length)
const key = 'machine.example.ts.net:' + https
if (args.includes('off')) { delete state.TCP[https]; delete state.Web[key] }
else { state.TCP[https] = { HTTPS: true }; state.Web[key] = { Handlers: { '/': { Proxy: args[args.length - 1] } } } }
fs.writeFileSync(process.env.FAKE_TS_STATE, JSON.stringify(state))
console.log('ok')
`

/** Phone access QR's route as the live machine has it: https=443 → its 127.0.0.1:3443 proxy. */
const phoneAccessRoute = { TCP: { '443': { HTTPS: true } }, Web: { 'machine.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3443' } } } } }

let directory = ''
const saved = { PATH: process.env.PATH, FAKE_TS_LOG: process.env.FAKE_TS_LOG, FAKE_TS_STATE: process.env.FAKE_TS_STATE }

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fake-tailscale-'))
  await writeFile(join(directory, 'tailscale'), FAKE)
  await chmod(join(directory, 'tailscale'), 0o755)
  process.env.PATH = `${directory}:${saved.PATH ?? ''}`
  process.env.FAKE_TS_LOG = join(directory, 'commands.log')
  process.env.FAKE_TS_STATE = join(directory, 'serve.json')
  await writeFile(process.env.FAKE_TS_LOG, '')
})

afterEach(async () => {
  process.env.PATH = saved.PATH
  process.env.FAKE_TS_LOG = saved.FAKE_TS_LOG
  process.env.FAKE_TS_STATE = saved.FAKE_TS_STATE
  await rm(directory, { recursive: true, force: true })
})

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect)
const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  // SAFETY: NodeServices provides the ChildProcessSpawner these tunnel effects require; the tracer is optional.
  run(effect.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, tracerLayer))) as Effect.Effect<A, E, never>)
const table = async (routes: JsonValue) => writeFile(process.env.FAKE_TS_STATE ?? '', JSON.stringify(routes))
const commands = async () => (await readFile(process.env.FAKE_TS_LOG ?? '', 'utf8')).trim().split('\n')
const routes = async () => run(parseServeStatus(await readFile(process.env.FAKE_TS_STATE ?? '', 'utf8')))

describe('phone pairing on its own Tailscale route', () => {
  it('leaves Phone access QR’s https=443 alone: serves on 8443 and turns off only 8443', async () => {
    await table(structuredClone(phoneAccessRoute))
    const tunnel = await provided(startTunnel(5555, 'tailscale-serve'))
    expect(tunnel?.origin).toBe('https://machine.example.ts.net:8443')
    await provided(tunnel?.stop ?? Effect.void)
    expect(await commands()).toEqual([
      'status --json',
      'serve status --json',
      'serve --bg --https=8443 http://127.0.0.1:5555',
      'serve status --json',
      'serve --https=8443 off',
    ])
    const after = await routes()
    expect(after.proxyOf('machine.example.ts.net', 443)).toBe('http://127.0.0.1:3443')
    expect(after.ports.has(8443)).toBe(false)
  })

  it('turns nothing off when its route was repointed by someone else', async () => {
    await table({ TCP: {}, Web: {} })
    const tunnel = await provided(startTunnel(5556, 'tailscale-serve'))
    expect(tunnel?.origin).toBe('https://machine.example.ts.net')
    await table(structuredClone(phoneAccessRoute))
    await provided(tunnel?.stop ?? Effect.void)
    expect((await commands()).filter(line => line.endsWith(' off'))).toEqual([])
    expect((await routes()).proxyOf('machine.example.ts.net', 443)).toBe('http://127.0.0.1:3443')
  })

  it('starts no Funnel when every Funnel port is already served', async () => {
    const busy = { TCP: { '443': {}, '8443': {}, '10000': {} }, Web: {} }
    await table(busy)
    expect(await provided(startTunnel(5557, 'tailscale-funnel'))).toBeUndefined()
    expect((await commands()).filter(line => line.startsWith('funnel --bg'))).toEqual([])
  })

  it('takes over a Serve route a crashed Host left on its own gateway, and leaves it on stop', async () => {
    const ports = ['443', '8443', '9443', '10443']
    const leftovers = Object.fromEntries(ports.map(port => [`machine.example.ts.net:${port}`, { Handlers: { '/': { Proxy: 'http://127.0.0.1:5557' } } }]))
    await table({ TCP: Object.fromEntries(ports.map(port => [port, { HTTPS: true }])), Web: leftovers })
    const tunnel = await provided(startTunnel(5557, 'tailscale-serve'))
    expect(tunnel?.origin).toBe('https://machine.example.ts.net')
    await provided(tunnel?.stop ?? Effect.void)
    expect((await commands()).filter(line => line.startsWith('serve --bg') || line.endsWith(' off'))).toEqual([])
  })

  it('reads the served ports and their targets from serve status', async () => {
    const parsed = await run(parseServeStatus(JSON.stringify(phoneAccessRoute)))
    expect([...parsed.ports]).toEqual([443])
    expect(parsed.proxyOf('machine.example.ts.net', 443)).toBe('http://127.0.0.1:3443')
    expect(freeServePort('serve', parsed)).toBe(8443)
    expect(freeServePort('serve', await run(parseServeStatus('')))).toBe(443)
  })
})
