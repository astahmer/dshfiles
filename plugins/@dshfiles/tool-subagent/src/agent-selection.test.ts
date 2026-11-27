import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentActivationSpec, SubagentProvider } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubagentAgentChoice, SubagentAgentResolution, SubagentAgentResolver } from './agent-resolver.ts'
import * as tool from './native/index.ts'
import { AGENT_PARAMETER_DESCRIPTION } from './native/agent-selection.ts'

const PARENT_ROUTE = { provider: 'alpha', model: 'fast-model' }
const REVIEWER_ROUTE = { provider: 'beta', model: 'review-model', reasoningEffort: 'high' }
const EXPLICIT_ROUTE = { provider: 'gamma', model: 'explicit-model' }

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

const fakeProvider = (name: string, inheritsParentContext: boolean): SubagentProvider => ({
  name,
  inheritsParentContext,
  capabilities: { agentOptions: true, agentPreset: !inheritsParentContext, outputSchema: false, depthLimit: true },
  prepareContinuable: () => Promise.reject(new Error('not started in this test')),
})

/** Records the order of `record` and `startActivation`, so a test can assert the child's agent existed first. */
const boot = async (options: { resolver?: SubagentAgentResolver; allowedModels?: readonly { provider: string; model: string }[] } = {}) => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(WorkingDirectoryService, { defaultDirectory: tmpdir() })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(fakeProvider('spawn', false))
  ctx.subagents.registerProvider(fakeProvider('fork', true))
  if (options.resolver !== undefined) ctx.provide('dshfilesSubagentAgents', options.resolver)
  const order: string[] = []
  const started: SubagentActivationSpec[] = []
  vi.spyOn(ctx.subagents, 'startActivation').mockImplementation(spec => {
    order.push('start')
    started.push(spec)
    return Promise.resolve({ childId: spec.childId ?? SessionId('child'), name: 'agent-1' }) as never
  })
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('llm service missing')
  const preflight = vi.spyOn(llm, 'resolveCallConfig').mockResolvedValue({} as never)
  await tool.apply(ctx, { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true })
  await tool.apply(ctx, { provider: 'fork', toolName: 'subagent_fork' })
  const session = Session.create(SessionId('parent'))
  if (options.allowedModels !== undefined) session.append('subagent/model-selection-policy', { allowedModels: [...options.allowedModels] })
  const parentFields: Pick<Agent, 'id' | 'session' | 'options'> = { id: session.id, session, options: { ...PARENT_ROUTE } }
  // SAFETY: the tool reads only id, session and options of its calling agent; startActivation is stubbed.
  const parent = parentFields as Agent
  const run = (name: string, args: CallArgs) => {
    const definition = toolOf(ctx, name)
    const exec: Pick<ToolRunContext, 'agent' | 'signal'> = { agent: parent, signal: new AbortController().signal }
    // SAFETY: the delegation tools read only exec.agent and exec.signal; args are the model's JSON as the runtime passes it.
    return definition.execute(args as never, exec as ToolRunContext)
  }
  return { ctx, order, started, preflight, run }
}

/** The model-facing arguments these tests send. */
interface CallArgs {
  readonly description?: string
  readonly prompt?: string
  readonly agent?: string
  readonly provider?: string
  readonly model?: string
}

const toolOf = (ctx: Context, name: string): ToolDefinition => {
  const definition = ctx.tools.get(name)
  if (definition === undefined) throw new Error(`${name} is not registered`)
  return definition
}

interface ParameterSchema {
  readonly type: string
  readonly description?: string
}

const propertiesOf = (definition: ToolDefinition): Readonly<Partial<Record<string, ParameterSchema>>> => {
  // SAFETY: defineTool compiles the declared parameters into a JSON Schema object with a `properties` map.
  const schema = definition.parameters as { readonly properties: Partial<Record<string, ParameterSchema>> }
  return schema.properties
}

const choice = (order: string[], overrides: Partial<SubagentAgentChoice> = {}): SubagentAgentChoice => ({
  kind: 'agent',
  handle: 'reviewer',
  route: REVIEWER_ROUTE,
  preset: 'review',
  preamble: 'Work as @reviewer — Reviewer.\n\nReview carefully.',
  record: childSessionId => {
    order.push(`record:${childSessionId}`)
    return Promise.resolve()
  },
  ...overrides,
})

/** A resolver that answers `answer` and remembers what it was asked. */
const resolverOf = (answer: (handle: string | undefined) => SubagentAgentResolution) => {
  const asked: (string | undefined)[] = []
  const resolver: SubagentAgentResolver = {
    resolve: request => {
      asked.push(request.handle)
      return answer(request.handle)
    },
    list: () => ({
      parent: 'lead',
      default: 'reviewer',
      agents: [{ handle: 'reviewer', name: 'Reviewer', description: 'Reviews diffs', route: REVIEWER_ROUTE, preset: 'review' }],
      change: 'Change it in the Agents panel.',
    }),
  }
  return { resolver, asked }
}

describe('subagent agent argument', () => {
  it('declares agent on subagent only, with a constant description, whether or not a resolver is loaded', async () => {
    const { ctx } = await boot()
    const fresh = toolOf(ctx, 'subagent')
    const fork = toolOf(ctx, 'subagent_fork')
    expect(propertiesOf(fresh)['agent']).toEqual({ type: 'string', description: AGENT_PARAMETER_DESCRIPTION })
    expect(propertiesOf(fresh)['agent']?.description).not.toMatch(/@?reviewer|lead/u)
    expect(Object.keys(propertiesOf(fork))).not.toContain('agent')
    expect(Object.keys(propertiesOf(fork))).toContain('prompt')
  })

  it('starts the child as the named agent: route, preset, preamble, recorded before the child starts', async () => {
    const order: string[] = []
    const { resolver, asked } = resolverOf(() => choice(order))
    const booted = await boot({ resolver })
    const result = await booted.run('subagent', { description: 'review', prompt: 'Review the diff.', agent: '@reviewer' })
    expect(result).toEqual({ kind: 'activation', name: 'agent-1' })
    expect(asked).toEqual(['reviewer'])
    const spec = booted.started[0]
    expect(spec?.childId).toBeDefined()
    expect(order).toEqual([`record:${String(spec?.childId)}`])
    expect(booted.order).toEqual(['start'])
    expect(spec?.agentOptions).toMatchObject({ provider: 'beta', model: 'review-model', reasoningEffort: 'high' })
    expect(spec?.agentPreset).toBe('review')
    expect(spec?.prompt).toEqual([{ type: 'text', text: 'Work as @reviewer — Reviewer.\n\nReview carefully.\n\n---\n\nReview the diff.' }])
    expect(booted.preflight).toHaveBeenCalledWith({ provider: 'beta', model: 'review-model', reasoningEffort: 'high' }, expect.anything())
  })

  it('records the agent before startActivation is called', async () => {
    const events: string[] = []
    const { resolver } = resolverOf(() =>
      choice(events, {
        record: id => {
          events.push(`record:${id}`)
          return Promise.resolve()
        },
      }),
    )
    const booted = await boot({ resolver })
    vi.mocked(booted.ctx.subagents.startActivation).mockImplementation(spec => {
      events.push(`start:${String(spec.childId)}`)
      return Promise.resolve({ childId: spec.childId ?? SessionId('child'), name: 'agent-1' }) as never
    })
    await booted.run('subagent', { description: 'review', prompt: 'x', agent: 'reviewer' })
    expect(events).toHaveLength(2)
    expect(events[0]?.replace('record:', '')).toBe(events[1]?.replace('start:', ''))
    expect(events[0]?.startsWith('record:')).toBe(true)
  })

  it('applies the default agent when agent is omitted (the resolver answers for an undefined handle)', async () => {
    const order: string[] = []
    const { resolver, asked } = resolverOf(handle => (handle === undefined ? choice(order) : { kind: 'refused', message: 'unexpected' }))
    const booted = await boot({ resolver })
    await booted.run('subagent', { description: 'review', prompt: 'x' })
    expect(asked).toEqual([undefined])
    expect(booted.started[0]?.agentPreset).toBe('review')
    expect(order).toHaveLength(1)
  })

  it('keeps upstream behavior when the resolver says inherit: no reserved id, no preamble', async () => {
    const { resolver } = resolverOf(() => ({ kind: 'inherit' }))
    const booted = await boot({ resolver })
    await booted.run('subagent', { description: 'task', prompt: 'Do it.' })
    expect(booted.started[0]?.childId).toBeUndefined()
    expect(booted.started[0]?.prompt).toEqual([{ type: 'text', text: 'Do it.' }])
    expect(booted.started[0]?.agentOptions).toBeUndefined()
  })

  it('refuses with the resolver message and starts nothing', async () => {
    const { resolver } = resolverOf(() => ({ kind: 'refused', message: '@lead may not start @ops: allowed are @reviewer.' }))
    const booted = await boot({ resolver })
    await expect(booted.run('subagent', { description: 'x', prompt: 'x', agent: 'ops' })).rejects.toThrow('@lead may not start @ops')
    expect(booted.started).toHaveLength(0)
  })

  it('refuses agent without a resolver, naming the plugin to enable, and keeps omission working', async () => {
    const booted = await boot()
    await expect(booted.run('subagent', { description: 'x', prompt: 'x', agent: 'reviewer' })).rejects.toThrow(/@dshfiles\/agents/u)
    expect(booted.started).toHaveLength(0)
    await booted.run('subagent', { description: 'x', prompt: 'x' })
    expect(booted.started).toHaveLength(1)
  })

  it('lets explicit provider/model win over the agent route, under the Session policy', async () => {
    const order: string[] = []
    const { resolver } = resolverOf(() => choice(order))
    const booted = await boot({ resolver, allowedModels: [EXPLICIT_ROUTE] })
    await booted.run('subagent', { description: 'x', prompt: 'x', agent: 'reviewer', ...EXPLICIT_ROUTE })
    expect(booted.started[0]?.agentOptions).toMatchObject({ provider: 'gamma', model: 'explicit-model' })
    expect(booted.started[0]?.agentPreset).toBe('review')
    await expect(
      booted.run('subagent', { description: 'x', prompt: 'x', agent: 'reviewer', provider: 'delta', model: 'nope' }),
    ).rejects.toThrow('is not allowed for this Session')
  })

  it('admits the agent route without a Session policy entry, because the user configured it', async () => {
    const order: string[] = []
    const { resolver } = resolverOf(() => choice(order))
    const booted = await boot({ resolver, allowedModels: [EXPLICIT_ROUTE] })
    await booted.run('subagent', { description: 'x', prompt: 'x', agent: 'reviewer' })
    expect(booted.started[0]?.agentOptions).toMatchObject({ provider: 'beta', model: 'review-model' })
  })

  it('refuses agent on subagent_fork without asking the resolver', async () => {
    const { resolver, asked } = resolverOf(() => ({ kind: 'inherit' }))
    const booted = await boot({ resolver })
    await expect(booted.run('subagent_fork', { description: 'x', prompt: 'x', agent: 'reviewer' })).rejects.toThrow(/always runs as your own agent/u)
    await booted.run('subagent_fork', { description: 'x', prompt: 'x' })
    expect(asked).toEqual([])
    expect(booted.started).toHaveLength(1)
  })

  it('lists the agents the caller may start in list_subagent_models', async () => {
    const { resolver } = resolverOf(() => ({ kind: 'inherit' }))
    const booted = await boot({ resolver, allowedModels: [PARENT_ROUTE] })
    vi.spyOn(booted.ctx.get('llm')!, 'listProviders').mockReturnValue([{ id: 'alpha', name: 'Alpha' }] as never)
    const text = String(await booted.run('list_subagent_models', {}))
    expect(text).toContain('alpha — Alpha')
    expect(text).toContain('reviewer [default] — Reviewer; beta/review-model (high); preset review: Reviews diffs')
    expect(text).toContain('Change it in the Agents panel.')
  })
})
