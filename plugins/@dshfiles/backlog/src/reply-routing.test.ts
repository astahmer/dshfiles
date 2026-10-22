import { describe, expect, it, vi } from 'vitest'

import { ReplyRouting, threadWorthyQuestion } from './reply-routing.js'

describe('backlog reply routing', () => {
  it('routes work requests and keeps questions and discussion as replies with keyword fallback', () => {
    expect(ReplyRouting.keywords('Please fix the flaky test')).toMatchObject({ route: 'thread', source: 'keywords' })
    expect(ReplyRouting.keywords('Could you investigate this regression?')).toMatchObject({ route: 'thread', source: 'keywords' })
    expect(ReplyRouting.keywords('Why does this happen?')).toMatchObject({ route: 'reply', source: 'keywords' })
    expect(ReplyRouting.keywords('Thanks, that makes sense')).toMatchObject({ route: 'reply', source: 'keywords' })
  })

  it('uses Jev confidence and sends the intended decision question', async () => {
    const jev = vi.fn(async ({ question }: { readonly question: typeof threadWorthyQuestion; readonly text: string }) => {
      expect(question).toBe(threadWorthyQuestion)
      return 0.86
    })

    await expect(ReplyRouting.classify({ text: 'Fix the flaky test', jev })).resolves.toMatchObject({ route: 'thread', source: 'jev', confidence: 0.86 })
    expect(jev).toHaveBeenCalledOnce()
  })

  it('keeps low confidence as a reply and uses keywords when Jev fails', async () => {
    await expect(ReplyRouting.classify({ text: 'Could you explain this?', jev: async () => 0.42 })).resolves.toMatchObject({ route: 'reply', source: 'jev' })
    await expect(ReplyRouting.classify({ text: 'Please fix this', jev: async () => Promise.reject(new Error('offline')) })).resolves.toMatchObject({
      route: 'thread',
      source: 'keywords',
    })
  })

  it('honors a configured Jev threshold', async () => {
    await expect(ReplyRouting.classify({ text: 'Please fix this', jev: async () => 0.7, threshold: 0.8 })).resolves.toMatchObject({ route: 'reply' })
  })
})
