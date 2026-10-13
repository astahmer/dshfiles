import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CommandCodeConfigError, createCommandCodeProvider, fetchCommandCodeCatalog } from './commandcode-provider.js'
import { readCommandCodeKey } from './commandcode-usage.js'
import { CommandCodeCapabilities } from './commandcode-capabilities.js'

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
      expect(entries).toContainEqual({ id: 'gpt-6-luna', api: 'openai-completions' })
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

describe('Command Code transport selection', () => {
  interface Captured {
    readonly url: string
    readonly headers: Headers
    readonly body: Record<string, unknown> | undefined
  }

  const CLI_ANSWER = [
    '{"type":"start"}',
    '{"type":"text-delta","text":"ok"}',
    '{"type":"finish","finishReason":"stop","totalUsage":{"inputTokens":3,"outputTokens":1}}',
    '',
  ].join('\n')
  const SSE_ANSWER = [
    'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-6-luna","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
    'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-6-luna","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')

  const drive = async (input: { readonly modelId: string; readonly planId?: string; readonly respond: (url: URL) => Response }) => {
    const captured: Captured[] = []
    const stubFetch = async (resource: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = new Request(resource, init)
      const url = new URL(request.url)
      if (url.pathname === '/alpha/billing/subscriptions') {
        return input.planId === undefined ? new Response('{}', { status: 500 }) : Response.json({ data: { planId: input.planId, status: 'active' } })
      }
      const text = await request.text()
      captured.push({ url: request.url, headers: request.headers, body: text === '' ? undefined : JSON.parse(text) })
      return input.respond(url)
    }
    const provider = createCommandCodeProvider()
    const model = provider.getModels().find(candidate => candidate.id === input.modelId) ?? provider.describeModel(input.modelId)
    const stream = provider.streamSimple(model, { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 }] } as never, {
      apiKey: `key-${input.planId ?? 'none'}-${input.modelId}`,
      fetch: stubFetch as typeof fetch,
    })
    for await (const _event of stream) {
      // drain
    }
    return { captured, settled: await stream.result() }
  }

  it('sends a Go plan through the CLI endpoint with only the required client header', async () => {
    const { captured, settled } = await drive({
      modelId: 'gpt-6-luna',
      planId: 'individual-go-v1',
      respond: () => new Response(CLI_ANSWER, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    })
    expect(captured.map(call => new URL(call.url).pathname)).toEqual(['/alpha/generate'])
    expect(captured[0]?.headers.get('authorization')).toBe('Bearer key-individual-go-v1-gpt-6-luna')
    expect(captured[0]?.headers.get('x-command-code-version')).toMatch(/^\d+\.\d+\.\d+$/)
    expect(captured[0]?.headers.get('x-cli-environment')).toBeNull()
    expect(captured[0]?.headers.get('x-project-slug')).toBeNull()
    expect(settled.stopReason).toBe('stop')
    expect(settled.content).toEqual([{ type: 'text', text: 'ok' }])
  })

  it('prefers the CLI endpoint when the plan cannot be read', async () => {
    const { captured } = await drive({ modelId: 'gpt-6-luna', respond: () => new Response(CLI_ANSWER, { status: 200 }) })
    expect(new URL(captured[0]?.url ?? '').pathname).toBe('/alpha/generate')
  })

  it('keeps the Provider API for a plan that includes it', async () => {
    const { captured, settled } = await drive({
      modelId: 'gpt-6-luna',
      planId: 'individual-pro-v1',
      respond: () => new Response(SSE_ANSWER, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    })
    expect(captured[0]?.url).toBe('https://api.commandcode.ai/provider/v1/chat/completions')
    expect(captured[0]?.body?.model).toBe('gpt-6-luna')
    expect(settled.stopReason).toBe('stop')
  })

  it('posts a Messages-only model to /provider/v1/messages on a Provider API plan', async () => {
    const { captured } = await drive({ modelId: 'claude-sonnet-5-5', planId: 'individual-max', respond: () => new Response('{}', { status: 500 }) })
    expect(new URL(captured[0]?.url ?? '').pathname).toBe('/provider/v1/messages')
  })

  it('moves a key to the CLI endpoint when the Provider API refuses the plan before answering', async () => {
    const { captured, settled } = await drive({
      modelId: 'gpt-6-luna',
      planId: 'individual-pro',
      respond: url =>
        url.pathname === '/alpha/generate'
          ? new Response(CLI_ANSWER, { status: 200 })
          : Response.json(
              { error: { message: "Your Go plan doesn't include API access.", type: 'permission_error', code: 'upgrade_required' } },
              { status: 403 },
            ),
    })
    expect(captured.map(call => new URL(call.url).pathname)).toEqual(['/provider/v1/chat/completions', '/alpha/generate'])
    expect(settled.stopReason).toBe('stop')
  })
})

describe('Command Code reasoning efforts', () => {
  const provider = createCommandCodeProvider()

  it('offers the CLI effort tiers per model', () => {
    const luna = provider.describeModel('gpt-6-luna')
    expect(luna.reasoning).toBe(true)
    expect(luna.thinkingLevelMap).toMatchObject({ minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  })

  it('marks a level the model does not list as unsupported', () => {
    expect(provider.describeModel('deepseek/deepseek-v4-flash').thinkingLevelMap).toEqual({ minimal: null, low: null, medium: null, high: 'high', max: 'max' })
  })

  it('offers no effort control for a model without selectable efforts', () => {
    expect(provider.describeModel('moonshotai/Kimi-K2.6').reasoning).toBe(false)
  })

  it('declares image input only for vision models', () => {
    expect(provider.describeModel('gpt-6-luna').input).toEqual(['text', 'image'])
    expect(provider.describeModel('zai-org/GLM-5.3').input).toEqual(['text'])
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
    catalogPayload = {
      data: [
        { id: 'claude-sonnet-5-5', supported_endpoints: ['/messages'] },
        { id: 'gpt-6-luna', supported_endpoints: ['/chat/completions', '/responses'] },
      ],
    } as never
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

describe('Command Code CLI login fallback', () => {
  it('reads the key `cmd login` wrote to ~/.commandcode/auth.json when the variable is unset', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cc-home-'))
    const originalHome = process.env.HOME
    try {
      await mkdir(join(home, '.commandcode'))
      await writeFile(join(home, '.commandcode', 'auth.json'), JSON.stringify({ 'command-code': { type: 'api', key: 'login-key' } }))
      process.env.HOME = home
      expect(await readCommandCodeKey('UNSET_FOR_TEST_API_KEY', async () => '')).toBe('login-key')
      expect(await readCommandCodeKey('UNSET_FOR_TEST_API_KEY', async () => 'vault-key')).toBe('vault-key')
    } finally {
      process.env.HOME = originalHome
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe('Command Code image request pricing', () => {
  const image = (width: number, height: number) =>
    ({ type: 'image' as const, attachment: { attachmentId: 'a', mediaType: 'image/png', width, height, bytes: 1 } }) as never

  it('prices a Claude image at the CLI request size', () => {
    // 3136x1568 is sent at 1568x784: ceil(1568 * 784 / 750) visual tokens.
    expect(CommandCodeCapabilities.imageRequestPricing('claude-sonnet-5-5').priceImages([image(3136, 1568)])).toEqual([{ visualTokens: 1640, text: '' }])
  })

  it('prices a GPT image by 512 px tiles', () => {
    expect(CommandCodeCapabilities.imageRequestPricing('gpt-6-luna').priceImages([image(1024, 1024)])).toEqual([{ visualTokens: 765, text: '' }])
  })

  it('represents an image as text for a model that cannot read it', () => {
    const [price] = CommandCodeCapabilities.imageRequestPricing('zai-org/GLM-5.3').priceImages([image(100, 100)])
    expect(price?.visualTokens).toBe(0)
    expect(price?.text.length).toBeGreaterThan(0)
  })
})
