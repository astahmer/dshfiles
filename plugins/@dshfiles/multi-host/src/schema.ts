import * as Schema from 'effect/Schema'
import * as SchemaAST from 'effect/SchemaAST'
import * as JsonSchema from 'effect/JsonSchema'

export const passthrough = <S extends Schema.StructWithRest.Objects>(schema: S) => Schema.StructWithRest(schema, [Schema.Record(Schema.String, Schema.Unknown)])

export const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown, options?: SchemaAST.ParseOptions): S['Type'] =>
  Schema.decodeUnknownSync(schema, options)(input)

export const safeDecode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown, options?: SchemaAST.ParseOptions) => {
  const result = Schema.decodeUnknownResult(schema, options)(input)
  if (result._tag === 'Success') return { success: true as const, data: result.success }
  return { success: false as const, error: new Error(result.failure.message) }
}

export const strictStandardSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => {
  const standardSchema = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
  const standardJsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
  const inputDocument = Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

  return {
    ast: schema.ast,
    '~standard': {
      ...standardSchema['~standard'],
      jsonSchema: {
        ...standardJsonSchema,
        input: (options: Parameters<typeof standardJsonSchema.input>[0]) => {
          const standardDocument = standardJsonSchema.input(options)
          const document = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(inputDocument) : inputDocument
          return {
            ...standardDocument,
            ...document.schema,
            ...(Object.keys(document.definitions).length > 0
              ? options.target === 'draft-07'
                ? { definitions: document.definitions }
                : { $defs: document.definitions }
              : {}),
          }
        },
      },
    },
  }
}

export const decodeStrict = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): S['Type'] =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(input)

export const safeDecodeStrict = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown) =>
  safeDecode(schema, input, { onExcessProperty: 'error' })

const utcDateTimePattern =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$/u

export const dateTimeString = Schema.String.check(
  Schema.makeFilter(value => (utcDateTimePattern.test(value) ? true : 'Invalid datetime'), {
    toJsonSchema: () => ({ format: 'date-time', pattern: utcDateTimePattern.source }),
  }),
)

export const urlString = Schema.String.check(
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
