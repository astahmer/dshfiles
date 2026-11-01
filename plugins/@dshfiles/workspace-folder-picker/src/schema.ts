import type { ApiMethodOptions, ApiToolExposure } from '@dshfiles/dshx/api'
import { method as defineMethod } from '@dshfiles/dshx/api'
import * as JsonSchema from 'effect/JsonSchema'
import type * as SchemaTypes from 'effect/Schema'
import * as Schema from 'effect/Schema'

const closedDocument = (schema: SchemaTypes.ConstraintDecoder<unknown>) => Schema.toJsonSchemaDocument(schema, { onExcessProperty: 'error' })

const publishedDocument = (document: ReturnType<typeof closedDocument>, options: { readonly target: string }) => {
  const built = options.target === 'draft-07' ? JsonSchema.toDocumentDraft07(document) : document
  if (Object.keys(built.definitions).length === 0) return { ...built.schema }
  return { ...built.schema, [options.target === 'draft-07' ? 'definitions' : '$defs']: built.definitions }
}

/** One message per form field, built from the first issue each field reports. */
export interface FormFieldErrors {
  repositoryUrl?: string
  parentPath?: string
  name?: string
}

/** The Standard Schema issue a form validator reports: one message, and the field path it belongs to. */
interface FormIssue {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined
}

/** The schema rules this plugin's contracts and forms share: trimmed text, the closed contract view, and form validation. */
export class WorkspaceFolderPickerSchema {
  /** `z.string().trim()`: the decoded value is trimmed, so every check below measures what will be stored. */
  static readonly trimmedText = Schema.String.pipe(Schema.decodeTo(Schema.Trim))

  /**
   * How this plugin's Effect schemas reach an API contract: the published tree is closed on both sides, so an agent tool
   * never advertises an input the Host would refuse, and decoding rejects unknown keys the way the old zod tree did.
   */
  static readonly strictContract = <ValueSchema extends SchemaTypes.ConstraintDecoder<unknown>>(schema: ValueSchema) => {
    const standard = Schema.toStandardSchemaV1(schema, { parseOptions: { onExcessProperty: 'error' } })
    const jsonSchema = Schema.toStandardJSONSchemaV1(schema)['~standard'].jsonSchema
    const document = closedDocument(schema)
    const published = (options: Parameters<typeof jsonSchema.input>[0]) => {
      const closed = publishedDocument(document, options)
      // An empty Struct publishes `not: null`, which the tool projector drops; publish the closed empty object instead.
      if (Object.keys(closed).length === 1 && 'not' in closed) return { type: 'object', properties: {}, additionalProperties: false }
      return closed
    }
    return {
      ast: schema.ast,
      '~standard': { ...standard['~standard'], jsonSchema: { ...jsonSchema, input: published, output: published } },
    }
  }

  /** One contract method from Effect schemas: input and output decode strictly and publish through the standard shape. */
  static readonly method = <const Input extends SchemaTypes.ConstraintDecoder<unknown>, const Output extends SchemaTypes.ConstraintDecoder<unknown>>(
    options: Omit<ApiMethodOptions<Input, Output>, 'input' | 'output' | 'tool'> & {
      readonly input: Input
      readonly output: Output
      readonly tool?: ApiToolExposure<Output['Type']>
    },
  ) =>
    defineMethod({
      ...options,
      input: WorkspaceFolderPickerSchema.strictContract(options.input),
      output: WorkspaceFolderPickerSchema.strictContract(options.output),
    })

  /** Validate form values with the same Standard Schema view the Host publishes and the agent tools enforce. */
  static readonly validateForm = <FormSchema extends SchemaTypes.ConstraintDecoder<unknown>>(
    schema: FormSchema,
    value: FormSchema['Type'],
  ): { readonly ok: true; readonly value: FormSchema['Type'] } | { readonly ok: false; readonly issues: readonly FormIssue[] } => {
    const result = Schema.toStandardSchemaV1(schema)['~standard'].validate(value)
    if (result instanceof Promise) throw new TypeError('Form values validate synchronously.')
    if (result.issues === undefined) return { ok: true, value: result.value }
    return { ok: false, issues: result.issues }
  }

  /** First message per field, so each input shows its own error instead of one summary of the whole form. */
  static readonly fieldMessages = (issues: readonly FormIssue[], fields: readonly (keyof FormFieldErrors)[]): FormFieldErrors => {
    const messages: FormFieldErrors = {}
    for (const issue of issues) {
      const segment = issue.path?.[0]
      const key = typeof segment === 'object' && segment !== null ? String(segment.key) : String(segment)
      const field = fields.find(candidate => candidate === key)
      if (field !== undefined && messages[field] === undefined) messages[field] = issue.message
    }
    return messages
  }
}
