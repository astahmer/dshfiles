import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from '@effect/vitest'
import { DeclaredRetryAfter } from './provider-retry-after.js'

const failed: StreamChunk = { type: 'finish', reason: { kind: 'error', failure: { message: '429', code: 'RATE_LIMIT' } } }

async function* once(chunk: StreamChunk): AsyncIterable<StreamChunk> {
  yield chunk
}

const delayAfter = async (headers: Readonly<Record<string, string>>, status = 429): Promise<number | undefined> => {
  const declared = new DeclaredRetryAfter()
  declared.observe('cc_a', { status, headers }, Date.parse('2026-11-02T12:00:00Z'))
  const chunks: StreamChunk[] = []
  for await (const chunk of declared.attach('cc_a', once(failed))) chunks.push(chunk)
  const [finish] = chunks
  return finish?.type === 'finish' && finish.reason.kind === 'error' ? finish.reason.failure.providerRetryAfterMs : undefined
}

describe('DeclaredRetryAfter', () => {
  it('reads retry-after-ms, retry-after seconds and an HTTP date onto the failed finish', async () => {
    expect(await delayAfter({ 'retry-after-ms': '1500' })).toBe(1_500)
    expect(await delayAfter({ 'Retry-After': '2' })).toBe(2_000)
    expect(await delayAfter({ 'retry-after': 'Mon, 02 Nov 2026 12:00:30 GMT' })).toBe(30_000)
  })

  it('declares nothing for an accepted response, a missing header or a past date', async () => {
    expect(await delayAfter({ 'retry-after': '2' }, 200)).toBeUndefined()
    expect(await delayAfter({})).toBeUndefined()
    expect(await delayAfter({ 'retry-after': 'Mon, 02 Nov 2026 11:59:00 GMT' })).toBeUndefined()
  })
})
