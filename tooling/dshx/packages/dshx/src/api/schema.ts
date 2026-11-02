import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as Schema from 'effect/Schema'

export type EffectApiSchemaShape<Input = unknown, Output = Input> = {
  readonly Encoded: Input
  readonly Type: Output
  readonly DecodingServices: never
  readonly EncodingServices: unknown
}

export type ApiSchemaConverter = (schema: EffectApiSchemaShape) => StandardSchemaV1

let effectSchemaConverter: ApiSchemaConverter | undefined
const normalizedSchemas = new WeakMap<object, StandardSchemaV1>()

export const registerEffectApiSchemaConverter = (converter: ApiSchemaConverter): void => {
  effectSchemaConverter = converter
}

export const resolveApiSchema = <Input = unknown, Output = Input>(schema: unknown): StandardSchemaV1<Input, Output> => {
  if ((typeof schema !== 'object' && typeof schema !== 'function') || schema === null) throw new TypeError('API schema must be a schema object or function.')
  const cached = normalizedSchemas.get(schema)
  if (cached !== undefined) return cached as StandardSchemaV1<Input, Output>
  if ('~standard' in schema) {
    const standard = schema['~standard']
    if (typeof standard === 'object' && standard !== null && 'validate' in standard && typeof standard.validate === 'function') {
      return schema as StandardSchemaV1<Input, Output>
    }
  }
  if (effectSchemaConverter === undefined) {
    if (Schema.isSchema(schema)) {
      const convertedSchema = Schema.toStandardSchemaV1(schema as Schema.Codec<unknown, unknown>)
      normalizedSchemas.set(schema, convertedSchema)
      return convertedSchema as StandardSchemaV1<Input, Output>
    }
    throw new TypeError('API schema must be a Standard Schema, an Effect Schema, or a schema registered by @dshfiles/dshx/effect.')
  }
  const converted = effectSchemaConverter(schema as EffectApiSchemaShape)
  normalizedSchemas.set(schema, converted)
  return converted as StandardSchemaV1<Input, Output>
}
