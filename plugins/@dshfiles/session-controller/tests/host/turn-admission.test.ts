import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import { LlmAdapter, LlmRuntime, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
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
import { ApiSessionAgentController } from '../../src/native/agent.ts'
import { SessionCommandController } from '../../src/native/commands.ts'
import { installTurnAdmission } from '../../src/native/turn-admission-ports.ts'
import type { TurnAdmissionSnapshot } from '../../src/turn-admission.ts'
import type { SessionRequestId } from '../../src/native/types.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** A model whose every request waits for the test to finish it, so a thread stays running on demand. */
class GatedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly gates: Array<() => void> = []
  override async listModels(provider: string) {
    return [{ provider, id: 'model-a', name: 'Model A' }]
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  finishNext(): void {
    this.gates.shift()?.()
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    await new Promise<void>(resolve => this.gates.push(resolve))
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Done.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'turn-admission-'))
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
  await ctx.plugin(AgentDefaultModel, { provider: 'gated', model: 'model-a' })
  await ctx.plugin(AgentLoop)
  // Text-only prompts carry no attachment or upload receipt; these stand in for the storage-backed services.
  ctx.provide('attachments')
  ctx.provide('fileUploads')
  ctx.set('attachments', { admitPromptContent: async (content: Parameters<typeof ctx.attachments.admitPromptContent>[0]) => content })
  ctx.set('fileUploads', { bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }), resolve: () => undefined })
  const model = new GatedModel()
  ctx.llm.registerAdapter(['gated'], model)
  const owner = new ApiSessionAgentController(ctx)
  const thread = async (id: string) => {
    const handle = await ctx.agents.create({
      sessionId: SessionId(id),
      meta: { cwd: root },
      agentOptions: { provider: 'gated', model: 'model-a' },
      setup: agentCtx => {
        installModelSelection(agentCtx)
      },
    })
    cleanups.push(async () => {
      model.finishNext()
      model.finishNext()
      await handle.dispose()
    })
    return handle.agent
  }
  const announced: TurnAdmissionSnapshot[] = []
  const admission = installTurnAdmission(ctx, snapshot => announced.push(snapshot))
  const commands = new SessionCommandController(ctx, owner, root, admission)
  let requestCount = 0
  const prompt = (sessionId: string, text: string) =>
    commands.prompt(
      {
        requestId: brandString<SessionRequestId>(`request-${String(++requestCount)}`),
        sessionId: SessionId(sessionId),
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
      { kind: 'user' },
    )
  return { model, thread, admission, prompt, announced }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

it('holds a second thread while one runs under a limit of one, then starts it when the first turn ends', async () => {
  const { model, thread, admission, prompt } = await fixture()
  const first = await thread('thread-a')
  const second = await thread('thread-b')
  admission.configure({ maxRunningThreads: 1, countSubagents: false })

  await prompt('thread-a', 'First')
  await settle()
  expect(first.status).toBe('running')

  await prompt('thread-b', 'Second')
  await settle()
  expect(second.status).toBe('idle')
  expect(second.inbox.nextTurn).toHaveLength(1)
  expect(admission.snapshot().waiting).toEqual([expect.objectContaining({ sessionId: 'thread-b', ahead: 0 })])
  expect(model.requests).toHaveLength(1)

  model.finishNext()
  await first.whenIdle()
  await settle()
  expect(second.status).toBe('running')
  expect(second.inbox.nextTurn).toHaveLength(0)
  expect(admission.snapshot().waiting).toEqual([])
  expect(model.requests).toHaveLength(2)
})

it('announces each change a waiting-turn dock shows, so it needs no poll', async () => {
  const { model, thread, admission, prompt, announced } = await fixture()
  const first = await thread('thread-a')
  await thread('thread-b')
  admission.configure({ maxRunningThreads: 1, countSubagents: false })
  await prompt('thread-a', 'First')
  await settle()
  const beforeHold = announced.length

  await prompt('thread-b', 'Second')
  await settle()
  expect(announced.slice(beforeHold).at(-1)?.waiting).toEqual([expect.objectContaining({ sessionId: 'thread-b' })])

  model.finishNext()
  await first.whenIdle()
  await settle()
  expect(announced.at(-1)?.waiting).toEqual([])
})

it('starts a waiting thread at once when the user forces it, past the limit', async () => {
  const { thread, admission, prompt } = await fixture()
  const first = await thread('thread-a')
  const second = await thread('thread-b')
  admission.configure({ maxRunningThreads: 1, countSubagents: false })
  await prompt('thread-a', 'First')
  await settle()
  await prompt('thread-b', 'Second')
  await settle()
  expect(second.status).toBe('idle')

  expect(admission.forceStart('thread-b')).toBe(1)
  await settle()
  expect(first.status).toBe('running')
  expect(second.status).toBe('running')
})

it('keeps the native behaviour without a limit', async () => {
  const { thread, prompt } = await fixture()
  const first = await thread('thread-a')
  const second = await thread('thread-b')
  await prompt('thread-a', 'First')
  await prompt('thread-b', 'Second')
  await settle()
  expect(first.status).toBe('running')
  expect(second.status).toBe('running')
})
