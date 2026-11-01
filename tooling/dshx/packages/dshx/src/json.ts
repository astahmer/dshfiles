import * as Schema from 'effect/Schema'
import type * as z from 'zod'

/**
 * The one place dshx turns JSON text into a value: every parse names its owning
 * schema and is validated here, so no call site parses text directly. Declared
 * as the JSON boundary in `scripts/lint-ratchet.ts`.
 */
type EffectDecoder = Schema.ConstraintDecoder<unknown>
type ZodDecoder = z.ZodType
type JsonDecoder = EffectDecoder | ZodDecoder

type EffectDecodeResult<S extends EffectDecoder> = ReturnType<ReturnType<typeof Schema.decodeUnknownResult<S>>>

const isEffectDecoder = (schema: JsonDecoder): schema is EffectDecoder => Schema.isSchema(schema)

export function decodeJson<S extends EffectDecoder>(schema: S, text: string): S['Type']
export function decodeJson<S extends ZodDecoder>(schema: S, text: string): z.output<S>
export function decodeJson(schema: JsonDecoder, text: string) {
  const value: unknown = JSON.parse(text)
  if (isEffectDecoder(schema)) return Schema.decodeUnknownSync(schema)(value)
  return schema.parse(value)
}

export function decodeJsonSafe<S extends EffectDecoder>(schema: S, text: string): EffectDecodeResult<S>
export function decodeJsonSafe<S extends ZodDecoder>(schema: S, text: string): z.ZodSafeParseResult<z.output<S>>
export function decodeJsonSafe(schema: JsonDecoder, text: string) {
  const value: unknown = JSON.parse(text)
  if (isEffectDecoder(schema)) return Schema.decodeUnknownResult(schema)(value)
  return schema.safeParse(value)
}

export type JsonValue = Schema.Json

export const jsonValueSchema: Schema.Codec<JsonValue> = Schema.Json

export type JsonObject = Schema.JsonObject

export const jsonObjectSchema: Schema.Codec<JsonObject> = Schema.JsonObject
