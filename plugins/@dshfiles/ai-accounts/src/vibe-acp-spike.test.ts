import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import * as Schema from 'effect/Schema'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpRpc, type AcpJson } from './acp-rpc.js'
import { AiAccountsSchema } from './effect-schema.js'
import { bridgeCallSchema, CliBridge, MCP_BRIDGE_SOURCE } from './cli-bridge.js'
import { fakeVibeAcp, type FakeVibeAcp } from './vibe-acp.fixture.js'

/**
 * The ordering spike for the Vibe ACP bridge, run without product code: the smallest ACP client `vibe-acp` accepts —
 * one stdio MCP server, one session, one permission policy — proving the three facts the `vibe-acp` route is built on:
 *
 *   1. `session/new` projects the MCP server, and Vibe publishes DSH's tools as `mcp_dsh.<tool>` in ACP metadata.
 *   2. the tool's `tool_call` update is published before the MCP `tools/call` can be answered, so a step can end on the
 *      update while the call stays held for DSH's result.
 *   3. `usage_update` carries the context size, the session cost and the token meta the ledger reports, and
 *      `session/request_permission` can be answered per tool.
 *
 * The manual counterpart, which drives the real binary, is `scripts/vibe-acp-spike.mjs`.
 */

const finite = Schema.optional(Schema.Number.check(Schema.isFinite()))

/** What `vibe-acp` sends for one LLM step: `_meta` is cumulative across the session, `used`/`size` describe the context. */
const usageUpdateSchema = Schema.Struct({
  sessionUpdate: Schema.Literal('usage_update'),
  used: finite,
  size: finite,
  cost: Schema.optional(Schema.NullOr(Schema.Struct({ amount: Schema.Number, currency: Schema.String }))),
  _meta: Schema.optional(Schema.Struct({ promptTokens: finite, completionTokens: finite, cachedTokens: finite, steps: finite })),
})

const newSessionSchema = Schema.Struct({ sessionId: Schema.String })

/** The parts of an ACP update the spike reads, decoded instead of narrowed off the raw JSON. */
const incomingSchema = Schema.Struct({
  sessionUpdate: Schema.String,
  toolCallId: Schema.optional(Schema.String),
  _meta: Schema.optional(Schema.Struct({ tool_name: Schema.optional(Schema.String) })),
})

const tool = { name: 'echo', description: 'Echo a value', parameters: { type: 'object', properties: { value: { type: 'string' } } } }

const directories: string[] = []
const children: ChildProcessWithoutNullStreams[] = []
const servers: Server[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const child of children.splice(0)) child.kill()
  for (const server of servers.splice(0)) server.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const temporary = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'vibe-acp-spike-'))
  directories.push(directory)
  return directory
}

interface Inspection {
  readonly fake: FakeVibeAcp
  readonly sessionId: string
  readonly updates: AcpJson[]
  /** The MCP calls the bridge forwarded, in arrival order. */
  readonly bridgeCalls: { readonly name: string; readonly arguments: string }[]
  /** Answer the forwarded call that is held: only then does Vibe's tool proxy finish. */
  readonly answer: (result: { readonly content: readonly unknown[]; readonly isError: boolean }) => void
}

/** The smallest ACP client `vibe-acp` needs: one MCP server over a unix socket, and a permission policy. */
const inspect = async (input: { readonly prompt: string }): Promise<Inspection> => {
  const fake = fakeVibeAcp()
  vi.stubEnv('FAKE_VIBE_ACP_LOG', fake.logPath)
  const bridgeDirectory = temporary()
  const socketPath = join(bridgeDirectory, 'bridge.sock')
  writeFileSync(join(bridgeDirectory, 'tools.json'), JSON.stringify([CliBridge.toMcpTool(tool as never)]))

  const updates: AcpJson[] = []
  const bridgeCalls: { name: string; arguments: string }[] = []
  let release: ((result: { content: readonly unknown[]; isError: boolean }) => void) | undefined

  const server = createServer(socket => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const decoded = CliBridge.decodeJsonLine(bridgeCallSchema, buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        if (decoded._tag !== 'Success') continue
        bridgeCalls.push({ name: decoded.success.name, arguments: JSON.stringify(decoded.success.arguments) })
        release = result => socket.write(`${JSON.stringify({ id: decoded.success.id, ...result })}\n`)
      }
    })
  })
  servers.push(server)
  server.listen(socketPath)

  const child = spawn(fake.executable, [], { cwd: bridgeDirectory, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] })
  children.push(child)
  const rpc = new AcpRpc({
    send: line => child.stdin.write(`${line}\n`),
    onNotification: (method, params) => {
      if (method !== 'session/update') return
      const decoded = AiAccountsSchema.decodeResult(Schema.Struct({ update: Schema.Json }), params)
      if (decoded._tag === 'Success') updates.push(decoded.success.update)
    },
    onRequest: (method, params) => {
      if (method !== 'session/request_permission') return undefined
      const decoded = AiAccountsSchema.decodeResult(
        Schema.Struct({
          toolCall: Schema.Struct({ toolCallId: Schema.optional(Schema.String) }),
          options: Schema.Array(Schema.Struct({ optionId: Schema.String, kind: Schema.String })),
        }),
        params,
      )
      if (decoded._tag !== 'Success') return { result: { outcome: { outcome: 'cancelled' } } }
      const bridged = updates.some(update => {
        const candidate = Schema.decodeUnknownSync(incomingSchema)(update)
        return (
          candidate.sessionUpdate === 'tool_call' &&
          candidate.toolCallId === decoded.success.toolCall.toolCallId &&
          (candidate._meta?.tool_name ?? '').startsWith('mcp_dsh.')
        )
      })
      const option = decoded.success.options.find(candidate => candidate.kind.startsWith(bridged ? 'allow' : 'reject'))
      return { result: option === undefined ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId: option.optionId } } }
    },
  })
  createInterface({ input: child.stdout }).on('line', line => rpc.accept(line))
  await rpc.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'dsh', version: '1' } })
  const created = AiAccountsSchema.decodeResult(
    newSessionSchema,
    await rpc.request('session/new', {
      cwd: bridgeDirectory,
      additionalDirectories: [join(fake.directory, 'agents')],
      mcpServers: [
        {
          name: 'dsh',
          command: process.execPath,
          args: ['--input-type=module', '-e', MCP_BRIDGE_SOURCE, join(bridgeDirectory, 'tools.json'), socketPath],
          env: [],
        },
      ],
    }),
  )
  if (created._tag !== 'Success') throw new Error('the fake answered session/new with no session id')
  void rpc.request('session/prompt', { sessionId: created.success.sessionId, prompt: [{ type: 'text', text: input.prompt }] })
  return {
    fake,
    sessionId: created.success.sessionId,
    updates,
    bridgeCalls,
    answer: result => release?.(result),
  }
}

const toolCallNames = (updates: readonly AcpJson[]): string[] =>
  updates.flatMap(update => {
    const candidate = Schema.decodeUnknownSync(incomingSchema)(update)
    return candidate.sessionUpdate === 'tool_call' && candidate._meta?.tool_name !== undefined ? [candidate._meta.tool_name] : []
  })

const hasUpdate = (updates: readonly AcpJson[], kind: string): boolean =>
  updates.some(update => Schema.decodeUnknownSync(incomingSchema)(update).sessionUpdate === kind)

describe('the Vibe ACP ordering spike', () => {
  it('publishes a DSH tool as mcp_dsh.<tool> and emits its tool_call before the bridge call can be answered', async () => {
    const inspected = await inspect({ prompt: 'CALL_TOOL please' })
    await vi.waitFor(() => expect(inspected.bridgeCalls).toHaveLength(1), { timeout: 10_000 })
    // The call is still held inside Vibe's tool proxy, and the ACP update already reached the client.
    expect(toolCallNames(inspected.updates)).toEqual(['mcp_dsh.echo'])
    expect(inspected.bridgeCalls).toEqual([{ name: 'echo', arguments: '{"value":"ping"}' }])
    expect(inspected.fake.events()).toContain('tools ["echo"]')
    expect(inspected.fake.events().find(event => event.startsWith('session/new'))).toContain('mcp={"name":"dsh"')

    inspected.answer({ content: [{ type: 'text', text: 'pong' }], isError: false })
    await vi.waitFor(() => expect(inspected.fake.events()).toContain('bridge-answered'), { timeout: 10_000 })
    // The update came first, which is what lets the route end the DSH step on it.
    expect(inspected.fake.events().indexOf('tool_call-before-bridge')).toBeLessThan(inspected.fake.events().indexOf('bridge-answered'))
  })

  it('reports context size, cost and cumulative token meta on usage_update', async () => {
    const inspected = await inspect({ prompt: 'plain answer' })
    await vi.waitFor(() => expect(hasUpdate(inspected.updates, 'usage_update')).toBe(true), { timeout: 10_000 })
    const usage = inspected.updates.find(update => Schema.decodeUnknownSync(incomingSchema)(update).sessionUpdate === 'usage_update')
    const decoded = Schema.decodeUnknownSync(usageUpdateSchema)(usage)
    expect(decoded).toMatchObject({
      used: 4000,
      size: 1_048_576,
      cost: { amount: 0.5, currency: 'USD' },
      _meta: { promptTokens: 1200, completionTokens: 34, cachedTokens: 900, steps: 1 },
    })
  })

  it('answers a permission request for a bridged tool with allow, and one for a builtin with reject', async () => {
    const allowed = await inspect({ prompt: 'PERMISSION please' })
    await vi.waitFor(() => expect(allowed.fake.events().some(event => event.startsWith('permission '))).toBe(true), { timeout: 10_000 })
    expect(allowed.fake.events().find(event => event.startsWith('permission '))).toBe('permission {"outcome":{"outcome":"selected","optionId":"allow_once"}}')

    const rejected = await inspect({ prompt: 'PERMISSION_BUILTIN please' })
    await vi.waitFor(() => expect(rejected.fake.events().some(event => event.startsWith('permission '))).toBe(true), { timeout: 10_000 })
    expect(rejected.fake.events().find(event => event.startsWith('permission '))).toBe('permission {"outcome":{"outcome":"selected","optionId":"reject_once"}}')
  })
})
