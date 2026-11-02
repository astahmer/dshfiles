import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import projectChecksHost from './host.js'

// The wire code and message of each Project Checks API failure. Each failure kind is its own tagged error with a
// `dshxWireCode`, so the client reads the domain code and message; schema failures keep `contract`.

let host: TestHost
const temporary: string[] = []
let projectRoot = ''
const previousDshHome = process.env['DSH_HOME']

const wireEnvelope = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

type ApiInput = Parameters<TestHost['connection']['requestApi']>[0]['input']
type WireOutcome = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string }

const call = async (method: string, input: ApiInput): Promise<WireOutcome> => {
  const response = await host.connection.requestApi({ packageId: '@dshfiles/project-checks', apiId: 'project-checks', method, version: 1, input })
  const envelope = Schema.decodeUnknownSync(wireEnvelope)(await response.json())
  if (envelope.result.ok) return { ok: true }
  return { ok: false, code: envelope.result.error.code, message: envelope.result.error.message }
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-checks-wire-'))
  temporary.push(root)
  projectRoot = await realpath(root)
  process.env['DSH_HOME'] = join(root, 'dsh-home')
  host = await createTestHost()
  const ctx = host.ctx
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(LocalSubprocessRuntime)
  const config = { actions: [{ id: 'check', label: 'Check', command: 'true', root: projectRoot }] }
  ctx.provide('agents', {})
  ctx.provide('configEditor', {
    entries: () => [{ options: { id: 'dshfiles-project-checks', name: '@dshfiles/project-checks', config }, fiber: {} }],
  })
  ctx.provide('sessionQuery', {
    readTitleSnapshot: async (sessionId: string) => ({ session: { id: sessionId, cwd: sessionId === 'outside-session' ? '/' : projectRoot } }),
    listEvents: async () => [],
    readEvent: async () => undefined,
  })
  await host.mount(projectChecksHost, { packageId: '@dshfiles/project-checks', config })
})

afterAll(async () => {
  await host.dispose()
  if (previousDshHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = previousDshHome
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('project-checks wire failures', () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly method: string; readonly input: ApiInput; readonly expected: WireOutcome }> = [
    {
      name: 'run without a session id from a non-agent caller',
      method: 'run',
      input: { actionId: 'check' },
      expected: { ok: false, code: 'checks-target-unknown', message: 'Pass sessionId: this tool cannot tell which thread to check.' },
    },
    {
      name: 'run of an action that is not configured',
      method: 'run',
      input: { sessionId: 'inside-session', actionId: 'missing' },
      expected: { ok: false, code: 'checks-action-not-configured', message: 'Project action is not configured.' },
    },
    {
      name: 'run in a session outside the trusted root',
      method: 'run',
      input: { sessionId: 'outside-session', actionId: 'check' },
      expected: { ok: false, code: 'checks-action-not-visible', message: 'Project action is not available in this session directory.' },
    },
    {
      name: 'dispatch of an action that is not configured',
      method: 'dispatch',
      input: { sessionId: 'inside-session', actionId: 'missing', idempotencyKey: '00000000-0000-4000-8000-000000000001' },
      expected: { ok: false, code: 'checks-durable-action-unsupported', message: 'Durable Project Checks currently supports configured local actions only.' },
    },
    {
      name: 'cancel of an unknown task',
      method: 'cancelTask',
      input: { sessionId: 'inside-session', taskId: 'a'.repeat(64) },
      expected: { ok: false, code: 'checks-task-not-found', message: 'No durable task belongs to this session.' },
    },
    {
      name: 'retry of an unknown task',
      method: 'retryTask',
      input: { sessionId: 'inside-session', taskId: 'a'.repeat(64), confirmPossibleDuplicate: true },
      expected: { ok: false, code: 'checks-task-not-found', message: 'No durable task belongs to this session.' },
    },
    {
      name: 'input outside the API schema',
      method: 'cancelTask',
      input: { sessionId: 'inside-session', taskId: 'not-a-task-id' },
      expected: { ok: false, code: 'contract', message: '' },
    },
    {
      name: 'listing tasks for a session with none',
      method: 'tasks',
      input: { sessionId: 'inside-session' },
      expected: { ok: true },
    },
  ]

  it.each(cases)('$name', async ({ method, input, expected }) => {
    const outcome = await call(method, input)
    if (expected.ok || expected.message !== '') expect(outcome).toEqual(expected)
    if (!expected.ok && expected.message === '') expect(outcome).toMatchObject({ ok: false, code: expected.code })
  })
})
