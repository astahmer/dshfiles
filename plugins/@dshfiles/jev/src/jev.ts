import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { type JevUsageRecord, usageApi } from '@dshfiles/usage/api'
import { Clock, Context, Duration, Effect, Layer, Redacted, Schema } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'

const endpoint = 'https://api.typesafe.ai/v1/systemone'
const model = 'jev-latest'
const maxRecordedDurationMs = 60 * 60_000

const tokenCount = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1_000_000))

const JevAnswer = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  answers: Schema.Struct({
    verdict: Schema.Struct({
      type: Schema.Literal('noul'),
      noul: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
    }),
  }),
  usage: Schema.optionalKey(Schema.Struct({ input_tokens: Schema.optionalKey(tokenCount), output_tokens: Schema.optionalKey(tokenCount) })),
})

const decodeAnswer = HttpClientResponse.schemaBodyJson(JevAnswer)

/** One Noul question: the instruction Jev answers about `content`, and what a true or false answer means. */
export type JevQuestion = {
  /** Short label recorded on the span, e.g. `signal` or `triage`. */
  readonly name: string
  readonly instructions: string
  readonly criteria: { readonly true: string; readonly false: string }
}

/** The resolved key and the safe local label the usage ledger groups calls by. */
export type JevCredential = { readonly apiKey: Redacted.Redacted<string>; readonly label: JevUsageRecord['credential'] }

export type JevRequest = {
  readonly question: JevQuestion
  /** The text Jev classifies; callers bound it to what the endpoint accepts. */
  readonly text: string
  readonly credential: JevCredential
  readonly source: JevUsageRecord['source']
  readonly timeout: Duration.Input
}

export class JevVerdict extends Schema.Class<JevVerdict>('JevVerdict')({
  probability: Schema.Number,
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
}) {}

export class JevTransportFailed extends Schema.TaggedError<JevTransportFailed>()('JevTransportFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'Jev could not be reached.'
  }
}

export class JevTimedOut extends Schema.TaggedError<JevTimedOut>()('JevTimedOut', {
  timeoutMs: Schema.Number,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Jev did not answer within ${this.timeoutMs} ms.`
  }
}

export class JevStatusRejected extends Schema.TaggedError<JevStatusRejected>()('JevStatusRejected', {
  status: Schema.Number,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Jev answered HTTP ${this.status}.`
  }
}

export class JevAnswerInvalid extends Schema.TaggedError<JevAnswerInvalid>()('JevAnswerInvalid', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'Jev returned an answer this client cannot read.'
  }
}

export type JevError = JevTransportFailed | JevTimedOut | JevStatusRejected | JevAnswerInvalid

/** TypeSafe's Jev (`POST /v1/systemone`): one Noul question per call, each call recorded in the usage ledger. */
export class Jev extends Context.Service<
  Jev,
  {
    readonly ask: (request: JevRequest) => Effect.Effect<JevVerdict, JevError>
  }
>()('@dshfiles/jev/Jev') {
  static readonly layer = Layer.effect(
    Jev,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const usage = (yield* HostApis).client(usageApi)

      const record = (entry: JevUsageRecord) =>
        usage.recordJevUsage(entry).pipe(Effect.catchCause(cause => Effect.logDebug('jev usage was not recorded', cause)))

      const classify = Effect.fn('jev classify', { kind: 'client' })(function* (request: JevRequest) {
        yield* Effect.annotateCurrentSpan({
          'gen_ai.operation.name': 'classify',
          'gen_ai.provider.name': 'typesafe',
          'gen_ai.request.model': model,
          'dshx.plugin.package': `@dshfiles/${request.source}`,
          'jev.question': request.question.name,
        })
        const timeoutMs = Duration.toMillis(request.timeout)
        const response = yield* http
          .execute(
            HttpClientRequest.post(endpoint).pipe(
              HttpClientRequest.bearerToken(Redacted.value(request.credential.apiKey)),
              HttpClientRequest.bodyJsonUnsafe({
                model,
                state: { role: 'user', content: request.text },
                questions: { verdict: { type: 'noul', instructions: request.question.instructions, criteria: request.question.criteria } },
              }),
            ),
          )
          .pipe(
            Effect.timeoutOrElse({ duration: request.timeout, orElse: () => Effect.fail(new JevTimedOut({ timeoutMs })) }),
            Effect.catchTag('HttpClientError', error => Effect.fail(new JevTransportFailed({ cause: error }))),
          )
        yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
        if (response.status < 200 || response.status >= 300) return yield* new JevStatusRejected({ status: response.status })
        const answer = yield* decodeAnswer(response).pipe(Effect.mapError(error => new JevAnswerInvalid({ cause: error })))
        if (answer.model !== undefined) yield* Effect.annotateCurrentSpan('gen_ai.response.model', answer.model)
        if (answer.usage?.input_tokens !== undefined) yield* Effect.annotateCurrentSpan('gen_ai.usage.input_tokens', answer.usage.input_tokens)
        if (answer.usage?.output_tokens !== undefined) yield* Effect.annotateCurrentSpan('gen_ai.usage.output_tokens', answer.usage.output_tokens)
        return new JevVerdict({
          probability: answer.answers.verdict.noul,
          inputTokens: answer.usage?.input_tokens ?? null,
          outputTokens: answer.usage?.output_tokens ?? null,
        })
      })

      const ask = Effect.fn('jev ask')(function* (request: JevRequest) {
        const requestId = globalThis.crypto.randomUUID()
        const startedAt = yield* Clock.currentTimeMillis
        const outcome = yield* Effect.exit(classify(request))
        const endedAt = yield* Clock.currentTimeMillis
        const verdict = outcome._tag === 'Success' ? outcome.value : undefined
        yield* record({
          requestId,
          source: request.source,
          credential: request.credential.label,
          startedAt,
          durationMs: Math.min(maxRecordedDurationMs, Math.max(0, Math.round(endedAt - startedAt))),
          outcome: verdict === undefined ? 'failure' : 'success',
          inputTokens: verdict?.inputTokens ?? null,
          outputTokens: verdict?.outputTokens ?? null,
        })
        return yield* outcome
      })

      return Jev.of({ ask })
    }),
  )
}
