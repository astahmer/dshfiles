import { Context, Effect, Layer } from 'effect'
import { OtlpBody, type OtlpBodyInput, type OtlpSignal } from './otlp/decode.js'
import { SpanNormalizer } from './otlp/normalize.js'
import type { OtlpRequestRejected } from './receiver-errors.js'
import { TracesSettingsModel, TracesSettingsService } from './settings.js'
import { TraceRepo } from './trace-repo.js'

type Ingested = { readonly accepted: number; readonly rejected: number }

/** Decodes one OTLP body, normalizes it with the current redaction setting and stores it under the current retention. */
export class OtlpIngest extends Context.Service<
  OtlpIngest,
  { readonly ingest: (signal: OtlpSignal, body: OtlpBodyInput) => Effect.Effect<Ingested, OtlpRequestRejected> }
>()('@dshfiles/traces/OtlpIngest') {
  static readonly layer = Layer.effect(
    OtlpIngest,
    Effect.gen(function* () {
      const repo = yield* TraceRepo
      const settings = yield* TracesSettingsService

      const ingest = Effect.fn('otlp ingest store')(function* (signal: OtlpSignal, body: OtlpBodyInput) {
        const current = yield* settings.get
        const options = { redactContent: current.redactGenAiContent }
        const retention = TracesSettingsModel.retentionOf(current)
        if (signal === 'traces') {
          const normalized = SpanNormalizer.normalizeTraces(yield* OtlpBody.decodeTraces(body), options)
          yield* repo.ingestSpans(normalized.spans, retention)
          return { accepted: normalized.spans.length, rejected: normalized.rejected }
        }
        if (signal === 'logs') {
          const normalized = SpanNormalizer.normalizeLogs(yield* OtlpBody.decodeLogs(body), options)
          yield* repo.ingestLogs(normalized.logs, retention)
          return { accepted: normalized.logs.length, rejected: normalized.rejected }
        }
        const normalized = SpanNormalizer.normalizeMetrics(yield* OtlpBody.decodeMetrics(body), options)
        yield* repo.ingestMetrics(normalized.points, retention)
        return { accepted: normalized.points.length, rejected: normalized.rejected }
      })

      return OtlpIngest.of({ ingest })
    }),
  )
}
