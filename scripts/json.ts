import { Result, Schema } from 'effect'

/**
 * The one place repository scripts turn JSON text into a value: every parse goes
 * through here with the owning schema, so untrusted manifests, reports and log
 * lines are validated before use. Declared as the JSON boundary in
 * `scripts/lint-ratchet.ts`; nothing else under `scripts/` calls `JSON.parse`.
 */
export class ScriptJson {
  static readonly decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, text: string): S['Type'] =>
    Schema.decodeUnknownSync(schema)(JSON.parse(text))

  static readonly decodeUnknownSafe = <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    input: unknown,
  ): { readonly success: true; readonly data: S['Type'] } | { readonly success: false; readonly error: Schema.SchemaError } => {
    const result = Schema.decodeUnknownResult(schema)(input)
    return Result.isSuccess(result) ? { success: true, data: result.success } : { success: false, error: result.failure }
  }

  static readonly decodeJsonSafe = <S extends Schema.ConstraintDecoder<unknown>>(
    schema: S,
    text: string,
  ): { readonly success: true; readonly data: S['Type'] } | { readonly success: false; readonly error: Schema.SchemaError } =>
    ScriptJson.decodeUnknownSafe(schema, JSON.parse(text))
}
