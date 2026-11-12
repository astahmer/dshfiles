import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import {
  createUserMessage,
  LlmAdapter,
  LlmRuntime,
  type ContentBlock,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import plugin from '../src/host.js'

const WINDOW = 20_000

const textChunks = (text: string): readonly StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } },
]

/** Answers every turn with "ok" and every compaction with a short summary, behind a gate the test controls. */
class ScriptedAdapter extends LlmAdapter {
  readonly compactions: GenerateOptions[] = []
  agentRequests = 0
  overflowsLeft = 0
  pricedImages = false
  override imageRequestPricing() {
    return this.pricedImages ? { priceImages: (images: readonly ContentBlock[]) => images.map(() => ({ visualTokens: 100, text: '' })) } : undefined
  }
  private release: (() => void) | undefined
  private gate: Promise<void> = Promise.resolve()

  holdCompactions() {
    this.gate = new Promise(resolve => {
      this.release = resolve
    })
  }

  releaseCompactions() {
    this.release?.()
  }

  private readonly pending = new Set<Promise<void>>()

  /** Resolves once no compaction request is in flight, including chunk requests that start after another ends. */
  async settled() {
    while (this.pending.size > 0) {
      await Promise.all(this.pending)
      await new Promise(resolve => setImmediate(resolve))
    }
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: WINDOW }, defaultMaxTokens: 1_000 })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'compaction') {
      this.compactions.push(options)
      let done = () => {}
      const finished = new Promise<void>(resolve => {
        done = resolve
      })
      this.pending.add(finished)
      try {
        await this.gate
        yield* textChunks('Summary: the user sent long notes.')
      } finally {
        this.pending.delete(finished)
        done()
      }
      return
    }
    this.agentRequests += 1
    if (this.overflowsLeft > 0) {
      this.overflowsLeft -= 1
      // Anthropic's wording, delivered without the core CONTEXT_WINDOW_EXCEEDED code.
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'PROVIDER_ERROR', status: 400, message: 'prompt is too long: 213000 tokens > 200000 maximum' } },
      }
      return
    }
    yield* textChunks('ok')
  }
}

/** The profile-row fields these journeys set; the Host fills every other field with its default. */
interface CompactionRowConfig {
  readonly backgroundSummary?: { readonly enabled: boolean; readonly startRatio: number }
}

const withAgent = async (
  config: CompactionRowConfig,
  run: (input: {
    readonly adapter: ScriptedAdapter
    readonly send: (text: string, image?: boolean) => Promise<void>
    readonly summaries: () => number
    /** Compactions that started and ended with an error instead of a checkpoint. */
    readonly failedCompactions: () => number
    /** Adds one tool whose description alone is this many bytes, to every request of the thread; returns its removal. */
    readonly addLargeTool: (bytes: number) => () => void
    /** The `/compact` command's engine call: the whole history up to the newest exchange. */
    readonly compactNow: () => Promise<void>
    readonly imageEvents: () => number
  }) => Promise<void>,
) => {
  const host = await createTestHost()
  try {
    await host.ctx.plugin(SessionProjectionRegistry)
    await host.ctx.plugin(SessionStore)
    // The test host already provides the system prompt and tool runtime.
    await host.ctx.plugin(LlmRuntime)
    await host.ctx.plugin(AgentRegistry)
    await host.ctx.plugin(TokenMeter)
    await host.ctx.plugin(AgentLoop)
    const mounted = await host.mount(plugin, { packageId: '@dshfiles/context-compaction', config: { maxTokens: 1_000, ...config } })
    const adapter = new ScriptedAdapter()
    host.ctx.llm.registerAdapter(['scripted'], adapter)
    const sessionId = SessionId('compaction-integration')
    const handle = await host.ctx.agents.create({ sessionId, agentOptions: { provider: 'scripted', model: 'small-window' } })
    try {
      const session = () => {
        const live = host.ctx.sessions.get(sessionId)
        if (live === undefined) throw new Error('the Session was not published')
        return live
      }
      await run({
        adapter,
        send: async (text, image) => {
          await handle.agent.followup(
            createUserMessage({
              content: [
                { type: 'text', text },
                ...(image
                  ? [
                      {
                        type: 'image',
                        attachment: { attachmentId: 'image-1', mediaType: 'image/png', name: 'shot.png', bytes: 1, width: 1, height: 1 },
                      } as ContentBlock,
                    ]
                  : []),
              ],
              source: { kind: 'user' },
            }),
          )
          await handle.agent.whenIdle()
        },
        summaries: () =>
          session()
            .snapshotEvents()
            .filter(event => event.type === 'compaction/summary').length,
        failedCompactions: () =>
          session()
            .snapshotEvents()
            .filter(event => event.type === 'compaction/end' && 'error' in event.data && event.data.error !== undefined).length,
        addLargeTool: bytes =>
          host.tools.register({
            name: 'large_catalog_entry',
            description: 'x'.repeat(bytes),
            parameters: { type: 'object', properties: {} },
            output: { schema: { type: 'string' }, render: () => [] },
            execute: () => Promise.resolve(''),
          }),
        compactNow: async () => {
          await host.ctx.compaction.compactNow(handle.agent, new AbortController().signal)
        },
        imageEvents: () =>
          session()
            .snapshotEvents()
            .filter(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'image')).length,
      })
    } finally {
      await handle.dispose()
      await mounted.dispose()
    }
  } finally {
    await host.dispose()
  }
}

const note = (index: number) => `Note ${String(index)}: ${'long project detail '.repeat(300)}`

describe('the compaction engine in a real agent loop', () => {
  it('summarizes images without image pricing while preserving live history', async () => {
    await withAgent({}, async ({ adapter, send, summaries, compactNow, imageEvents }) => {
      await send(note(0), true)
      await send('Another message')
      await compactNow()
      expect(summaries()).toBe(1)
      const messages = adapter.compactions.flatMap(request => request.messages)
      expect(JSON.stringify(messages)).toContain('[image: shot.png, omitted from summary]')
      expect(messages.flatMap(message => message.content).some(block => block.type === 'image')).toBe(false)
      expect(imageEvents()).toBe(1)
      await send('Continue')
    })
  })

  it('keeps images in requests to routes with image pricing', async () => {
    await withAgent({}, async ({ adapter, send, compactNow }) => {
      adapter.pricedImages = true
      await send(note(0), true)
      await send('Another message')
      await compactNow()
      expect(
        adapter.compactions
          .flatMap(request => request.messages)
          .flatMap(message => message.content)
          .some(block => block.type === 'image'),
      ).toBe(true)
    })
  })

  it('recovers overflow with images on an unpriced route', async () => {
    await withAgent({}, async ({ adapter, send, summaries }) => {
      await send(note(0), true)
      await send(note(1))
      adapter.overflowsLeft = 1
      await send('Continue')
      expect(summaries()).toBe(1)
      expect(JSON.stringify(adapter.compactions)).toContain('[image: shot.png, omitted from summary]')
    })
  })

  it('compacts a route whose headroom buffer leaves no room', async () => {
    await withAgent({}, async ({ send, summaries }) => {
      for (let index = 0; index < 16 && summaries() === 0; index += 1) await send(note(index))
      expect(summaries()).toBe(1)
    })
  })

  it('applies a summary prepared in the background without a compaction request at the threshold', async () => {
    using recorder = recordSpans()
    await withAgent({ backgroundSummary: { enabled: true, startRatio: 0.5 } }, async ({ adapter, send, summaries }) => {
      adapter.holdCompactions()
      let index = 0
      while (adapter.compactions.length === 0 && index < 16) {
        await send(note(index))
        index += 1
      }
      // The turn that started the background summary finished while that summary was still held.
      expect(adapter.compactions.length).toBeGreaterThan(0)
      expect(summaries()).toBe(0)
      adapter.releaseCompactions()
      await adapter.settled()
      const prepared = adapter.compactions.length
      while (summaries() === 0 && index < 32) {
        await send(note(index))
        index += 1
      }
      expect(summaries()).toBe(1)
      // The pressure compaction reused the prepared summary instead of asking again: any later request is already the
      // next background summary, built on the committed checkpoint.
      const later = adapter.compactions.slice(prepared).map(request => JSON.stringify(request.messages))
      expect(later.every(messages => messages.includes('<compacted-summary>'))).toBe(true)
    })
    const prepared = recorder.named('context compaction background summary').filter(span => span.attributes['due'] === true)
    expect(prepared.length).toBeGreaterThan(0)
    expect(prepared[0]?.attributes).toMatchObject({ sessionId: 'compaction-integration', messages: expect.any(Number) })
  })

  it('never applies a prepared summary to a span it did not summarize', async () => {
    await withAgent({ backgroundSummary: { enabled: true, startRatio: 0.5 } }, async ({ adapter, send, summaries, compactNow }) => {
      for (let index = 0; adapter.compactions.length === 0 && index < 16; index += 1) await send(note(index))
      await adapter.settled()
      const prepared = adapter.compactions.length
      expect(prepared).toBeGreaterThan(0)
      // The manual compaction covers the whole history, a larger span than the one prepared.
      await compactNow()
      expect(summaries()).toBe(1)
      expect(adapter.compactions.length).toBeGreaterThan(prepared)
    })
  })

  it('does not retry, on every step, a compaction whose summary request can never fit', async () => {
    await withAgent({}, async ({ send, summaries, failedCompactions, addLargeTool }) => {
      // The tool catalog alone exceeds the summary request budget of the 20,000-token window, as 365 tools did on a
      // real thread: every pressure compaction fails before any model request.
      const removeLargeTool = addLargeTool(40_000)
      for (let index = 0; index < 8; index += 1) await send(note(index))
      expect(summaries()).toBe(0)
      expect(failedCompactions()).toBe(1)
      // A smaller tool catalog can fit: once a request carries it, the next step tries again.
      removeLargeTool()
      for (let index = 8; index < 24 && summaries() === 0; index += 1) await send(note(index))
      expect(summaries()).toBe(1)
      expect(failedCompactions()).toBe(1)
    })
  })

  it('recovers from a provider overflow the core does not code as CONTEXT_WINDOW_EXCEEDED', async () => {
    await withAgent({}, async ({ adapter, send, summaries }) => {
      for (let index = 0; index < 3; index += 1) await send(note(index))
      adapter.overflowsLeft = 1
      const before = adapter.agentRequests
      await send('One more question.')
      expect(summaries()).toBe(1)
      // The failed request, then its retry after the overflow compaction.
      expect(adapter.agentRequests - before).toBe(2)
    })
  })
})
