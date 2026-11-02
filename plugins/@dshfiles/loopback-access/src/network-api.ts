import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'

const portSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535))
const activePortSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535))

/** Compatibility with a still-running old Host: any stored flag (even an explicit undefined) reads back as desired localhost, which is always on. */
const localhostEnabledSchema = Schema.UndefinedOr(Schema.Boolean).pipe(
  Schema.decodeTo(Schema.Literal(true), {
    decode: SchemaGetter.transform<true, boolean | undefined>(() => true),
    encode: SchemaGetter.transform<boolean | undefined, true>(() => true),
  }),
  Schema.withDecodingDefaultKey(Effect.succeed(true)),
)

export const networkFormSchema = Schema.Struct({
  lanEnabled: Schema.Boolean,
  bindAddress: Schema.NullOr(Schema.String),
  localhostEnabled: localhostEnabledSchema,
  port: portSchema,
})

export type NetworkForm = typeof networkFormSchema.Type

export const networkSaveSchema = Schema.Struct({
  ...networkFormSchema.fields,
  localhostEnabled: Schema.Literal(true).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  expectedRevision: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

export const networkSnapshotSchema = Schema.Struct({
  revision: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  writable: Schema.Boolean,
  saved: networkFormSchema,
  active: Schema.Struct({
    host: Schema.String,
    port: activePortSchema,
    localhostEnabled: Schema.Boolean,
    urls: Schema.Array(Schema.String),
  }),
  addresses: Schema.Array(
    Schema.Struct({
      address: Schema.String,
      interfaceName: Schema.String,
      family: Schema.Literals(['IPv4', 'IPv6']),
    }),
  ),
  cliOverrides: Schema.Struct({ host: Schema.NullOr(Schema.String), port: Schema.NullOr(portSchema) }),
  pendingRestart: Schema.Boolean,
  integration: Schema.Literals(['managed', 'needs-setup', 'unsupported']),
  unavailableReason: Schema.NullOr(Schema.String),
})

export type NetworkSnapshot = typeof networkSnapshotSchema.Type

/** Interface discovery builds a mutable list; the decoded snapshot itself stays readonly. */
export type NetworkAddress = { -readonly [Key in keyof NetworkSnapshot['addresses'][number]]: NetworkSnapshot['addresses'][number][Key] }

/** The client decodes every snapshot at the boundary, so a malformed Host reply never reaches the form. */
export const decodeNetworkSnapshot = (value: unknown): NetworkSnapshot => Schema.decodeUnknownSync(networkSnapshotSchema)(value)
