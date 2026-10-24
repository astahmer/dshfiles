import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { JevClassifier } from './jev.js'

const answer = (status: number): Response =>
  new Response(
    status === 200
      ? JSON.stringify({ model: 'jev-1.14.0', answers: { verdict: { type: 'noul', noul: 0.7 } }, usage: { input_tokens: 12, output_tokens: 2 } })
      : 'private body',
    { status, headers: { 'content-type': 'application/json' } },
  )

describe('JevClassifier', () => {
  it('records a jev classify span with the question, status and token counts, never the key or text', async () => {
    using recorder = recordSpans()
    const verdict = await JevClassifier.ask({ question: 'recall', text: 'synthetic user message', apiKey: 'synthetic-key', fetch: async () => answer(200) })
    expect(verdict).toEqual({ probability: 0.7, inputTokens: 12, outputTokens: 2 })
    const span = recorder.span('jev classify')
    expect(span.attributes).toMatchObject({
      'jev.question': 'recall',
      'http.response.status_code': 200,
      'gen_ai.response.model': 'jev-1.14.0',
      'gen_ai.usage.input_tokens': 12,
    })
    expect(JSON.stringify(span.attributes)).not.toMatch(/synthetic-key|synthetic user message/)
  })

  it('marks a refused classification as an error span', async () => {
    using recorder = recordSpans()
    await expect(JevClassifier.ask({ question: 'recall', text: 'x', apiKey: 'k', fetch: async () => answer(503) })).rejects.toThrow('jev answered HTTP 503')
    expect(recorder.span('jev classify').status.code).toBe('error')
  })
})
