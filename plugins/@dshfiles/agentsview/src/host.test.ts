import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import agentsviewHost from './host.js'

const FIXTURE_HOME = fileURLToPath(new URL('../fixtures/home', import.meta.url))
const TOOLS = [
  'agent_sessions_sources',
  'agent_sessions_list',
  'agent_sessions_read',
  'agent_sessions_search',
  'agent_sessions_stats',
  'agent_sessions_refresh',
]
const ENV_NAMES = ['HOME', 'DSH_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'] as const
const decodeListed = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      result: Schema.Struct({
        ok: Schema.Literal(true),
        value: Schema.Struct({ output: Schema.Struct({ sessions: Schema.Array(Schema.Struct({ key: Schema.String })) }) }),
      }),
    }),
  ),
)

describe('agentsview Host', () => {
  let root = ''
  const saved = new Map<string, string | undefined>()

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agentsview-host-'))
    cpSync(FIXTURE_HOME, join(root, 'home'), { recursive: true })
    for (const name of ENV_NAMES) saved.set(name, process.env[name])
    process.env.HOME = join(root, 'home')
    process.env.DSH_HOME = join(root, 'dsh-home')
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.CODEX_HOME
  })

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('registers its agent tools from the manifest and builds its layer on the first call', async () => {
    const recorder = recordSpans()
    const host = await createTestHost()
    try {
      await host.mount(agentsviewHost, { packageId: '@dshfiles/agentsview' })
      expect(TOOLS.map(name => host.tools.get(name)?.name)).toEqual(TOOLS)
      expect(recorder.named('plugin activate')).toHaveLength(0)
      const listed = await host.tools.execute({
        callId: 'call-1' as never,
        name: 'agent_sessions_sources',
        arguments: {},
        signal: new AbortController().signal,
      })
      expect(listed).toMatchObject({ isError: false })
      await host.connection.requestApi({ packageId: '@dshfiles/agentsview', apiId: 'agentsview', method: 'list', version: 1, input: {} })
      expect(recorder.named('plugin activate')).toHaveLength(1)
      expect(recorder.span('plugin activate').attributes).toMatchObject({ 'dshx.plugin.lazy': true })
    } finally {
      recorder.stop()
      await host.dispose()
    }
  })

  it('serves the agent-sessions API from HOME and registers a read-only agent tool per user capability', async () => {
    const host = await createTestHost()
    try {
      await host.mount(agentsviewHost, { packageId: '@dshfiles/agentsview' })
      expect(TOOLS.map(name => host.tools.get(name)?.name)).toEqual(TOOLS)
      const response = await host.connection.requestApi({ packageId: '@dshfiles/agentsview', apiId: 'agentsview', method: 'list', version: 1, input: {} })
      const body = decodeListed(await response.text())
      expect(body.result.value.output.sessions.map(session => session.key)).toEqual([
        'codex:22222222-2222-4222-8222-222222222222',
        'claude-code:11111111-1111-4111-8111-111111111111',
      ])
    } finally {
      await host.dispose()
    }
  })
})
