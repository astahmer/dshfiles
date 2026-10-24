import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { JevClient } from './jev-client.js'
import type { JevUsageRecord } from '@dshfiles/usage/api'

const request = {
  apiKey: 'synthetic-test-key',
  question: { instructions: 'Is this work?', criteria: { true: 'yes', false: 'no' } },
  text: 'synthetic prompt text',
  credential: 'secret:BACKLOG_JEV',
  recordUsage: async (_record: JevUsageRecord): Promise<void> => {},
}

const answerResponse = (): Response =>
  new Response(JSON.stringify({ model: 'jev-1.14.0', answers: { verdict: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 42, output_tokens: 3 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('JevClient', () => {
  it('records provider-reported usage without the key or request text', async () => {
    const records: JevUsageRecord[] = []
    const probability = await JevClient.ask({
      ...request,
      recordUsage: async record => {
        records.push(record)
      },
      fetch: async (input, init) => {
        expect(input).toBe('https://api.typesafe.ai/v1/systemone')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-test-key')
        return answerResponse()
      },
    })

    expect(probability).toBe(0.8)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ source: 'backlog', credential: 'secret:BACKLOG_JEV', outcome: 'success', inputTokens: 42, outputTokens: 3 })
    expect(Object.keys(records[0] ?? {}).sort()).toEqual([
      'credential',
      'durationMs',
      'inputTokens',
      'outcome',
      'outputTokens',
      'requestId',
      'source',
      'startedAt',
    ])
  })

  it('counts failed attempts without persisting provider error bodies', async () => {
    const records: JevUsageRecord[] = []
    await expect(
      JevClient.ask({
        ...request,
        recordUsage: async record => {
          records.push(record)
        },
        fetch: async () => new Response('synthetic private error body', { status: 429 }),
      }),
    ).rejects.toThrow('Jev answered 429')

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ source: 'backlog', credential: 'secret:BACKLOG_JEV', outcome: 'failure', inputTokens: null, outputTokens: null })
    expect(JSON.stringify(records[0])).not.toContain('synthetic-test-key')
    expect(JSON.stringify(records[0])).not.toContain('synthetic private error body')
  })

  it('records a jev classify span with status and token counts, never the key or text', async () => {
    using recorder = recordSpans()
    await JevClient.ask({ ...request, fetch: async () => answerResponse() })
    const span = recorder.span('jev classify')
    expect(span.attributes).toMatchObject({ 'http.response.status_code': 200, 'gen_ai.usage.input_tokens': 42, 'gen_ai.usage.output_tokens': 3 })
    expect(JSON.stringify(span.attributes)).not.toMatch(/synthetic-test-key|synthetic prompt text/)
  })

  it('keeps Jev results when usage recording fails', async () => {
    await expect(
      JevClient.ask({
        ...request,
        recordUsage: async () => {
          throw new Error('local usage store unavailable')
        },
        fetch: async () => answerResponse(),
      }),
    ).resolves.toBe(0.8)
  })
})
