import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { LlmAdapter, LlmRuntime, createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, expect, it } from 'vitest'
import { ApiSessionAgentController } from '../../src/native/agent.ts'
import { SessionHistoryController } from '../../src/native/history.ts'
import { ApiSessionList } from '../../src/native/list.ts'
import { installModelSelectionProjection } from '../../src/native/model-selection-projection.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const IDLE_PAST_THRESHOLD_MS = 5 * 60_000 + 1

/** Answers every request, holding the reply while `gate` is pending so a turn stays running. */
class GatedModel extends LlmAdapter {
  gate: Promise<void> = Promise.resolve()
  override async listModels(provider: string) {
    return [{ provider, id: 'model-a', name: 'Model A' }]
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(): AsyncIterable<StreamChunk> {
    await this.gate
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Done.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** The engine's exact observation over the real store and persistence; this suite never searches. */
class ExactSessionQuery extends SessionQueryEngine {
  override searchSessions(): never {
    throw new Error('not searched here')
  }
  override searchEvents(): never {
    throw new Error('not searched here')
  }
}

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'idle-agent-eviction-'))
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
  await ctx.plugin(ExactSessionQuery)
  await ctx.plugin(AgentDefaultModel, { provider: 'scripted', model: 'model-a' })
  await ctx.plugin(AgentLoop)
  installModelSelectionProjection(ctx)
  const model = new GatedModel()
  ctx.llm.registerAdapter(['scripted'], model)
  const owner = new ApiSessionAgentController(ctx)
  const history = new SessionHistoryController(ctx, () => undefined)
  const list = new ApiSessionList(ctx, 8)
  const { agent } = await owner.createSession({ cwd: root, reusable: () => false })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Hello?' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const disposedWhileEvicting: boolean[] = []
  ctx.on('session/disposed', (session) => {
    disposedWhileEvicting.push(owner.isEvicting(session.id))
  })
  const sweep = (afterMs = IDLE_PAST_THRESHOLD_MS) => owner.evictIdleAgents({
    isFollowed: sessionId => history.isFollowed(sessionId),
    now: Date.now() + afterMs,
  })
  return { ctx, model, owner, history, list, agent, sweep, disposedWhileEvicting }
}

const transcript = (events: ReadonlyArray<{ readonly seq: number; readonly type: string; readonly data: unknown }>) =>
  events.map(event => ({ seq: event.seq, type: event.type, data: event.data }))

it('disposes an Agent idle past the threshold and keeps one that is not', async () => {
  const { ctx, agent, sweep } = await fixture()
  await expect(sweep(60_000)).resolves.toBe(0)
  expect(ctx.agents.get(agent.id)).toBe(agent)

  await expect(sweep()).resolves.toBe(1)
  expect(ctx.agents.get(agent.id)).toBeUndefined()
  expect(ctx.sessions.get(agent.id)).toBeUndefined()
})

it('keeps an Agent inside a turn, which is where an approval or a question waits', async () => {
  const { ctx, model, agent, sweep } = await fixture()
  const reply = Promise.withResolvers<void>()
  model.gate = reply.promise
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Again' }], source: { kind: 'user' } }))
  await expect.poll(() => agent.status).toBe('running')

  await expect(sweep()).resolves.toBe(0)
  expect(ctx.agents.get(agent.id)).toBe(agent)
  reply.resolve()
  await agent.whenIdle()
})

it('keeps an Agent while a command holds it', async () => {
  const { ctx, owner, agent, sweep } = await fixture()
  const command = Promise.withResolvers<void>()
  const held = owner.hold(agent.id, () => command.promise)

  await expect(sweep()).resolves.toBe(0)
  expect(ctx.agents.get(agent.id)).toBe(agent)
  command.resolve()
  await held
})

it('keeps an Agent while its history is followed', async () => {
  const { ctx, history, agent, sweep } = await fixture()
  const following = new AbortController()
  const frames = history.follow({ address: { kind: 'session', sessionId: agent.id } }, following.signal)[Symbol.asyncIterator]()
  await expect(frames.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
  const next = frames.next()

  await expect(sweep()).resolves.toBe(0)
  expect(ctx.agents.get(agent.id)).toBe(agent)

  following.abort()
  await next
  await expect(sweep()).resolves.toBe(1)
})

it('keeps an evicted thread listed as a stored Session and reopens it with the same history', async () => {
  const { ctx, owner, list, agent, sweep, disposedWhileEvicting } = await fixture()
  const before = transcript(agent.session.snapshotEvents())
  expect(before.some(event => event.type === 'assistant/message')).toBe(true)
  await list.list()

  await sweep()
  expect(disposedWhileEvicting).toEqual([true])
  const rows = await list.list()
  expect(rows.find(row => row.sessionId === agent.id)).toMatchObject({ agentAvailable: false, running: false, blank: false })

  const reopened = await owner.resolveAgent(agent.id as SessionId)
  if ('error' in reopened) throw reopened.error
  expect(reopened.agent).not.toBe(agent)
  expect(ctx.agents.get(agent.id)).toBe(reopened.agent)
  const after = transcript(reopened.agent.session.snapshotEvents())
  expect(after.slice(0, before.length)).toEqual(before)
  expect(after.slice(before.length).map(event => event.type)).toEqual(['session/end-seed'])
})
