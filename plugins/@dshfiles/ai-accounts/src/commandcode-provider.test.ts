import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CommandCodeConfigError, createCommandCodeProvider, fetchCommandCodeCatalog } from './commandcode-provider.js'

const received: IncomingHttpHeaders[] = []
type CatalogPayload = { readonly data: readonly { readonly id: string | number }[] }
let catalogPayload: CatalogPayload = { data: [{ id: 'anthropic/claude-test' }, { id: 'openai/gpt-test' }] }
const server = createServer((request, response) => {
  received.push(request.headers)
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(catalogPayload))
})
let baseUrl = ''

beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address: AddressInfo | string | null = server.address()
  if (address === null || typeof address === 'string') throw new Error('Test server has no port.')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

describe('fetchCommandCodeCatalog', () => {
  it('sends the key value as the bearer token', async () => {
    const entries = await fetchCommandCodeCatalog({ baseUrl, apiKey: 'typed-key' })
    expect(received.at(-1)?.authorization).toBe('Bearer typed-key')
    expect(entries).toEqual([
      { id: 'anthropic/claude-test', api: 'anthropic-messages' },
      { id: 'openai/gpt-test', api: 'openai-completions' },
    ])
  })

  it('preserves the live Command Code model id without an OpenAI namespace prefix', async () => {
    catalogPayload = { data: [{ id: 'gpt-6-luna' }] }
    try {
      const entries = await fetchCommandCodeCatalog({ baseUrl, apiKey: 'typed-key' })
      expect(entries).toContainEqual({ id: 'gpt-6-luna', api: 'openai-completions' })
    } finally {
      catalogPayload = { data: [{ id: 'anthropic/claude-test' }, { id: 'openai/gpt-test' }] }
    }
  })

  it('keeps the verified GPT-6 Luna id in the no-key fallback', async () => {
    const entries = await fetchCommandCodeCatalog({ baseUrl, apiKey: '' })
    expect(entries).toContainEqual({ id: 'gpt-6-luna', api: 'openai-completions' })
  })

  it('uses the fallback catalog when the response shape is invalid', async () => {
    catalogPayload = { data: [{ id: 42 }] }
    try {
      const entries = await fetchCommandCodeCatalog({ baseUrl, apiKey: 'typed-key' })
      expect(entries).toContainEqual({ id: 'openai/gpt-5.1', api: 'openai-completions' })
    } finally {
      catalogPayload = { data: [{ id: 'anthropic/claude-test' }, { id: 'openai/gpt-test' }] }
    }
  })

  it('refuses a base outside Command Code before any request', async () => {
    const before = received.length
    await expect(fetchCommandCodeCatalog({ baseUrl: 'https://attacker.example', apiKey: 'typed-key' })).rejects.toThrow(CommandCodeConfigError)
    expect(received.length).toBe(before)
  })
})

describe('createCommandCodeProvider', () => {
  it('refuses a key variable not named as an API key', () => {
    expect(() => createCommandCodeProvider({ keyEnv: 'AWS_SECRET_ACCESS_KEY' })).toThrow(CommandCodeConfigError)
  })
})

describe('Command Code request shape', () => {
  interface Captured {
    readonly url: string
    readonly authorization: string | null
    readonly body: { readonly model?: unknown; readonly stream?: unknown; readonly messages?: unknown }
  }

  const SSE_ANSWER = [
    'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-6-luna","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
    'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')

  const drive = async (input: { readonly modelId: string; readonly respond: () => Response }) => {
    const captured: Captured[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (resource: string | URL | Request, init?: RequestInit) => {
      const request = new Request(resource, init)
      captured.push({ url: request.url, authorization: request.headers.get('authorization'), body: JSON.parse(await request.text()) })
      return input.respond()
    }
    try {
      const provider = createCommandCodeProvider()
      const model = provider.getModels().find(candidate => candidate.id === input.modelId)
      if (model === undefined) throw new Error(`No fallback model ${input.modelId}.`)
      const stream = provider.streamSimple(model, { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 }] } as never, {
        apiKey: 'test-key',
      })
      for await (const _event of stream) {
        // drain
      }
      return { captured, settled: await stream.result() }
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  it('posts chat completions under /provider/v1 with the bearer key and the bare model id', async () => {
    const { captured, settled } = await drive({
      modelId: 'gpt-6-luna',
      respond: () => new Response(SSE_ANSWER, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    })
    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe('https://api.commandcode.ai/provider/v1/chat/completions')
    expect(captured[0]?.authorization).toBe('Bearer test-key')
    expect(captured[0]?.body.model).toBe('gpt-6-luna')
    expect(captured[0]?.body.stream).toBe(true)
    expect(Array.isArray(captured[0]?.body.messages)).toBe(true)
    expect(settled.stopReason).toBe('stop')
  })

  it('posts a Messages-only model to /provider/v1/messages', async () => {
    const { captured } = await drive({
      modelId: 'anthropic/claude-sonnet-4-5',
      respond: () => new Response('{}', { status: 500 }),
    })
    expect(new URL(captured[0]?.url ?? '').pathname).toBe('/provider/v1/messages')
    expect(captured[0]?.body.model).toBe('anthropic/claude-sonnet-4-5')
  })

  it('tells a Go plan what to run instead of a bare 403', async () => {
    const { settled } = await drive({
      modelId: 'gpt-6-luna',
      respond: () =>
        new Response(
          JSON.stringify({
            error: { message: "Your Go plan doesn't include API access.", type: 'permission_error', code: 'upgrade_required' },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    })
    expect(settled.stopReason).toBe('error')
    expect(settled.errorMessage).toContain('403')
    expect(settled.errorMessage).toContain('nixapply')
  })
})

describe('Command Code key resolution', () => {
  it('falls back to the CLI login when neither a credential nor the variable holds a key', async () => {
    const provider = createCommandCodeProvider({ readFallbackKey: async () => 'cli-key' })
    const resolved = await provider.auth?.apiKey?.resolve({ signal: new AbortController().signal, ctx: { env: async () => undefined } } as never)
    expect(resolved).toEqual({ auth: { apiKey: 'cli-key' }, source: 'Command Code CLI login' })
  })
})

describe('Command Code catalog endpoints', () => {
  it('routes a model whose catalog row serves only /messages to the Messages shape', async () => {
    catalogPayload = { data: [{ id: 'claude-sonnet-5-5', supported_endpoints: ['/messages'] }, { id: 'gpt-6-luna', supported_endpoints: ['/chat/completions', '/responses'] }] } as never
    try {
      const entries = await fetchCommandCodeCatalog({ baseUrl, apiKey: 'typed-key' })
      expect(entries).toEqual([
        { id: 'claude-sonnet-5-5', api: 'anthropic-messages' },
        { id: 'gpt-6-luna', api: 'openai-completions' },
      ])
    } finally {
      catalogPayload = { data: [{ id: 'anthropic/claude-test' }, { id: 'openai/gpt-test' }] }
    }
  })
})
