import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import plugin from './host.js'

// request_secret end to end on a mounted Host: the plugin's own tool definition waits while the Client API (the card's
// calls) stores a value through the e2e fake `secret` CLI and answers with its reference. No model, no browser.

const SYNTHETIC_VALUE = 'synthetic-requested-secret-value'
const fakeCli = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tooling', 'dshx', 'e2e', 'support', 'fake-secret-cli.mjs')

const toolsSchema = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      execute: Schema.declare((value): value is (args: unknown, execution: unknown) => Promise<unknown> => typeof value === 'function'),
    }),
  ),
})
const definition = Schema.decodeUnknownSync(toolsSchema)(plugin)

const wireEnvelope = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})
const pendingOutput = Schema.Struct({ requests: Schema.Array(Schema.Struct({ requestId: Schema.String, alias: Schema.String, purpose: Schema.String })) })

let host: TestHost
let root = ''
let storePath = ''
const previous = { PATH: process.env.PATH, SECRET_SESSION_FILE: process.env.SECRET_SESSION_FILE }

const call = async (apiId: string, method: string, input: Record<string, unknown>) => {
  // SAFETY: the test connection accepts any JSON input; the Host validates it against the method schema.
  const response = await host.connection.requestApi({ packageId: '@dshfiles/secret-catalog', apiId, method, version: 1, input: input as never })
  const result = Schema.decodeUnknownSync(wireEnvelope)(await response.json()).result
  if (!result.ok) throw new Error(`${method}: ${result.error.message}`)
  return result.value.output
}

const runTool = (name: string, args: unknown, controller: AbortController) => {
  const tool = definition.tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`No tool ${name}.`)
  return tool.execute(args, {
    callId: `${name}-call`,
    sessionId: 'session-request',
    agent: { id: 'session-request', session: { header: { cwd: root } } },
    signal: controller.signal,
  })
}

const firstPending = async (): Promise<{ readonly requestId: string; readonly alias: string; readonly purpose: string }> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [request] = Schema.decodeUnknownSync(pendingOutput)(await call('secret-catalog-requests', 'pending', { sessionId: 'session-request' })).requests
    if (request !== undefined) return request
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('No secret request became pending.')
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'secret-request-host-'))
  const bin = join(root, 'bin')
  await mkdir(bin)
  await copyFile(fakeCli, join(bin, 'secret'))
  await chmod(join(bin, 'secret'), 0o755)
  storePath = join(bin, 'store.json')
  await writeFile(storePath, JSON.stringify({ rows: [], vault: {} }))
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`
  process.env.SECRET_SESSION_FILE = storePath
  host = await createTestHost()
  host.ctx.provide('webServer', { port: 3080, host: '127.0.0.1', protocol: 'http:', register: () => () => undefined })
  // SAFETY: the Catalog's settings contribution only registers its automatic page through `configure`.
  host.ctx.provide('settings', { configure: () => () => undefined } as never)
  await host.ctx.plugin(LocalSubprocessRuntime)
  await host.mount(plugin, { packageId: '@dshfiles/secret-catalog' })
})

afterAll(async () => {
  await host.dispose()
  process.env.PATH = previous.PATH
  if (previous.SECRET_SESSION_FILE === undefined) delete process.env.SECRET_SESSION_FILE
  else process.env.SECRET_SESSION_FILE = previous.SECRET_SESSION_FILE
  await rm(root, { recursive: true, force: true })
})

describe('request_secret on a mounted Host', () => {
  it('waits for the user to store the value through the Catalog API and returns only its reference', async () => {
    const controller = new AbortController()
    const result = runTool('request_secret', { alias: 'SYNTHETIC_REQUESTED_TOKEN', purpose: 'Call the synthetic API.' }, controller)
    const request = await firstPending()
    expect(request).toMatchObject({ alias: 'SYNTHETIC_REQUESTED_TOKEN', purpose: 'Call the synthetic API.' })
    // what the card's masked form sends: the value goes to the setup API, the request gets the reference only
    await call('secret-catalog-setup', 'create', {
      alias: 'SYNTHETIC_REQUESTED_TOKEN',
      cwd: null,
      scope: 'global',
      environment: 'prod',
      valueMode: 'manual',
      value: SYNTHETIC_VALUE,
    })
    expect(await call('secret-catalog-requests', 'complete', { requestId: request.requestId, reference: 'secret:SYNTHETIC_REQUESTED_TOKEN' })).toEqual({
      reference: 'secret:SYNTHETIC_REQUESTED_TOKEN',
    })
    const output = await result
    expect(output).toEqual({ status: 'stored', reference: 'secret:SYNTHETIC_REQUESTED_TOKEN' })
    expect(JSON.stringify(output)).not.toContain(SYNTHETIC_VALUE)
    const store = JSON.parse(await readFile(storePath, 'utf8')) as { rows: { alias: string; item: string }[]; vault: Record<string, string> }
    expect(store.vault[store.rows.find(row => row.alias === 'SYNTHETIC_REQUESTED_TOKEN')?.item ?? '']).toBe(SYNTHETIC_VALUE)
    // the reverse path: the agent sees the alias and can remove it
    expect(JSON.stringify(await runTool('secret_list', {}, new AbortController()))).toContain('SYNTHETIC_REQUESTED_TOKEN')
    expect(await runTool('secret_remove_alias', { alias: 'SYNTHETIC_REQUESTED_TOKEN', scope: 'global', confirm: true }, new AbortController())).toEqual({
      removed: true,
      alias: 'SYNTHETIC_REQUESTED_TOKEN',
      scope: 'global',
    })
    expect(JSON.stringify(await runTool('secret_list', {}, new AbortController()))).not.toContain('SYNTHETIC_REQUESTED_TOKEN')
  })

  it('returns a declined result when the user declines, and cancels the request when the call is aborted', async () => {
    const declined = runTool('request_secret', { alias: 'DECLINED_TOKEN', purpose: 'Declined in this test.' }, new AbortController())
    await call('secret-catalog-requests', 'decline', { requestId: (await firstPending()).requestId })
    expect(await declined).toEqual({ status: 'declined' })

    const controller = new AbortController()
    const aborted = runTool('request_secret', { alias: 'ABORTED_TOKEN', purpose: 'Aborted in this test.' }, controller)
    await firstPending()
    controller.abort()
    await expect(aborted).rejects.toThrow()
    const left = Schema.decodeUnknownSync(pendingOutput)(await call('secret-catalog-requests', 'pending', { sessionId: null }))
    expect(left.requests).toEqual([])
  })
})
