import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CommandCodeConfigError, createCommandCodeProvider, fetchCommandCodeCatalog } from './commandcode-provider.js'

const received: IncomingHttpHeaders[] = []
const server = createServer((request, response) => {
  received.push(request.headers)
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ data: [{ id: 'anthropic/claude-test' }, { id: 'openai/gpt-test' }] }))
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
