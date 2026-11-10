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
  {
    readonly ingest: (signal: OtlpSignal, body: OtlpBodyInput) => Effect.Effect<Ingested, OtlpRequestRejected>
    /** Stores a trace batch handed over in this process as an object, skipping JSON parsing. */
    readonly ingestTraceRequest: (request: unknown) => Effect.Effect<Ingested, OtlpRequestRejected>
  }
>()('@dshfiles/traces/OtlpIngest') {
  static readonly layer = Layer.effect(
    OtlpIngest,
    Effect.gen(function* () {
      const repo = yield* TraceRepo
      const settings = yield* TracesSettingsService

      const storeTraces = Effect.fnUntraced(function* (decoded: Effect.Success<ReturnType<typeof OtlpBody.decodeTraceRequest>>) {
        const current = yield* settings.get
        const normalized = SpanNormalizer.normalizeTraces(decoded, { redactContent: current.redactGenAiContent })
        yield* repo.ingestSpans(normalized.spans, TracesSettingsModel.retentionOf(current))
        return { accepted: normalized.spans.length, rejected: normalized.rejected }
      })

      const ingestTraceRequest = Effect.fn('otlp ingest store')(function* (request: unknown) {
        return yield* storeTraces(yield* OtlpBody.decodeTraceRequest(request))
      })

      const ingest = Effect.fn('otlp ingest store')(function* (signal: OtlpSignal, body: OtlpBodyInput) {
        if (signal === 'traces') return yield* storeTraces(yield* OtlpBody.decodeTraces(body))
        const current = yield* settings.get
        const options = { redactContent: current.redactGenAiContent }
        const retention = TracesSettingsModel.retentionOf(current)
        if (signal === 'logs') {
          const normalized = SpanNormalizer.normalizeLogs(yield* OtlpBody.decodeLogs(body), options)
          yield* repo.ingestLogs(normalized.logs, retention)
          return { accepted: normalized.logs.length, rejected: normalized.rejected }
        }
        const normalized = SpanNormalizer.normalizeMetrics(yield* OtlpBody.decodeMetrics(body), options)
        yield* repo.ingestMetrics(normalized.points, retention)
        return { accepted: normalized.points.length, rejected: normalized.rejected }
      })

      return OtlpIngest.of({ ingest, ingestTraceRequest })
    }),
  )
}
