import { describe, expect, it } from 'vitest'

import { boundedSummary } from './bounded-summary.ts'
import type { SummaryRequest } from './types.ts'
import { Utf8 } from './utf8.ts'

const scripted = (answers: readonly string[]) => {
  const requests: SummaryRequest[] = []
  return {
    requests,
    summarizer: {
      summarize: async (request: SummaryRequest) => {
        requests.push(request)
        return { text: answers[Math.min(request.attempt, answers.length - 1)] ?? '', model: `scripted-${request.attempt}` }
      },
    },
  }
}

const warnings: string[] = []
const logger = { warn: (message: string) => void warnings.push(message) }
const base = { logger, kind: 'merge' as const, stream: 'global' as const, conversationId: 'c1', address: '0+2', input: ['a', 'b'], maxBytes: 100, retries: 3 }

describe('boundedSummary', () => {
  it('retries a leaf with a stricter budget until the answer fits', async () => {
    const { summarizer, requests } = scripted(['x'.repeat(150), 'y'.repeat(120), 'z'.repeat(90)])
    const result = await boundedSummary({ ...base, kind: 'leaf', summarizer })
    expect(result).toEqual({ text: 'z'.repeat(90), model: 'scripted-2', clipped: false, calls: 3 })
    expect(requests.map(request => request.maxBytes)).toEqual([100, 80, 60])
    expect(requests.map(request => request.previousBytes)).toEqual([null, 150, 120])
  })

  it('stops retrying a merge after the first overshoot and clips deterministically', async () => {
    const { summarizer, requests } = scripted(['a'.repeat(300), 'b'.repeat(140), 'c'.repeat(200)])
    const result = await boundedSummary({ ...base, summarizer })
    // A merge input is already two at-ceiling nodes, so re-asking cannot help; one call instead of four.
    expect(requests).toHaveLength(1)
    expect(result).toMatchObject({ clipped: true, model: 'clipped:scripted-0', calls: 1 })
    expect(result.text.startsWith('aaa')).toBe(true)
    expect(Utf8.byteLength(result.text)).toBeLessThanOrEqual(100)
    expect(warnings).toContain('optmem summary clipped after retries')
  })

  it('keeps the shortest overshoot when a leaf still clips after every retry', async () => {
    const { summarizer, requests } = scripted(['a'.repeat(300), 'b'.repeat(140), 'c'.repeat(200)])
    const result = await boundedSummary({ ...base, kind: 'leaf', summarizer })
    expect(requests).toHaveLength(4)
    expect(result).toMatchObject({ clipped: true, model: 'clipped:scripted-1', calls: 4 })
    expect(result.text.startsWith('bbb')).toBe(true)
    expect(Utf8.byteLength(result.text)).toBeLessThanOrEqual(100)
  })

  it('strips a copied address head', async () => {
    const { summarizer } = scripted(['12+4|  the summary'])
    expect((await boundedSummary({ ...base, summarizer })).text).toBe('the summary')
  })

  it('fails instead of storing an empty summary', async () => {
    const { summarizer } = scripted(['   '])
    await expect(boundedSummary({ ...base, summarizer })).rejects.toThrow(/empty/)
  })
})
