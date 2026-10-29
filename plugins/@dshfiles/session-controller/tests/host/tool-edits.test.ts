import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, expect, it } from 'vitest'

/**
 * dshx `defineHost({ toolEdits })` against the real tool runtime and Agent scopes. It lives here because this
 * package's tests already compose a real Agent; dshx itself carries no agent loop.
 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const tool = (name: string, description: string) =>
  defineTool({
    name,
    description,
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async () => `${name} ran`,
  })

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'tool-edits-'))
  const host = await createTestHost()
  cleanups.push(async () => {
    await host.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const ctx = host.ctx
  for (const plugin of [TypertRegistry, SessionStore, SessionProjectionRegistry, LlmRuntime, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentDefaultModel, { provider: 'scripted', model: 'model-a' })
  await ctx.plugin(AgentLoop)
  await host.mount(defineHost({ tools: [tool('acme_status', 'Report status.'), tool('acme_secret', 'Read the secret.'), tool('acme_jobs', 'List jobs.')] }), {
    packageId: '@acme/tools',
  })
  const createAgent = async (id: string) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root }, agentOptions: { provider: 'scripted', model: 'model-a' } })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  return { ctx, host, createAgent }
}

it('updates, removes and namespaces another plugin’s tools for live and later agents, and lifts every edit with the plugin', async () => {
  const { ctx, host, createAgent } = await fixture()
  const before = await createAgent('before-edits')
  const editor = await host.mount(
    defineHost({
      toolEdits: [
        { tools: 'acme_status', update: definition => ({ ...definition, description: 'Report status. Prefer it over shell probes.' }) },
        { tools: 'acme_secret', remove: true },
        { tools: /^acme_jobs$/, rename: name => `ci_${name}`, agents: agent => agent.id !== 'excluded' },
      ],
    }),
    { packageId: '@acme/editor' },
  )
  const after = await createAgent('after-edits')
  const excluded = await createAgent('excluded')
  const view = (agent: typeof before) => Object.fromEntries(ctx.tools.schemas(agent).map(schema => [schema.name, schema.description]))

  for (const agent of [before, after]) {
    expect(view(agent)).toMatchObject({ acme_status: 'Report status. Prefer it over shell probes.', ci_acme_jobs: 'List jobs.' })
    expect(view(agent)).not.toHaveProperty('acme_secret')
    expect(view(agent)).not.toHaveProperty('acme_jobs')
  }
  expect(view(excluded)).toHaveProperty('acme_jobs')
  expect(view(excluded)).not.toHaveProperty('ci_acme_jobs')
  expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(expect.arrayContaining(['acme_status', 'acme_secret', 'acme_jobs']))

  const ran = await ctx.tools.execute({ callId: ToolCallId('call-1'), name: 'ci_acme_jobs', arguments: {}, agent: after, signal: new AbortController().signal })
  expect(ran).toMatchObject({ isError: false, value: 'acme_jobs ran' })

  await editor.dispose()
  expect(view(after)).toMatchObject({ acme_status: 'Report status.', acme_secret: 'Read the secret.', acme_jobs: 'List jobs.' })
  expect(view(after)).not.toHaveProperty('ci_acme_jobs')
})

it('refuses a tool edit that names no tool and sets no code mode', async () => {
  const { host } = await fixture()
  await expect(host.mount(defineHost({ toolEdits: [{ remove: true }] }), { packageId: '@acme/broken' })).rejects.toThrow('toolEdits')
})

it('presents an agent’s tools as code when an edit asks for code mode', async () => {
  const { ctx, host, createAgent } = await fixture()
  await host.mount(defineHost({ toolEdits: [{ codeMode: true, agents: agent => agent.id === 'coder' }] }), { packageId: '@acme/code-mode' })
  const coder = await createAgent('coder')
  const plain = await createAgent('plain')
  expect(ctx.tools.schemas(coder).map(schema => schema.name)).toContain('run_code')
  expect(ctx.tools.schemas(plain).map(schema => schema.name)).not.toContain('run_code')
})
