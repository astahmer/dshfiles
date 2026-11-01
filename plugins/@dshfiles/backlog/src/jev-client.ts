import { randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import { withSpan } from '@dshfiles/dshx/tracing'
import type { JevUsageRecord } from '@dshfiles/usage/api'
import type { TriageQuestion } from './triage.js'

const tokenCountSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1_000_000))

const jevAnswerSchema = Schema.Struct({
  answers: Schema.Struct({
    verdict: Schema.Struct({
      type: Schema.Literal('noul'),
      noul: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
    }),
  }),
  usage: Schema.optionalKey(
    Schema.Struct({
      input_tokens: Schema.optionalKey(tokenCountSchema),
      output_tokens: Schema.optionalKey(tokenCountSchema),
    }),
  ),
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

    return withSpan(
      'jev classify',
      {
        kind: 'client',
        attributes: {
          'gen_ai.operation.name': 'classify',
          'gen_ai.provider.name': 'typesafe',
          'gen_ai.request.model': 'jev-latest',
          'dshx.plugin.package': '@dshfiles/backlog',
        },
      },
      async span => {
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
          span.setAttribute('http.response.status_code', response.status)
          if (!response.ok) throw new Error(`Jev answered ${String(response.status)}`)
          const answer = Schema.decodeUnknownSync(jevAnswerSchema)(await response.json())
          span.setAttributes({ 'gen_ai.usage.input_tokens': answer.usage?.input_tokens, 'gen_ai.usage.output_tokens': answer.usage?.output_tokens })
          await record('success', answer.usage?.input_tokens ?? null, answer.usage?.output_tokens ?? null)
          return answer.answers.verdict.noul
        } catch (error) {
          await record('failure', null, null)
          throw error
        }
      },
    )
  },
}
