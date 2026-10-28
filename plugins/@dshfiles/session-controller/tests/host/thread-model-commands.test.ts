import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import { LlmAdapter, LlmRuntime, ReasoningEffortId, createUserMessage, type GenerateOptions, type LlmCallConfig, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../../src/native/agent.ts'
import { SessionCommandController } from '../../src/native/commands.ts'
import { installModelSelectionProjection } from '../../src/native/model-selection-projection.ts'
import { threadModelPolicyProjection } from '../../src/thread-model-policy.ts'
// Test-only cross-plugin integration: exercise the actual production capture helper, not a restated listener.
import { ThreadRequestPolicy } from '../../../ai-accounts/src/thread-request-policy.ts'

const oldSelection = { provider: 'account-a', model: 'model-a', reasoningEffort: ReasoningEffortId('high') }
const newSelection = { provider: 'account-b', model: 'model-b', reasoningEffort: ReasoningEffortId('low') }
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function gate() {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    hold: async () => {
      entered.resolve()
      await release.promise
    },
  }
}

/** The only external seam: deterministic model metadata and stream, never provider I/O. */
class CatalogAdapter extends LlmAdapter {
  readonly requests: LlmCallConfig[] = []
  beforeResolve: (() => Promise<void>) | undefined

  override async listModels(provider: string) {
    return [
      { provider, id: 'model-a', name: 'Model A' },
      { provider, id: 'model-b', name: 'Model B' },
    ]
  }

  override async resolveModel(provider: string, model: string) {
    await this.beforeResolve?.()
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('high'), name: 'High' },
          { id: ReasoningEffortId('low'), name: 'Low' },
        ],
      },
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const config: LlmCallConfig = { provider: options.provider, model: options.model }
    if (options.reasoningEffort !== undefined) config.reasoningEffort = options.reasoningEffort
    this.requests.push(config)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Done.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Real command/Agent owner, registries, Inbox, model resolver and disposable persistence. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'thread-model-commands-'))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(RemoteAccess)
  await ctx.plugin(AgentDefaultModel, { provider: 'global-account', model: 'global-model' })
  await ctx.plugin(AgentLoop)
  ctx.sessionProjections.register(threadModelPolicyProjection)
  installModelSelectionProjection(ctx)
  const adapter = new CatalogAdapter()
  ctx.llm.registerAdapter(['account-a', 'account-b'], adapter)
  const owner = new ApiSessionAgentController(ctx)
  const handle = await ctx.agents.create({
    sessionId: SessionId('command-thread'),
    meta: { cwd: root },
    agentOptions: oldSelection,
    setup: (_agentCtx, agent) => {
      owner.selectionFor(agent)
    },
  })
  cleanups.push(() => handle.dispose())
  const agent = handle.agent
  const commands = new SessionCommandController(ctx, owner, root)
  const saveDefault = vi.spyOn(ctx.agentDefaultModel, 'saveSelection')
  const policy = () => ctx.sessionProjections.stateOf(agent.session, 'threadModelPolicy')
  const select = (expectedRevision = policy()?.revision ?? 0) =>
    commands.selectThreadModel({
      sessionId: agent.id,
      selection: newSelection,
      expectedRevision,
      preferSelectedProvider: true,
    })
  return { ctx, agent, commands, owner, adapter, saveDefault, policy, select }
}

it('thread-local selection commits adjacent durable intent without saving the global default or waking input', async () => {
  const { ctx, agent, owner, saveDefault, policy, select } = await fixture()
  const result = await select()
  expect(result).toEqual({ sessionId: agent.id, selection: newSelection, revision: 1, running: false, preferSelectedProvider: true })
  expect(policy()).toEqual({ revision: 1, selection: newSelection, preferSelectedProvider: true })
  expect(owner.selectionFor(agent).current).toEqual(newSelection)
  expect(agent.session.snapshotEvents().map(event => event.type)).toEqual(['model/selection', 'plugin:dshfiles/session-controller/thread-selection'])
  expect(saveDefault).not.toHaveBeenCalled()
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'global-account', model: 'global-model' })
  expect(agent.status).toBe('idle')
  expect(agent.inbox.nextTurn).toEqual([])
  expect(agent.inbox.nextStep).toEqual([])
})

it('normal native selectModel retains its global-default save and clears thread preference', async () => {
  const { agent, commands, saveDefault, policy, select } = await fixture()
  await select()
  await expect(commands.selectModel({ sessionId: agent.id, ...oldSelection })).resolves.toEqual({ selected: oldSelection })
  expect(saveDefault).toHaveBeenCalledExactlyOnceWith(oldSelection)
  expect(policy()).toEqual({ revision: 3, selection: oldSelection, preferSelectedProvider: false })
})

it('rejects stale CAS without changing native selection, policy, or global default', async () => {
  const { agent, owner, saveDefault, policy, select } = await fixture()
  await select()
  const events = agent.session.snapshotEvents()
  const before = policy()
  await expect(select(0)).rejects.toMatchObject({ code: 'thread-model-stale' })
  expect(agent.session.snapshotEvents()).toEqual(events)
  expect(policy()).toEqual(before)
  expect(owner.selectionFor(agent).current).toEqual(newSelection)
  expect(saveDefault).not.toHaveBeenCalled()
})

it('serializes competing thread-local selections so only one caller with the same revision commits', async () => {
  const { agent, saveDefault, policy, select } = await fixture()
  const results = await Promise.allSettled([select(0), select(0)])
  expect(results[0]).toMatchObject({ status: 'fulfilled', value: { revision: 1 } })
  expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'thread-model-stale' } })
  expect(agent.session.snapshotEvents().map(event => event.type)).toEqual(['model/selection', 'plugin:dshfiles/session-controller/thread-selection'])
  expect(policy()).toEqual({ revision: 1, selection: newSelection, preferSelectedProvider: true })
  expect(saveDefault).not.toHaveBeenCalled()
})

it.each([
  { name: 'different-route selection', selection: newSelection },
  { name: 'same-route reselection', selection: oldSelection },
])('a queued old automatic follow cannot overwrite the manual $name at the commit boundary', async ({ selection }) => {
  const { agent, commands, adapter, owner, saveDefault, policy } = await fixture()
  const initial = await commands.selectThreadModel({
    sessionId: agent.id,
    selection: oldSelection,
    expectedRevision: 0,
    preferSelectedProvider: true,
  })
  const resolving = gate()
  cleanups.push(async () => resolving.release())
  adapter.beforeResolve = vi.fn<() => Promise<void>>().mockResolvedValue(undefined).mockImplementationOnce(resolving.hold)
  const manual = commands.selectThreadModel({
    sessionId: agent.id,
    selection,
    expectedRevision: initial.revision,
    preferSelectedProvider: true,
  })
  await resolving.entered
  const automatic = commands.selectThreadModel({
    sessionId: agent.id,
    selection: newSelection,
    expectedRevision: initial.revision,
    preferSelectedProvider: false,
  })
  // Attach rejection handling before releasing the real admission mutex.
  const automaticRejected = expect(automatic).rejects.toMatchObject({ code: 'thread-model-stale' })
  resolving.release()
  const accepted = await manual
  await automaticRejected
  expect(accepted.revision).toBeGreaterThan(initial.revision)
  expect(policy()).toEqual({ revision: accepted.revision, selection, preferSelectedProvider: true })
  expect(owner.selectionFor(agent).current).toEqual(selection)
  expect(agent.session.snapshotEvents().map(event => event.type)).toEqual([
    'model/selection',
    'plugin:dshfiles/session-controller/thread-selection',
    'model/selection',
    'plugin:dshfiles/session-controller/thread-selection',
  ])
  expect(adapter.requests).toEqual([])
  expect(saveDefault).not.toHaveBeenCalled()
})

it('rechecks CAS after model resolution awaits rather than overwriting an intervening picker selection', async () => {
  const { agent, owner, adapter, saveDefault, policy, select } = await fixture()
  const resolving = gate()
  cleanups.push(async () => resolving.release())
  adapter.beforeResolve = resolving.hold
  const selecting = select(0)
  await resolving.entered
  owner.selectForNextRequest(agent, oldSelection)
  const events = agent.session.snapshotEvents()
  resolving.release()
  await expect(selecting).rejects.toMatchObject({ code: 'thread-model-stale' })
  expect(agent.session.snapshotEvents()).toEqual(events)
  expect(policy()).toEqual({ revision: 1, selection: oldSelection, preferSelectedProvider: false })
  expect(saveDefault).not.toHaveBeenCalled()
})

it('rechecks pending input after model validation and refuses without adding a selection or waking the Agent', async () => {
  const { agent, adapter, saveDefault, select } = await fixture()
  const resolving = gate()
  cleanups.push(async () => resolving.release())
  adapter.beforeResolve = resolving.hold
  const selecting = select()
  await resolving.entered
  agent.inject(createUserMessage({ content: [{ type: 'text', text: 'Parked context' }], source: { kind: 'user' } }))
  const events = agent.session.snapshotEvents()
  resolving.release()
  await expect(selecting).rejects.toMatchObject({ code: 'thread-model-busy' })
  expect(agent.session.snapshotEvents()).toEqual(events)
  expect(agent.status).toBe('idle')
  expect(agent.inbox.nextStep).toHaveLength(1)
  expect(saveDefault).not.toHaveBeenCalled()
})

it.each([
  { name: 'different-route selection', selection: newSelection },
  { name: 'same-route reselection', selection: oldSelection },
])('captures the old request revision before held assembly despite a manual $name', async ({ selection }) => {
  const { agent, commands, adapter, saveDefault, policy } = await fixture()
  const initial = await commands.selectThreadModel({
    sessionId: agent.id,
    selection: oldSelection,
    expectedRevision: 0,
    preferSelectedProvider: true,
  })
  const requestPolicy = new ThreadRequestPolicy(agent, () => policy() ?? null)
  cleanups.push(async () => requestPolicy.dispose())
  const assembling = gate()
  cleanups.push(async () => assembling.release())
  const dispatchedRevisions: number[] = []
  agent.ctx.on('agent/request', async (_payload, next) => {
    const request = await next()
    dispatchedRevisions.push(requestPolicy.revision)
    return request
  })
  let first = true
  agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    if (first) {
      first = false
      await assembling.hold()
    }
    return next()
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Request before selection' }], source: { kind: 'user' } }))
  await assembling.entered
  expect(requestPolicy.revision).toBe(initial.revision)
  const manual = await commands.selectThreadModel({
    sessionId: agent.id,
    selection,
    expectedRevision: initial.revision,
    preferSelectedProvider: true,
  })
  expect(manual.running).toBe(true)
  expect(manual.revision).toBeGreaterThan(initial.revision)
  expect(requestPolicy.revision).toBe(initial.revision)
  assembling.release()
  await agent.whenIdle()
  expect(adapter.requests).toEqual([oldSelection])
  expect(dispatchedRevisions).toEqual([initial.revision])
  expect(requestPolicy.revision).toBe(initial.revision)
  expect(policy()).toEqual({ revision: manual.revision, selection, preferSelectedProvider: true })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Request after selection' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(adapter.requests).toEqual([oldSelection, selection])
  expect(dispatchedRevisions).toEqual([initial.revision, manual.revision])
  expect(requestPolicy.revision).toBe(manual.revision)
  expect(saveDefault).not.toHaveBeenCalled()
})

it('disposing the actual request-policy helper unregisters capture from later real assemblies', async () => {
  const { agent, commands, adapter, saveDefault, policy } = await fixture()
  const initial = await commands.selectThreadModel({
    sessionId: agent.id,
    selection: oldSelection,
    expectedRevision: 0,
    preferSelectedProvider: true,
  })
  const readPolicy = vi.fn(() => policy() ?? null)
  const requestPolicy = new ThreadRequestPolicy(agent, readPolicy)
  cleanups.push(async () => requestPolicy.dispose())
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Capture this request' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(requestPolicy.revision).toBe(initial.revision)
  expect(readPolicy).toHaveBeenCalledOnce()
  requestPolicy.dispose()
  const manual = await commands.selectThreadModel({
    sessionId: agent.id,
    selection: newSelection,
    expectedRevision: initial.revision,
    preferSelectedProvider: true,
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'After helper disposal' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(adapter.requests).toEqual([oldSelection, newSelection])
  expect(policy()?.revision).toBe(manual.revision)
  expect(requestPolicy.revision).toBe(initial.revision)
  expect(readPolicy).toHaveBeenCalledOnce()
  expect(saveDefault).not.toHaveBeenCalled()
})

it.each(['native', 'thread-local'] as const)(
  '%s selection during prompt assembly preserves the current request and routes the following request to the new model',
  async entryPoint => {
    const { agent, commands, adapter, owner, saveDefault, policy, select } = await fixture()
    await commands.selectModel({ sessionId: agent.id, ...oldSelection })
    expect(saveDefault).toHaveBeenCalledExactlyOnceWith(oldSelection)
    saveDefault.mockClear()
    const assembling = gate()
    cleanups.push(async () => assembling.release())
    let first = true
    agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      if (first) {
        first = false
        await assembling.hold()
      }
      return next()
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'First request' }], source: { kind: 'user' } }))
    await assembling.entered
    expect(agent.status).toBe('running')
    if (entryPoint === 'native') await commands.selectModel({ sessionId: agent.id, ...newSelection })
    else await expect(select()).resolves.toMatchObject({ running: true, selection: newSelection, preferSelectedProvider: true })
    expect(owner.selectionFor(agent).current).toEqual(newSelection)
    const selectedPolicy = policy()
    assembling.release()
    await agent.whenIdle()
    expect(adapter.requests).toEqual([oldSelection])
    expect(owner.selectionFor(agent).assembled).toEqual(oldSelection)
    expect(policy()).toEqual(selectedPolicy)
    expect(agent.inbox.nextTurn).toEqual([])
    expect(agent.inbox.nextStep).toEqual([])
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Next request' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests).toEqual([oldSelection, newSelection])
    expect(policy()).toEqual(selectedPolicy)
    if (entryPoint === 'native') expect(saveDefault).toHaveBeenCalledExactlyOnceWith(newSelection)
    else expect(saveDefault).not.toHaveBeenCalled()
  },
)
