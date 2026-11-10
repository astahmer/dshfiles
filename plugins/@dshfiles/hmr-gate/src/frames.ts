/** One `/plugins/events` frame, decoded once before the gate acts on it. */
import { Option } from 'effect'
import * as Schema from 'effect/Schema'
import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'

const deferredPackageSchema = Schema.Struct({ id: Schema.NonEmptyString, reason: Schema.NonEmptyString })

const frameSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('graph'), graph: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal('rebuilt'), id: Schema.NonEmptyString, rev: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal('deferred'), packages: Schema.Array(deferredPackageSchema).check(Schema.isMaxLength(64)) }),
])

export type DeferredPackage = typeof deferredPackageSchema.Type

export type HmrFrame = typeof frameSchema.Type

/**
 * Decode one stream `message` payload.
 * @param data - raw event data served by the HMR route.
 * @returns the frame, or undefined for a malformed one the gate must ignore.
 */
export const decodeFrame = (data: string): HmrFrame | undefined => {
  let decoded: JsonValue
  try {
    decoded = decodeJson(jsonValueSchema, data)
  } catch {
    return undefined
  }
  return Option.getOrUndefined(Schema.decodeUnknownOption(frameSchema)(decoded))
}
