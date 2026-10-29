import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import { LlmAdapter, LlmRuntime, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { createHostApiClient, defineHost, pluginStorage } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, expect, it } from 'vitest'
import { ApiSessionAgentController } from '../../src/native/agent.ts'
import { SessionCommandController } from '../../src/native/commands.ts'
import { installModelSelectionProjection } from '../../src/native/model-selection-projection.ts'
import { sessionsApi } from '../../src/sessions-api.ts'
import { loadSessionInstructions, sessionInstructionsSection, sessionsHost } from '../../src/sessions-host.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** The only external seam: a model that answers every request with the next scripted text, never provider I/O. */
class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly replies: readonly string[] = []) {
    super()
  }
  override async listModels(provider: string) {
    return [{ provider, id: 'model-a', name: 'Model A' }]
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reply = this.replies[this.requests.length] ?? 'Done.'
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Real Agent, loop, inbox, commands, prompts and storage; the Session controller is the fork's own command owner. */
const fixture = async (replies: readonly string[] = []) => {
  const root = await mkdtemp(join(tmpdir(), 'sessions-api-'))
  const host = await createTestHost()
  cleanups.push(async () => {
    await host.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const ctx = host.ctx
  for (const plugin of [TypertRegistry, SessionStore, SessionProjectionRegistry, LlmRuntime, AgentRegistry, Storage]) await ctx.plugin(plugin)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(RemoteAccess)
  await ctx.plugin(AgentDefaultModel, { provider: 'scripted', model: 'model-a' })
  await ctx.plugin(AgentLoop)
  installModelSelectionProjection(ctx)
  const model = new ScriptedModel(replies)
  ctx.llm.registerAdapter(['scripted'], model)
  const owner = new ApiSessionAgentController(ctx)
  const handle = await ctx.agents.create({
    sessionId: SessionId('driven-thread'),
    meta: { cwd: root },
    agentOptions: { provider: 'scripted', model: 'model-a' },
    setup: (_agentCtx, agent) => void owner.selectionFor(agent),
  })
  cleanups.push(() => handle.dispose())
  const commands = new SessionCommandController(ctx, owner, root)
  ctx.provide('sessionController', {
    resolveAgent: (sessionId: SessionId) => owner.resolveAgent(sessionId),
    list: async () => ({
      items: [
        { sessionId: handle.agent.id, updatedAt: 2, running: handle.agent.status !== 'idle', blank: false, agentAvailable: true, cwd: root },
        { sessionId: SessionId('blank-thread'), updatedAt: 3, running: false, blank: true, agentAvailable: false },
        { sessionId: SessionId('older-thread'), updatedAt: 1, running: false, blank: false, agentAvailable: false, cwd: '/elsewhere' },
      ],
    }),
    // Native admission also needs the attachment and upload services; a text prompt enters the inbox the same way.
    prompt: async (request: Parameters<SessionCommandController['prompt']>[0]) => {
      const resolved = await owner.resolveAgent(request.sessionId)
      if ('error' in resolved) throw resolved.error
      const content = request.content.flatMap(part => (part.type === 'text' ? [{ type: 'text' as const, text: part.text }] : []))
      const message = createUserMessage({ content, source: { kind: 'user' } })
      if (request.mode === 'steer') resolved.agent.steer(message)
      else resolved.agent.followup(message)
      return { accepted: true as const }
    },
    cancel: (request: Parameters<SessionCommandController['cancel']>[0]) => commands.cancel(request),
    selectModel: (request: Parameters<SessionCommandController['selectModel']>[0]) => commands.selectModel(request),
  })
  await host.mount(
    defineHost({
      name: '@dshfiles/session-controller',
      inject: ['remoteAccess', 'agents'],
      apis: [sessionsHost],
      prompts: [sessionInstructionsSection],
      setup: loadSessionInstructions,
    }),
    { packageId: '@dshfiles/session-controller' },
  )
  const sessions = createHostApiClient(ctx, sessionsApi, '@acme/driver')
  return { ctx, agent: handle.agent, model, sessions }
}

const textOf = (options: GenerateOptions | undefined): string =>
  JSON.stringify([
    options?.system ?? '',
    ...(options?.messages ?? []).flatMap(message => message.content.map(block => (block.type === 'text' ? block.text : ''))),
  ])

it('prompts a thread, waits for its turn, and carries keyed instructions in every later request', async () => {
  const { ctx, agent, model, sessions } = await fixture()
  expect(await sessions.setInstruction({ sessionId: agent.id, key: '@acme/driver:style', text: 'Answer in French.' })).toEqual({
    entries: [{ key: '@acme/driver:style', text: 'Answer in French.' }],
  })
  expect((await pluginStorage(ctx, '@dshfiles/session-controller').get(`instructions/${agent.id}/@acme/driver:style`))?.value).toBe('Answer in French.')

  await sessions.prompt({ sessionId: agent.id, text: 'Hello' })
  expect(await sessions.wait({ sessionId: agent.id, timeoutMs: 10_000 })).toEqual({ status: 'idle' })
  expect(textOf(model.requests[0])).toContain('Answer in French.')
  expect(textOf(model.requests[0])).toContain('Hello')

  await sessions.setInstruction({ sessionId: agent.id, key: '@acme/driver:style', text: null })
  expect(await sessions.instructions({ sessionId: agent.id })).toEqual({ entries: [] })
  await sessions.prompt({ sessionId: agent.id, text: 'Again' })
  await sessions.wait({ sessionId: agent.id, timeoutMs: 10_000 })
  expect(textOf(model.requests.at(-1))).not.toContain('Answer in French.')
})

it('adds a plugin message that waits for the next turn unless asked to wake the thread', async () => {
  const { agent, model, sessions } = await fixture()
  const { messageId } = await sessions.message({ sessionId: agent.id, text: 'The build finished.' })
  expect(agent.inbox.nextTurn.map(message => ({ id: message.id, source: message.source }))).toEqual([
    { id: messageId, source: { kind: 'dshfiles-plugin-message', from: '@acme/driver' } },
  ])
  expect(agent.status).toBe('idle')
  expect(model.requests).toHaveLength(0)

  await sessions.message({ sessionId: agent.id, text: 'Look at it now.', wake: true })
  expect(await sessions.wait({ sessionId: agent.id, timeoutMs: 10_000 })).toEqual({ status: 'idle' })
  expect(textOf(model.requests[0])).toContain('The build finished.')
  expect(textOf(model.requests.at(-1))).toContain('Look at it now.')
})

it('names a missing command with a recovery hint and refuses an unknown thread', async () => {
  const { agent, sessions } = await fixture()
  await expect(sessions.command({ sessionId: agent.id, line: '/no-such-command' })).rejects.toMatchObject({
    remoteCode: 'command-unavailable',
    message: expect.stringContaining('composer'),
  })
  await expect(sessions.interrupt({ sessionId: 'not-a-thread' })).rejects.toMatchObject({ remoteCode: 'session-not-found' })
})

it('lists visible threads newest first, filtered by query, without blank ones', async () => {
  const { agent, sessions } = await fixture()
  expect(await sessions.list({ limit: 1 })).toEqual({
    threads: [{ sessionId: agent.id, cwd: expect.any(String), running: false, updatedAt: 2 }],
    total: 2,
    truncated: true,
  })
  expect((await sessions.list({ query: 'ELSEWHERE' })).threads.map(thread => thread.sessionId)).toEqual(['older-thread'])
})

it('reads the recent user and assistant messages of a thread, oldest first', async () => {
  const { agent, sessions } = await fixture(['First answer.', 'Second answer.'])
  await sessions.prompt({ sessionId: agent.id, text: 'First question' })
  await sessions.wait({ sessionId: agent.id, timeoutMs: 10_000 })
  await sessions.message({ sessionId: agent.id, text: 'Second question', wake: true })
  await sessions.wait({ sessionId: agent.id, timeoutMs: 10_000 })
  const read = await sessions.messages({ sessionId: agent.id, limit: 3 })
  expect(read).toMatchObject({ sessionId: agent.id, running: false, truncated: true })
  expect(read.entries.map(entry => [entry.role, entry.text])).toEqual([
    ['assistant', 'First answer.'],
    ['user', 'Second question'],
    ['assistant', 'Second answer.'],
  ])
  await expect(sessions.messages({ sessionId: 'not-a-thread' })).rejects.toMatchObject({ remoteCode: 'thread-not-found' })
})

it('generates outside any thread, decoding a JSON Schema reply', async () => {
  const { agent, model, sessions } = await fixture(['{"title":"Fix login"}'])
  const result = await sessions.generate({
    prompt: 'Title this',
    jsonSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  })
  expect(result).toMatchObject({ value: { title: 'Fix login' }, provider: 'scripted', model: 'model-a' })
  expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(0)
  expect(model.requests[0]?.tools).toBeUndefined()
})
