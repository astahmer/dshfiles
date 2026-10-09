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
