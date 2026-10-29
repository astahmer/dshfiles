import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { generate } from '../src/host/generate.js'

/** Answers each call with the next scripted reply, or fails with the scripted failure code. */
class ScriptedAdapter extends LlmAdapter {
  readonly calls: GenerateOptions[] = []
  constructor(private readonly replies: readonly (string | { readonly failure: string })[]) {
    super()
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reply = this.replies[this.calls.length] ?? ''
    this.calls.push(options)
    if (typeof reply !== 'string') {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: reply.failure, message: reply.failure } } } as StreamChunk
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const host = async (replies: readonly (string | { readonly failure: string })[]) => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const adapter = new ScriptedAdapter(replies)
  ctx.llm.registerAdapter(['scripted'], adapter)
  return { ctx, adapter }
}

const model = { provider: 'scripted', model: 'scripted-1' }

describe('generate', () => {
  it('returns the text of one side call with the system prompt it was given', async () => {
    const { ctx, adapter } = await host(['  hello  '])
    const result = await generate(ctx, { prompt: 'Say hello', system: 'Be brief.', model })
    expect(result).toMatchObject({ text: 'hello', value: 'hello', provider: 'scripted', model: 'scripted-1' })
    expect(adapter.calls[0]).toMatchObject({ system: 'Be brief.', purpose: 'compaction' })
    expect(adapter.calls[0]?.tools).toBeUndefined()
  })

  it('decodes a schema reply, asking once again with the issues when the first does not match', async () => {
    const { ctx, adapter } = await host(['{"title": 3}', '```json\n{"title": "Fix login"}\n```'])
    const result = await generate(ctx, { prompt: 'Title this', model, schema: z.object({ title: z.string() }) })
    expect(result.value).toEqual({ title: 'Fix login' })
    expect(adapter.calls[0]?.system).toContain('"title"')
    const correction = adapter.calls[1]?.messages.at(-1)?.content[0]
    expect(correction?.type === 'text' ? correction.text : '').toContain('title')
  })

  it('fails with the issues after one correction', async () => {
    const { ctx } = await host(['nope', 'still nope'])
    await expect(generate(ctx, { prompt: 'x', model, schema: z.number() })).rejects.toMatchObject({ code: 'generate-invalid-output' })
  })

  it('drops a reasoning effort the model refuses, and reports other failures', async () => {
    // The runtime itself refuses an effort the scripted model does not declare.
    const { ctx, adapter } = await host(['ok'])
    expect((await generate(ctx, { prompt: 'x', model: { ...model, reasoningEffort: 'high' } })).text).toBe('ok')
    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]?.reasoningEffort).toBeUndefined()
    const failing = await host([{ failure: 'RATE_LIMITED' }])
    await expect(generate(failing.ctx, { prompt: 'x', model })).rejects.toMatchObject({ code: 'generate-failed' })
  })

  it('needs a model or a Host default', async () => {
    const { ctx } = await host([])
    await expect(generate(ctx, { prompt: 'x' })).rejects.toMatchObject({ code: 'model-unavailable' })
    await expect(generate(new Context(), { prompt: 'x', model })).rejects.toMatchObject({ code: 'llm-unavailable' })
  })
})
