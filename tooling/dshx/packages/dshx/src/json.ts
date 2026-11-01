import type { StandardSchemaV1 } from '@standard-schema/spec'
import * as Schema from 'effect/Schema'

/**
 * The one place dshx turns JSON text into a value: every parse names its owning
 * schema and is validated here, so no call site parses text directly. Declared
 * as the JSON boundary in `scripts/lint-ratchet.ts`.
 */
type EffectDecoder = Schema.ConstraintDecoder<unknown>
type StandardDecoder = StandardSchemaV1<unknown, unknown>
type JsonDecoder = EffectDecoder | StandardDecoder
type EffectDecodeResult<S extends EffectDecoder> = ReturnType<ReturnType<typeof Schema.decodeUnknownResult<S>>>
type StandardDecodeResult<Output> = { readonly success: true; readonly data: Output } | { readonly success: false; readonly error: unknown }
type JsonDecodeIssue = StandardSchemaV1.Issue

const isEffectDecoder = (schema: JsonDecoder): schema is EffectDecoder => Schema.isSchema(schema)

const decodeStandard = <S extends StandardDecoder>(schema: S, value: unknown): StandardSchemaV1.InferOutput<S> => {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) throw new Error('JSON decoding requires a synchronous Standard Schema validator.')
  if (result.issues !== undefined) throw new Error(result.issues.map((issue: JsonDecodeIssue) => issue.message).join('; '))
  return result.value
}

export function decodeJson<S extends EffectDecoder>(schema: S, text: string): S['Type']
export function decodeJson<S extends StandardDecoder>(schema: S, text: string): StandardSchemaV1.InferOutput<S>
export function decodeJson(schema: JsonDecoder, text: string) {
  const value: unknown = JSON.parse(text)
  if (isEffectDecoder(schema)) return Schema.decodeUnknownSync(schema)(value)
  return decodeStandard(schema, value)
}

export function decodeJsonSafe<S extends EffectDecoder>(schema: S, text: string): EffectDecodeResult<S>
export function decodeJsonSafe<S extends StandardDecoder>(schema: S, text: string): StandardDecodeResult<StandardSchemaV1.InferOutput<S>>
export function decodeJsonSafe(schema: JsonDecoder, text: string) {
  const value: unknown = JSON.parse(text)
  if (isEffectDecoder(schema)) return Schema.decodeUnknownResult(schema)(value)
  try {
    return { success: true, data: decodeStandard(schema, value) }
  } catch (error) {
    return { success: false, error }
  }
}

export type JsonValue = Schema.Json

export const jsonValueSchema: Schema.Codec<JsonValue> = Schema.Json

export type JsonObject = Schema.JsonObject

export const jsonObjectSchema: Schema.Codec<JsonObject> = Schema.JsonObject
