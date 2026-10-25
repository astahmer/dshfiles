import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { zstdDecompressSync } from 'node:zlib'
import { normalizeContext } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { describe, expect, it } from 'vitest'
import { FastModeService, isCodexFastModeModel, withCodexFastMode } from './codex-fast-mode.js'
import type { FastModeUsageObservation } from './fast-mode-usage-model.js'

const providerId = 'codex-primary'
const sessionId = 'session-fast-mode'
const modelId = 'gpt-6-luna'

const createFastMode = (provider = openaiCodexProvider(), defaultEnabled = false) => {
  const supportedModelIds = new Set(
    provider
      .getModels()
      .filter(isCodexFastModeModel)
      .map(model => model.id),
  )
  return new FastModeService({
    isAvailable: route => route.provider === providerId && supportedModelIds.has(route.model),
    isLiveSession: session => session === sessionId,
    isEnabledByDefault: () => defaultEnabled,
  })
}

const runRequest = async (input: { enabled?: boolean; defaultEnabled?: boolean }): Promise<{ body: unknown; payloadCallbackCalls: number }> => {
  const upstream = openaiCodexProvider()
  const fastMode = createFastMode(upstream, input.defaultEnabled)
  if (input.enabled !== undefined) fastMode.set({ sessionId, provider: providerId, model: modelId, enabled: input.enabled })
  const provider = withCodexFastMode({ upstream, fastMode })
  const catalogModel = provider.getModels().find(model => model.id === modelId)
  if (catalogModel === undefined) throw new Error(`The installed Codex catalog does not include ${modelId}.`)
  const model = { ...catalogModel, provider: providerId }
  const requestBodies: unknown[] = []
  const providerErrors: string[] = []
  let payloadCallbackCalls = 0
  const fetch: typeof globalThis.fetch = async (requestInfo, init) => {
    const request = requestInfo instanceof Request ? requestInfo : new Request(requestInfo, init)
    const bytes = new Uint8Array(await request.clone().arrayBuffer())
    const body = request.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(bytes) : bytes
    requestBodies.push(JSON.parse(new TextDecoder().decode(body)))
    return new Response(JSON.stringify({ error: { message: 'Fast mode request capture complete.' } }), {
      headers: { 'content-type': 'application/json' },
      status: 500,
    })
  }
  const stream: AsyncIterable<StreamChunk> = {
    [Symbol.asyncIterator]: async function* () {
      for await (const event of provider.streamSimple(model, normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }), {
        apiKey: `header.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fast-mode-test-account' } }))}.signature`,
        fetch,
        onPayload: payload => {
          payloadCallbackCalls += 1
          return payload
        },
        transport: 'sse',
      })) {
        if (event.type === 'error') providerErrors.push(event.error.errorMessage ?? 'Unknown Codex provider error.')
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const scoped = fastMode.withRequest({ sessionId, selectedProvider: providerId, wireProvider: providerId, model: modelId }, stream)
  try {
    for await (const _chunk of scoped) {
    }
  } catch {}
  if (requestBodies[0] === undefined) throw new Error(`Codex did not reach the injected fetch: ${providerErrors.join('; ')}`)
  return { body: requestBodies[0], payloadCallbackCalls }
}

describe('Codex Fast mode', () => {
  it('offers Fast only on supported Codex models and exact account routes', () => {
    const fastMode = createFastMode()
    const supportedModelIds = openaiCodexProvider()
      .getModels()
      .filter(isCodexFastModeModel)
      .map(model => model.id)
      .sort()

    expect(supportedModelIds).toEqual(['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol'])
    expect(isCodexFastModeModel({ api: 'openai-codex-responses', id: 'gpt-5.4' })).toBe(false)
    expect(isCodexFastModeModel({ api: 'openai-responses', id: modelId })).toBe(false)
    expect(fastMode.status({ sessionId, provider: providerId, model: modelId })).toEqual({ available: true, enabled: false })
    expect(fastMode.status({ sessionId, provider: 'codex-work', model: modelId })).toEqual({ available: false, enabled: false })
    expect(fastMode.status({ sessionId, provider: providerId, model: 'gpt-5.3-codex-spark' })).toEqual({ available: false, enabled: false })
    expect(() => fastMode.set({ sessionId, provider: providerId, model: 'gpt-5.3-codex-spark', enabled: true })).toThrow(
      'Fast mode is unavailable for this provider/model route.',
    )

    fastMode.set({ sessionId, provider: providerId, model: modelId, enabled: true })
    fastMode.set({ sessionId, provider: providerId, model: 'gpt-6-sol', enabled: true })
    expect(fastMode.status({ sessionId, provider: providerId, model: modelId })).toEqual({ available: true, enabled: true })
    expect(fastMode.status({ sessionId, provider: providerId, model: 'gpt-6-sol' })).toEqual({ available: true, enabled: true })
    fastMode.set({ sessionId, provider: providerId, model: modelId, enabled: false })
    expect(fastMode.status({ sessionId, provider: providerId, model: modelId })).toEqual({ available: true, enabled: false })
    expect(fastMode.status({ sessionId, provider: providerId, model: 'gpt-6-sol' })).toEqual({ available: true, enabled: true })
  })

  it('applies the configured default while preserving per-session route overrides', () => {
    const fastMode = createFastMode(openaiCodexProvider(), true)
    const route = { sessionId, provider: providerId, model: modelId }

    expect(fastMode.status(route)).toEqual({ available: true, enabled: true })
    fastMode.set({ ...route, enabled: false })
    expect(fastMode.status(route)).toEqual({ available: true, enabled: false })
    fastMode.delete(sessionId)
    expect(fastMode.status(route)).toEqual({ available: true, enabled: true })
  })

  it('isolates Fast mode preferences by live Session and clears disposed state', () => {
    const provider = openaiCodexProvider()
    const supportedModelIds = new Set(
      provider
        .getModels()
        .filter(isCodexFastModeModel)
        .map(model => model.id),
    )
    const fastMode = new FastModeService({
      isAvailable: route => route.provider === providerId && supportedModelIds.has(route.model),
      isLiveSession: () => true,
      isEnabledByDefault: () => false,
    })
    const route = { provider: providerId, model: modelId }

    fastMode.set({ ...route, sessionId: 'session-a', enabled: true })
    expect(fastMode.status({ ...route, sessionId: 'session-a' })).toEqual({ available: true, enabled: true })
    expect(fastMode.status({ ...route, sessionId: 'session-b' })).toEqual({ available: true, enabled: false })

    fastMode.delete('session-a')
    expect(fastMode.status({ ...route, sessionId: 'session-a' })).toEqual({ available: true, enabled: false })
  })

  it('uses the legacy priority tier when Fast mode is enabled per thread or by default', async () => {
    const fast = await runRequest({ enabled: true })
    expect(fast.body).toMatchObject({ service_tier: 'priority' })
    expect(fast.payloadCallbackCalls).toBe(1)

    const fastByDefault = await runRequest({ defaultEnabled: true })
    expect(fastByDefault.body).toMatchObject({ service_tier: 'priority' })

    const defaultTier = await runRequest({ enabled: false, defaultEnabled: true })
    expect(defaultTier.body).not.toHaveProperty('service_tier')
    expect(defaultTier.payloadCallbackCalls).toBe(1)
  })

  it('records only provider-reported tier and token usage for Fast-mode responses', async () => {
    const upstream = openaiCodexProvider()
    const catalogModel = upstream.getModels().find(model => model.id === modelId)
    if (catalogModel === undefined) throw new Error(`The installed Codex catalog does not include ${modelId}.`)
    const model = { ...catalogModel, provider: providerId }
    const recorded: FastModeUsageObservation[] = []
    const fastMode = new FastModeService({
      isAvailable: route => route.provider === providerId && isCodexFastModeModel(model),
      isLiveSession: session => session === sessionId,
      isEnabledByDefault: () => false,
      recordUsage: async observation => {
        recorded.push(observation)
      },
    })
    fastMode.set({ sessionId, provider: providerId, model: modelId, enabled: true })
    const provider = withCodexFastMode({ upstream, fastMode })
    const event = {
      type: 'response.completed',
      response: {
        id: 'resp_fast_mode_test',
        object: 'response',
        created_at: 1_700_000_000,
        status: 'completed',
        model: modelId,
        service_tier: 'priority',
        usage: { input_tokens: 19, output_tokens: 7, total_tokens: 26, input_tokens_details: { cached_tokens: 5 } },
        output: [
          {
            id: 'msg_fast_mode_test',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'ok', annotations: [] }],
          },
        ],
      },
    }
    const fetch: typeof globalThis.fetch = async () => new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    const stream: AsyncIterable<StreamChunk> = {
      [Symbol.asyncIterator]: async function* () {
        for await (const chunk of provider.streamSimple(model, normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }), {
          apiKey: `header.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fast-mode-test-account' } }))}.signature`,
          fetch,
          transport: 'sse',
        })) {
          if (chunk.type === 'error') throw new Error(chunk.error.errorMessage ?? 'Codex stream failed.')
        }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }

    for await (const _chunk of fastMode.withRequest({ sessionId, selectedProvider: providerId, wireProvider: providerId, model: modelId }, stream)) {
    }

    expect(recorded).toEqual([
      {
        instanceId: providerId,
        model: modelId,
        serviceTier: 'priority',
        responseStatus: 'completed',
        inputTokens: 19,
        outputTokens: 7,
        cacheReadTokens: 5,
      },
    ])
  })
})
