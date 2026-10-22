import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { zstdDecompressSync } from 'node:zlib'
import { normalizeContext } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { describe, expect, it } from 'vitest'
import { FastModeService, isCodexFastModeModel, withCodexFastMode } from './codex-fast-mode.js'

const providerId = 'codex-primary'
const sessionId = 'session-fast-mode'
const modelId = 'gpt-6-luna'

const createFastMode = (provider = openaiCodexProvider()) => {
  const supportedModelIds = new Set(
    provider
      .getModels()
      .filter(isCodexFastModeModel)
      .map(model => model.id),
  )
  return new FastModeService({
    isAvailable: route => route.provider === providerId && supportedModelIds.has(route.model),
    isLiveSession: session => session === sessionId,
  })
}

const runRequest = async (input: { enabled: boolean }): Promise<{ body: unknown; payloadCallbackCalls: number }> => {
  const upstream = openaiCodexProvider()
  const fastMode = createFastMode(upstream)
  fastMode.set({ sessionId, provider: providerId, model: modelId, enabled: input.enabled })
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
    })
    const route = { provider: providerId, model: modelId }

    fastMode.set({ ...route, sessionId: 'session-a', enabled: true })
    expect(fastMode.status({ ...route, sessionId: 'session-a' })).toEqual({ available: true, enabled: true })
    expect(fastMode.status({ ...route, sessionId: 'session-b' })).toEqual({ available: true, enabled: false })

    fastMode.delete('session-a')
    expect(fastMode.status({ ...route, sessionId: 'session-a' })).toEqual({ available: true, enabled: false })
  })

  it('adds service_tier fast to the actual Codex request only while enabled', async () => {
    const fast = await runRequest({ enabled: true })
    expect(fast.body).toMatchObject({ service_tier: 'fast' })
    expect(fast.payloadCallbackCalls).toBe(1)

    const defaultTier = await runRequest({ enabled: false })
    expect(defaultTier.body).not.toHaveProperty('service_tier')
    expect(defaultTier.payloadCallbackCalls).toBe(1)
  })
})
