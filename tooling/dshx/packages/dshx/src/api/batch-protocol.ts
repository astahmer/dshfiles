import * as Schema from 'effect/Schema'

/** The most calls one batch POST may carry; the client flushes at `BATCH_MAX_SIZE`, below it. */
const BATCH_MAX_ENTRIES = 64

/** One call of a batch: `endpoint` is the per-channel route below `/api` (`dshx-<hash>/<method>`), `payload` its envelope. */
const batchEntrySchema = Schema.Struct({
  id: Schema.Number.check(Schema.isInt()),
  endpoint: Schema.String.check(Schema.isMaxLength(512)),
  payload: Schema.Unknown,
})

const batchRequestSchema = Schema.Struct({ entries: Schema.Array(batchEntrySchema).check(Schema.isMaxLength(BATCH_MAX_ENTRIES)) })

const rpcResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.optionalKey(
      Schema.Struct({
        code: Schema.optionalKey(Schema.String),
        message: Schema.optionalKey(Schema.String),
        details: Schema.optionalKey(Schema.ObjectKeyword),
      }),
    ),
  }),
])

/**
 * One NDJSON answer line, written as each call settles. `result` is what the per-channel route would have answered;
 * `status` says the Host could not run the call in the batch: 404 when no API serves the endpoint (the owner is not
 * loaded), anything else asks the client to send that call on its own route.
 */
const batchLineSchema = Schema.Union([
  Schema.Struct({ id: Schema.Number, result: rpcResultSchema }),
  Schema.Struct({ id: Schema.Number, status: Schema.Number }),
])

type BatchLine = (typeof batchLineSchema)['Type']

export class ApiBatchProtocol {
  static readonly maxEntries = BATCH_MAX_ENTRIES
  static readonly request = batchRequestSchema
  static readonly line = batchLineSchema
  static readonly contentType = 'application/x-ndjson'
  static readonly encodeLine = (line: BatchLine): string => `${JSON.stringify(line)}\n`
}
