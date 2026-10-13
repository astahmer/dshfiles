import { Utf8 } from '@dshfiles/optmem-core'
import { z } from 'zod'

const answerSchema = z.object({
  model: z.string(),
  answers: z.object({ verdict: z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }) }),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }).optional(),
})

export type JevVerdict = { readonly probability: number; readonly inputTokens: number }

const questions = {
  signal: {
    instructions:
      'Is `content` a user message that carries a durable signal a later conversation should remember: a correction of the assistant, a decision and its reason, a lasting preference, or a non-obvious fact about the project?',
    criteria: {
      true: 'States a correction, decision, preference or non-obvious fact meant to hold beyond this request',
      false: 'A routine request, question, pasted material, or acknowledgement',
    },
  },
  recall: {
    instructions:
      'Does answering the user message in `content` likely depend on earlier conversations, past work, a past decision or something said before (for example "last time", a ticket, an earlier incident)?',
    criteria: { true: 'Refers to or needs earlier work or context', false: 'Self-contained: the current request carries what it needs' },
  },
} as const

/**
 * TypeSafe's Jev (`POST /v1/systemone`, one Noul question), used optionally for two cheap decisions: whether a user
 * message is a durable signal, and whether a new thread likely needs memory. Callers treat any failure as "unknown".
 */
export class JevClassifier {
  static readonly endpoint = 'https://api.typesafe.ai/v1/systemone'

  static async ask(request: {
    readonly question: keyof typeof questions
    readonly text: string
    readonly apiKey: string
    readonly timeoutMs?: number | undefined
    readonly fetch?: typeof fetch | undefined
  }): Promise<JevVerdict> {
    const response = await (request.fetch ?? fetch)(JevClassifier.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${request.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { role: 'user', content: Utf8.boundHeadTail(request.text, 8_000).text },
        questions: { verdict: { type: 'noul', ...questions[request.question] } },
      }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 2_000),
    })
    if (!response.ok) throw new Error(`jev answered HTTP ${response.status}`)
    const parsed = answerSchema.parse(await response.json())
    return { probability: parsed.answers.verdict.noul, inputTokens: parsed.usage?.input_tokens ?? 0 }
  }
}
