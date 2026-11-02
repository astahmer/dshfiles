import * as Schema from 'effect/Schema'
import * as SchemaAST from 'effect/SchemaAST'
import * as JsonSchema from 'effect/JsonSchema'

const passthrough = <S extends Schema.StructWithRest.Objects>(schema: S) => Schema.StructWithRest(schema, [Schema.Record(Schema.String, Schema.Unknown)])

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown, options?: SchemaAST.ParseOptions): S['Type'] =>
  Schema.decodeUnknownSync(schema, options)(input)

const safeDecode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown, options?: SchemaAST.ParseOptions) => {
  const result = Schema.decodeUnknownResult(schema, options)(input)
  if (result._tag === 'Success') return { success: true as const, data: result.success }
  return { success: false as const, error: new Error(result.failure.message) }
}

const strictStandardSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const standardSchema = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const standardJsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const inputDocument = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

  /** An empty input publishes no usable schema: `Void` is `type: null` and an empty Struct is `not: null`. */
  const emptyObject = { type: 'object', properties: {}, additionalProperties: false }
  const published = (options: Parameters<typeof standardJsonSchema.input>[0]) => {
    if (schema.ast === Schema.Void.ast) return emptyObject
    const standardDocument = standardJsonSchema.input(options)
    const document = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(inputDocument) : inputDocument
    if (Object.keys(document.schema).length === 1 && 'not' in document.schema) return emptyObject
    if (Object.keys(document.definitions).length === 0) return { ...standardDocument, ...document.schema }
    if (options.target === 'draft-07') return { ...standardDocument, ...document.schema, definitions: document.definitions }
    return { ...standardDocument, ...document.schema, $defs: document.definitions }
  }

  return {
    ast: schema.ast,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        ...standardJsonSchema,
        input: published,
      },
    },
  }
}

const decodeStrict = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): S['Type'] =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(input)

const safeDecodeStrict = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) => safeDecode(schema, input, { onExcessProperty: 'error' })

const utcDateTimePattern =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$/u

const dateTimeString = Schema.String.check(
  Schema.makeFilter(value => (utcDateTimePattern.test(value) ? true : 'Invalid datetime'), {
    toJsonSchema: () => ({ format: 'date-time', pattern: utcDateTimePattern.source }),
  }),
)

const urlString = Schema.String.check(
  Schema.makeFilter(
    value => {
      try {
        new URL(value)
        return true
      } catch {
        return 'Invalid URL'
      }
    },
    { toJsonSchema: () => ({ format: 'uri' }) },
  ),
)

export class MultiHostSchema {
  static readonly passthrough = passthrough
  static readonly decode = decode
  static readonly safeDecode = safeDecode
  static readonly strictStandardSchema = strictStandardSchema
  static readonly decodeStrict = decodeStrict
  static readonly safeDecodeStrict = safeDecodeStrict
  static readonly dateTimeString = dateTimeString
  static readonly urlString = urlString
}
