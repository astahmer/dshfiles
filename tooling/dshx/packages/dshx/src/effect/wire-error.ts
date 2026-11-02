import { Cause, Option, Schema, SchemaAST } from 'effect'
import { ApiProtocolModel, PluginApiError } from '../api/common.js'

declare module 'effect/Schema' {
  namespace Annotations {
    interface Augment {
      /**
       * Expose this error class to API callers under this code: the Client receives the code, the message and the
       * JSON-encoded fields as `details`. Errors without it stay internal to the Host.
       */
      readonly dshxWireCode?: string | undefined
    }
  }
}

/** What one failed Effect run becomes for its caller. */
export type WireFailure =
  | { readonly kind: 'aborted' }
  | { readonly kind: 'exposed'; readonly error: PluginApiError }
  | { readonly kind: 'legacy-tagged'; readonly tag: string; readonly error: PluginApiError }
  | { readonly kind: 'internal'; readonly report: string }

const taggedFailure = Schema.Struct({ _tag: Schema.String, message: Schema.optional(Schema.String) })
const isTaggedFailure = Schema.is(taggedFailure)
const decodeDetails = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const wireCodeOf = SchemaAST.resolveAt<string>('dshxWireCode')

/** `NotFound` → `not-found`: the code an unannotated tagged failure had before wire codes were opt-in. */
const legacyCode = (tag: string): string =>
  tag
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .toLowerCase()
    .replace(/^-+|-+$/gu, '')

const encodedDetails = (schema: Schema.Codec<unknown, unknown>, error: unknown): Readonly<Record<string, unknown>> | undefined =>
  Option.getOrUndefined(Option.flatMap(Schema.encodeUnknownOption(Schema.toCodecJson(schema))(error), decodeDetails))

/** Contract errors are Schema error classes; their encoding needs no services. */
const isErrorClass = (value: unknown): value is Schema.Codec<unknown, unknown> => Schema.isSchema(value)

const exposedFailure = (error: unknown): PluginApiError | undefined => {
  if (ApiProtocolModel.isPluginApiError(error)) return error
  if (typeof error !== 'object' || error === null || !isErrorClass(error.constructor)) return undefined
  const code = wireCodeOf(error.constructor.ast)
  if (code === undefined) return undefined
  const message = error instanceof Error && error.message !== '' ? error.message : code
  return new PluginApiError(message, { code, details: encodedDetails(error.constructor, error), cause: error })
}

const internal = (cause: Cause.Cause<unknown>): WireFailure => ({ kind: 'internal', report: Cause.pretty(cause) })

/**
 * Map a failed run to what its caller may see. Interruption alone is an abort; a failure whose Schema class carries
 * `dshxWireCode` (or a `PluginApiError`) is exposed with its code, message and encoded fields; any other typed
 * failure with a `_tag` keeps its old kebab-case code for compatibility; defects and everything else stay internal.
 */
export const wireFailure = (cause: Cause.Cause<unknown>): WireFailure => {
  if (Cause.hasInterruptsOnly(cause)) return { kind: 'aborted' }
  const failure = Cause.findErrorOption(cause)
  const defect = Cause.findDefect(cause)
  const defectError = defect._tag === 'Success' ? defect.success : undefined
  if (Option.isNone(failure)) {
    return ApiProtocolModel.isPluginApiError(defectError) ? { kind: 'exposed', error: defectError } : internal(cause)
  }
  const exposed = exposedFailure(failure.value)
  if (exposed !== undefined) return { kind: 'exposed', error: exposed }
  if (!isTaggedFailure(failure.value)) return internal(cause)
  const tag = failure.value._tag
  const message = failure.value.message === undefined || failure.value.message === '' ? tag : failure.value.message
  return { kind: 'legacy-tagged', tag, error: new PluginApiError(message, { code: legacyCode(tag), cause: failure.value }) }
}

/** The internal failure the Host logs: `Cause.pretty` of the run, never sent to the caller. */
export class EffectHandlerFailure extends Error {
  override readonly name = 'EffectHandlerFailure'

  constructor(report: string) {
    super(report)
    this.stack = `${this.name}: ${report}`
  }
}

const warnedTags = new Set<string>()

/**
 * What an API handler throws for a failed run, so the Host dispatch maps it as before: `aborted`, an exposed
 * `PluginApiError`, or an internal failure it logs. An unannotated tagged failure warns once per tag.
 */
export const thrownForApi = (input: {
  readonly cause: Cause.Cause<unknown>
  readonly apiId: string
  readonly method: string
  readonly warn: (message: string) => void
}): Error => {
  const failure = wireFailure(input.cause)
  if (failure.kind === 'aborted') return ApiProtocolModel.aborted(input.apiId, input.method)
  if (failure.kind === 'exposed') return failure.error
  if (failure.kind === 'internal') return new EffectHandlerFailure(failure.report)
  if (!warnedTags.has(failure.tag)) {
    warnedTags.add(failure.tag)
    input.warn(
      `${input.apiId}.${input.method} failed with ${failure.tag}, which reaches the caller as "${failure.error.code}" only for compatibility. Annotate its class with { dshxWireCode: '${failure.error.code}' } to keep exposing it, or handle it so it stays internal.`,
    )
  }
  return failure.error
}
