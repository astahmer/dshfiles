import { Schema } from 'effect'
import { defineApi, event, method } from '@dshfiles/dshx/api'
import { jobBoardFilterSchema, jobBoardSchema, jobIndexingSchema, jobKillSchema, jobOutputSchema, jobWaitInputSchema, jobWaitSchema } from './types.js'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)
type JsonValue = Schema.Schema.Type<typeof Schema.Json>
type JsonObject = Schema.Schema.Type<typeof Schema.JsonObject>
const isJsonObject = (value: JsonValue): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const strictJsonSchema = (document: JsonObject): JsonObject => {
  const visit = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(visit)
    if (!isJsonObject(value)) return value
    const record = Object.fromEntries(Object.entries(value))
    const nonNull = record.not
    if (record.type === undefined && nonNull !== undefined && isJsonObject(nonNull) && nonNull.type === 'null') {
      record.type = 'object'
      record.properties = {}
      record.additionalProperties = false
      delete record.not
    }
    if (record.type === 'object' && (record.additionalProperties === true || record.additionalProperties === undefined)) record.additionalProperties = false
    if (Array.isArray(record.enum) && record.enum.length === 1 && typeof record.enum[0] === 'boolean') {
      record.const = record.enum[0]
      delete record.enum
    }
    for (const [key, entry] of Object.entries(record)) record[key] = visit(entry)
    return record
  }
  const strict = visit(document)
  if (!isJsonObject(strict)) throw new TypeError('Effect JSON Schema must be an object.')
  return strict
}
const apiSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const standard = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const jsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  return {
    ...standard,
    '~standard': {
      ...standard['~standard'],
      jsonSchema: {
        input: (options: Parameters<typeof jsonSchema.input>[0]) => strictJsonSchema(Schema.decodeUnknownSync(Schema.JsonObject)(jsonSchema.input(options))),
        output: (options: Parameters<typeof jsonSchema.output>[0]) => strictJsonSchema(Schema.decodeUnknownSync(Schema.JsonObject)(jsonSchema.output(options))),
      },
    },
  }
}
const jobIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const outputInputSchema = apiSchema(
  Schema.Struct({
    jobId: jobIdSchema.annotate({ description: 'Job id from a board row.' }),
    from: Schema.optional(
      Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)).annotate({
        description: 'Absolute byte offset to resume from; omit for the retained head.',
      }),
    ),
  }),
)
const killInputSchema = apiSchema(
  Schema.Struct({
    jobId: jobIdSchema.annotate({ description: 'Job id of a running job.' }),
    confirm: Schema.Literal(true).annotate({ description: 'Must be true: stopping another Session’s background job is destructive.' }),
  }),
)
const emptyInputSchema = apiSchema(Schema.Struct({}))

export const backgroundJobsApi = defineApi({
  id: 'background-jobs',
  version: 1,
  owner: '@dshfiles/background-jobs',
  methods: {
    board: method({
      input: apiSchema(jobBoardFilterSchema),
      output: apiSchema(jobBoardSchema),
      description:
        'List background jobs across every Session on this Host: what is still running and, opt-in, what already finished. Rows carry a category derived from the job kind and label. Read-only.',
      tool: { name: 'background_jobs_board', readOnly: true, render: compactJson },
    }),
    output: method({
      input: outputInputSchema,
      output: apiSchema(jobOutputSchema),
      description:
        'Read one job’s retained output without consuming the model cursor. Only jobs of the current DSH process keep an output ring; an earlier process leaves the lifecycle record alone. Read-only.',
      tool: { name: 'background_jobs_output', readOnly: true, render: compactJson },
    }),
    kill: method({
      input: killInputSchema,
      output: apiSchema(jobKillSchema),
      description:
        'Stop one running background job on the user’s behalf, identified by job id. Call only when the user asked to stop that job; pass confirm: true, which is required.',
      tool: { name: 'background_jobs_kill', readOnly: false, render: compactJson },
    }),
    refresh: method({
      input: emptyInputSchema,
      output: apiSchema(jobIndexingSchema),
      description: 'Index whatever the session logs gained since the last pass and report the indexing state. Call only when the user asked to re-index.',
      tool: { name: 'background_jobs_refresh', readOnly: false, render: compactJson },
    }),
    wait: method({
      input: apiSchema(jobWaitInputSchema),
      output: apiSchema(jobWaitSchema),
      description:
        'Block until background jobs settle instead of polling job_output or sleeping. Waits for the given jobIds, or for every job running when the call starts when jobIds is omitted. Returns the final status of each target and which are still running on timeout. Read-only.',
      tool: { name: 'background_jobs_wait', readOnly: true, render: compactJson },
    }),
  },
  events: {
    changed: event({
      schema: emptyInputSchema,
      description: 'The board changed: a job started, finished or wrote output, or history indexing found more. Read the board again.',
    }),
  },
})
