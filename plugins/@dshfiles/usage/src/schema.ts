import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { method as defineMethod } from '@dshfiles/dshx/api'
import * as JsonSchema from 'effect/JsonSchema'
import type * as SchemaTypes from 'effect/Schema'
import * as Schema from 'effect/Schema'

const documentOf = (schema: SchemaTypes.ConstraintDecoder<unknown>, strict: boolean) =>
  strict ? Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' }) : Schema.toJsonSchemaDocument(schema)

const publishedDocument = (document: ReturnType<typeof documentOf>, options: { readonly target: string }) => {
  const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
  if (Object.keys(built.definitions).length === 0) return { ...built.schema }
  return { ...built.schema, [options.target === 'draft-07' ? 'definitions' : '$defs']: built.definitions }
}

const standardView = <ValueSchema extends SchemaTypes.ConstraintDecoder<unknown>>(schema: ValueSchema, strict: boolean) => {
  const standard = strict ? Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } }) : Schema.toStandardSchemaV1(schema)
  const jsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const document = documentOf(schema, strict)
  const published = (options: Parameters<typeof jsonSchema.input>[0]) => {
    const built = publishedDocument(document, options)
    // An empty Struct publishes `not: null`, which the tool projector drops; publish the closed empty object instead.
    if (Object.keys(built).length === 1 && 'not' in built) return { type: 'object', properties: {}, additionalProperties: false }
    return built
  }
  return { ast: schema.ast, '~standard': { ...standard['~standard'], jsonSchema: { ...jsonSchema, input: published, output: published } } }
}

/** The schema rules this plugin's contracts share: the trimmed text input and the strict contract view. */
export class UsageSchema {
  /** `z.string().trim()`: the decoded value is trimmed, so every check below measures the value a caller will store. */
  static readonly trimmedText = Schema.String.pipe(Schema.decodeTo(Schema.Trim))

  /** A contract input: unknown keys are refused, the rule the old `z.object(...).strict()` carried. */
  static readonly contractInput = <ValueSchema extends SchemaTypes.ConstraintDecoder<unknown>>(schema: ValueSchema) => standardView(schema, true)

  /** A contract output: unknown keys are stripped, the rule a plain `z.object(...)` carried, so an older Host's extra fields do not fail a newer client. */
  static readonly contractOutput = <ValueSchema extends SchemaTypes.ConstraintDecoder<unknown>>(schema: ValueSchema) => standardView(schema, false)

  /** One contract method from Effect schemas: the input decodes strictly, the output leniently, both publish through the standard shape. */
  static readonly method = <const Input extends SchemaTypes.ConstraintDecoder<unknown>, const Output extends SchemaTypes.ConstraintDecoder<unknown>>(
    options: Omit<ApiMethodOptions<Input, Output>, 'input' | 'output' | 'tool'> & {
      readonly input: Input
      readonly output: Output
      readonly tool?: ApiToolExposure<Output['Type']>
    },
  ) => defineMethod({ ...options, input: UsageSchema.contractInput(options.input), output: UsageSchema.contractOutput(options.output) })
}
