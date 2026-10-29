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
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, expect, it } from 'vitest'
import { latestStoppedTurn } from '../../src/interrupted-turn.ts'
import { ApiSessionAgentController } from '../../src/native/agent.ts'
import { SessionCommandController } from '../../src/native/commands.ts'
import { installModelSelectionProjection } from '../../src/native/model-selection-projection.ts'
import { TURN_RETRY_TEXT } from '../../src/turn-retry.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

type Reply = { readonly fail: string } | { readonly text: string }

/** A model whose scripted requests either fail before any output, like a signed-out account, or answer. */
class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly replies: readonly Reply[]) {
    super()
  }
  override async listModels(provider: string) {
    return [{ provider, id: 'model-a', name: 'Model A' }]
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reply = this.replies[this.requests.length] ?? { text: 'Done.' }
    this.requests.push(options)
    if ('fail' in reply) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: reply.fail, code: 'PI_AI_ERROR' } } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply.text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply.text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const fixture = async (replies: readonly Reply[]) => {
  const root = await mkdtemp(join(tmpdir(), 'turn-retry-'))
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
    sessionId: SessionId('failed-thread'),
    meta: { cwd: root },
    agentOptions: { provider: 'scripted', model: 'model-a' },
    setup: (_agentCtx, agent) => void owner.selectionFor(agent),
  })
  cleanups.push(() => handle.dispose())
  const agent = handle.agent
  const commands = new SessionCommandController(ctx, owner, root)
  const ask = async (text: string) => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  const userTexts = (request: GenerateOptions | undefined): string[] =>
    (request?.messages ?? []).flatMap(message => (message.role === 'user' ? message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])) : []))
  return { agent, commands, model, ask, userTexts }
}

it('runs a turn that failed before any reply again, with a notice instead of a continue prompt', async () => {
  const { agent, commands, model, ask, userTexts } = await fixture([{ fail: 'Not logged in · Please run /login' }, { text: 'Hello back.' }])
  await ask('Hello?')
  const stopped = latestStoppedTurn(agent.session.snapshotEvents())
  expect(stopped?.action).toBe('retry')
  if (stopped === undefined) throw new Error('the failed turn is not offered')

  expect(await commands.retryStoppedTurn({ sessionId: agent.id, seq: stopped.seq })).toBe(true)
  expect(await commands.retryStoppedTurn({ sessionId: agent.id, seq: stopped.seq })).toBe(false)
  await agent.whenIdle()

  expect(model.requests).toHaveLength(2)
  expect(userTexts(model.requests[1])).toEqual(['Hello?', TURN_RETRY_TEXT])
  expect(userTexts(model.requests[1]).join('\n')).not.toContain('Continue the interrupted task')
  const events = agent.session.snapshotEvents()
  const sources = events.flatMap(event => (event.type === 'user/message' ? [event.data.source.kind] : []))
  expect(sources).toEqual(['user', 'turn-retry'])
  expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  expect(latestStoppedTurn(events)).toBeUndefined()
})

it('refuses to retry a stale turn or one that already answered, which Resume continues instead', async () => {
  const { agent, commands, ask } = await fixture([{ fail: 'boom' }, { text: 'Answer.' }, { fail: 'boom' }])
  await ask('First')
  const first = latestStoppedTurn(agent.session.snapshotEvents())
  await ask('Second')
  if (first === undefined) throw new Error('the failed turn is not offered')
  expect(await commands.retryStoppedTurn({ sessionId: agent.id, seq: first.seq })).toBe(false)
  await ask('Third')
  expect(latestStoppedTurn(agent.session.snapshotEvents())?.action).toBe('retry')
  expect(await commands.retryStoppedTurn({ sessionId: SessionId('missing-thread'), seq: 1 })).toBe(false)
})
