import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { LlmAdapter, LlmRuntime, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { defineHost, type HostHooks } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterEach, expect, it } from 'vitest'

/**
 * dshx `defineHost({ hooks })` at the agent-loop middleware points (pre-step, request, request-error), against the
 * real loop. It lives here because this package's tests already compose a real Agent; dshx carries no agent loop.
 */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Fails the requests listed in `failing` (by index) with a non-retryable failure, answers the others. */
class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly failing: ReadonlySet<number> = new Set()) {
    super()
  }
  override async listModels(provider: string) {
    return [{ provider, id: 'model-a', name: 'Model A' }]
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const index = this.requests.length
    this.requests.push(options)
    if (this.failing.has(index)) {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', message: 'scripted failure' } } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Done.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Done.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const runTurn = async (hooks: HostHooks, model: ScriptedModel, text: string) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-hooks-'))
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
  ctx.llm.registerAdapter(['scripted'], model)
  await host.mount(defineHost({ hooks }), { packageId: '@acme/hooks' })
  const handle = await ctx.agents.create({ sessionId: SessionId('hooked'), meta: { cwd: root }, agentOptions: { provider: 'scripted', model: 'model-a' } })
  cleanups.push(() => handle.dispose())
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await handle.agent.whenIdle()
  return handle.agent
}

const lastUserText = (options: GenerateOptions | undefined): string => {
  const block = options?.messages.findLast(message => message.role === 'user')?.content[0]
  return block?.type === 'text' ? block.text : ''
}

it('rewrites the admitted prompt and the request controls of each agent request', async () => {
  const model = new ScriptedModel()
  await runTurn(
    {
      promptAdmission: ({ messages }) => ({
        messages: messages.map(message => ({
          ...message,
          content: message.content.map(block => (block.type === 'text' ? { ...block, text: block.text.toUpperCase() } : block)),
        })),
      }),
      request: () => ({ maxTokens: 321 }),
    },
    model,
    'make it loud',
  )
  expect(model.requests).toHaveLength(1)
  expect(lastUserText(model.requests[0])).toBe('MAKE IT LOUD')
  expect(model.requests[0]?.maxTokens).toBe(321)
})

it('holds a step the admission hook rejects, so no request is made', async () => {
  const model = new ScriptedModel()
  await runTurn({ promptAdmission: () => 'reject' }, model, 'never sent')
  expect(model.requests).toHaveLength(0)
})

it('retries a failed request the retry hook asks for', async () => {
  const model = new ScriptedModel(new Set([0]))
  const seen: string[] = []
  await runTurn(
    {
      retry: ({ failure }) => {
        seen.push(failure.code)
        return 'retry'
      },
    },
    model,
    'try twice',
  )
  expect(seen).toEqual(['INVALID_REQUEST'])
  expect(model.requests).toHaveLength(2)
})
