import { SecretReferenceResolver } from '@dshfiles/credential-port/effect'
import { Jev, type JevCredential, type JevError, type JevQuestion, type JevVerdict } from '@dshfiles/jev'
import { Utf8 } from '@dshfiles/optmem-core'
import { Context, Effect, Layer, Option, Redacted } from 'effect'

import type { MemoryInactive, MemoryStoreFailed } from './errors.ts'
import { MemorySettingsTag } from './embedder.ts'
import { MemoryRepo } from './memory-repo.ts'

const TYPESAFE_ENV_KEY = 'TYPESAFE_API_KEY'

export const jevQuestions = {
  signal: {
    name: 'signal',
    instructions:
      'Is `content` a user message that carries a durable signal a later conversation should remember: a correction of the assistant, a decision and its reason, a lasting preference, or a non-obvious fact about the project?',
    criteria: {
      true: 'States a correction, decision, preference or non-obvious fact meant to hold beyond this request',
      false: 'A routine request, question, pasted material, or acknowledgement',
    },
  },
  recall: {
    name: 'recall',
    instructions:
      'Does answering the user message in `content` likely depend on earlier conversations, past work, a past decision or something said before (for example "last time", a ticket, an earlier incident)?',
    criteria: { true: 'Refers to or needs earlier work or context', false: 'Self-contained: the current request carries what it needs' },
  },
  relevance: {
    name: 'relevance',
    instructions:
      'Is this stored memory likely still useful to preserve for future conversations, based only on its text? A high probability means keep it. A low probability means it may be outdated or transient and should be reviewed by a person before archiving.',
    criteria: {
      true: 'A durable preference, decision, constraint, reference or project fact likely to help future work',
      false: 'A one-time outcome, temporary state, completed task detail or fact that appears time-bound from the text itself',
    },
  },
} satisfies Record<string, JevQuestion>

/**
 * Memory's optional Jev use: digest signals, the recall gate and on-demand note review. Each answered call is counted
 * in memory's own usage and cost tables; a failed one bumps `jev.failures` and the caller treats it as "unknown".
 */
export class MemoryJev extends Context.Service<
  MemoryJev,
  {
    /** The key and its safe label when Jev is enabled and a credential resolves; none otherwise. */
    readonly credential: Effect.Effect<Option.Option<JevCredential>>
    readonly ask: (request: {
      readonly question: keyof typeof jevQuestions
      readonly text: string
      readonly credential: JevCredential
      /** Whether the provider-reported output tokens count in memory's cost table (the note review records them). */
      readonly recordOutput: boolean
    }) => Effect.Effect<JevVerdict, JevError | MemoryInactive | MemoryStoreFailed>
  }
>()('@dshfiles/memory/MemoryJev') {
  static readonly layer = Layer.effect(
    MemoryJev,
    Effect.gen(function* () {
      const settings = yield* MemorySettingsTag
      const secrets = yield* SecretReferenceResolver
      const jev = yield* Jev
      const repo = yield* MemoryRepo

      const credential = Effect.gen(function* () {
        const current = yield* settings.get
        const resolved = yield* secrets
          .resolveWithLabel({
            referenceText: current.jevSecret,
            environmentValue: process.env[TYPESAFE_ENV_KEY],
            environmentVariableName: TYPESAFE_ENV_KEY,
          })
          .pipe(Effect.catchCause(cause => Effect.logWarning('memory: the Jev credential could not be resolved', cause).pipe(Effect.as(Option.none()))))
        return Option.map(resolved, (value): JevCredential => ({ apiKey: Redacted.make(value.value), label: value.label }))
      })

      const ask = Effect.fn('memory jev ask')(
        function* (request: {
          readonly question: keyof typeof jevQuestions
          readonly text: string
          readonly credential: JevCredential
          readonly recordOutput: boolean
        }) {
          const verdict = yield* jev.ask({
            question: jevQuestions[request.question],
            text: Utf8.boundHeadTail(request.text, 8_000).text,
            credential: request.credential,
            source: 'memory',
            timeout: '2 seconds',
          })
          const inputTokens = verdict.inputTokens ?? 0
          yield* repo.bump('jev.calls')
          yield* repo.bump('jev.inputTokens', inputTokens)
          yield* repo.recordCost({
            kind: 'jev',
            provider: 'typesafe',
            model: 'jev',
            input: inputTokens,
            cacheRead: 0,
            output: request.recordOutput ? (verdict.outputTokens ?? 0) : 0,
          })
          yield* Effect.logInfo(`memory: jev call {"question":"${request.question}","inputTokens":${inputTokens}}`)
          return verdict
        },
        effect => Effect.tapError(effect, () => Effect.ignore(repo.bump('jev.failures'))),
      )

      return MemoryJev.of({
        credential: Effect.flatMap(settings.get, current => (current.jevEnabled ? credential : Effect.succeedNone)),
        ask,
      })
    }),
  )
}
