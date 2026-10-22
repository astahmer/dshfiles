import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { JevUsageRecord } from '@dshfiles/usage/api'
import type { TriageQuestion } from './triage.js'

const jevAnswerSchema = z.object({
  answers: z.object({ verdict: z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }) }),
  usage: z
    .object({
      input_tokens: z.number().int().min(0).max(1_000_000).optional(),
      output_tokens: z.number().int().min(0).max(1_000_000).optional(),
    })
    .optional(),
})

export const JevClient = {
  ask: async (request: {
    readonly apiKey: string
    readonly question: TriageQuestion
    readonly text: string
    readonly credential: JevUsageRecord['credential']
    readonly recordUsage: (record: JevUsageRecord) => Promise<void>
    readonly fetch?: typeof fetch | undefined
  }): Promise<number> => {
    const requestId = randomUUID()
    const startedAt = Date.now()
    const startedClock = performance.now()
    const record = async (outcome: JevUsageRecord['outcome'], inputTokens: number | null, outputTokens: number | null): Promise<void> => {
      try {
        await request.recordUsage({
          requestId,
          source: 'backlog',
          credential: request.credential,
          startedAt,
          durationMs: Math.min(60 * 60_000, Math.max(0, Math.round(performance.now() - startedClock))),
          outcome,
          inputTokens,
          outputTokens,
        })
      } catch {
        return
      }
    }

    try {
      const response = await (request.fetch ?? fetch)('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { authorization: `Bearer ${request.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'jev-latest',
          state: { role: 'user', content: request.text.slice(0, 8_000) },
          questions: { verdict: { type: 'noul', ...request.question } },
        }),
        signal: AbortSignal.timeout(4_000),
      })
      if (!response.ok) throw new Error(`Jev answered ${String(response.status)}`)
      const answer = jevAnswerSchema.parse(await response.json())
      await record('success', answer.usage?.input_tokens ?? null, answer.usage?.output_tokens ?? null)
      return answer.answers.verdict.noul
    } catch (error) {
      await record('failure', null, null)
      throw error
    }
  },
}
