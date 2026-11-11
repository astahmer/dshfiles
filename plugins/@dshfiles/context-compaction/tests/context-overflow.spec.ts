import { describe, expect, it } from 'vitest'
import { isProviderContextOverflow } from '../src/context-overflow.js'

describe('provider context-overflow recognition', () => {
  it.each([
    ['Anthropic', { code: 'PROVIDER_ERROR', status: 400, message: 'prompt is too long: 213000 tokens > 200000 maximum' }],
    ['Anthropic max_tokens', { message: 'input length and `max_tokens` exceed context limit: 190000 + 32000 > 200000' }],
    ['Gemini', { message: 'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).' }],
    ['Bedrock', { message: 'Input is too long for requested model.' }],
    ['llama.cpp', { message: 'the request exceeds the available context size, try increasing it' }],
    ['xAI', { message: "This model's maximum prompt length is 131072 but the request contains 140000 tokens." }],
    ['Moonshot', { message: 'Invalid request: exceeded model token limit: 262144' }],
    ['Copilot', { message: 'prompt token count of 140000 exceeds the limit of 128000' }],
    ['GLM', { message: 'Prompt exceeds max length' }],
    ['Cohere', { message: 'too many tokens: total number of tokens in the prompt cannot exceed 128000' }],
    ['a 413 about tokens', { status: 413, message: 'Request too large: 300000 tokens' }],
    ['a wrapped cause', new Error('fetch failed', { cause: { error: { type: 'invalid_request_error', message: 'prompt is too long' } } })],
    ['the core code', { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'context window exceeded' }],
  ])('recognizes %s', (_name, error) => {
    expect(isProviderContextOverflow(error)).toBe(true)
  })

  it.each([
    ['a token rate limit', { status: 429, message: 'Rate limit reached for gpt-4o: Limit 30000, Used 29000, Requested 2000 tokens per min' }],
    ['a bare 413', { status: 413, message: 'Payload Too Large' }],
    ['an auth failure', { status: 401, message: 'invalid x-api-key' }],
    ['a non-error value', 42],
  ])('ignores %s', (_name, error) => {
    expect(isProviderContextOverflow(error)).toBe(false)
  })
})
