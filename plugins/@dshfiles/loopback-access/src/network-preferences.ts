import { isLoopbackHost, isWildcardHost, normalizeBindAddress } from '@deepseek-ai/dsh-host-webserver'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { LoopbackSchema } from './schema.js'

export const NETWORK_SETTINGS_NAMESPACE = 'dshfiles-network-startup'

const lanAddressSchema = LoopbackSchema.trimmedString.check(
  Schema.makeFilter((value: string) => {
    try {
      NetworkPreferencesModel.normalizeLanAddress(value)
      return undefined
    } catch {
      return 'Choose a concrete non-loopback IPv4 or IPv6 address.'
    }
  }),
)

/** A field an older profile may omit: missing decodes to the inherited value, while a malformed value still fails. */
const defaulted = <S extends Schema.Top>(schema: S, value: S['Encoded']) => schema.pipe(Schema.withDecodingDefaultKey(Effect.succeed(value)))

const portSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(65_535))

const preferencesRowSchema = Schema.Struct({
  lanEnabled: defaulted(Schema.NullOr(Schema.Boolean), null),
  bindAddress: defaulted(Schema.NullOr(lanAddressSchema), null),
  port: defaulted(Schema.NullOr(portSchema), null),
  // Read old profiles without retaining an editable localhost preference.
  localhostEnabled: Schema.optional(Schema.Boolean),
})

/** Null means inherit the native profile fallback, not an explicit disabled state. */
export const preferencesSchema = preferencesRowSchema.check(
  Schema.makeFilter((value: typeof preferencesRowSchema.Type) =>
    value.lanEnabled === true && value.bindAddress === null
      ? { path: ['bindAddress'], issue: 'Choose an interface address before enabling LAN access.' }
      : undefined,
  ),
)

type StoredNetworkPreferences = typeof preferencesSchema.Type

export interface NetworkPreferences {
  lanEnabled: boolean | null
  bindAddress: string | null
  port: number | null
}

export type NetworkPreferencesInput = typeof preferencesSchema.Encoded

export interface NetworkStartupValues {
  readonly preferences: Readonly<NetworkPreferences>
  readonly host: string | null
  readonly port: number | null
}

export class NetworkPreferencesModel {
  /** A concrete, non-loopback interface address; interface discovery belongs to the caller. */
  static normalizeLanAddress(value: string): string {
    const address = value.trim()
    // Validate with the same parser as the native listener. Keep an IPv6 zone selector intact.
    normalizeBindAddress(address)
    if (isWildcardHost(address) || isLoopbackHost(address)) {
      throw new Error('Choose a concrete non-loopback interface address for LAN access.')
    }
    return address
  }

  /** The owned preferences only: a legacy localhost flag is read, then dropped from the stored row. */
  static normalize(input: NetworkPreferencesInput): NetworkPreferences {
    const stored = Schema.decodeUnknownSync(preferencesSchema, { onExcessProperty: 'error' })(input)
    return { lanEnabled: stored.lanEnabled, bindAddress: stored.bindAddress, port: stored.port }
  }

  /** The settings section hands back unknown JSON; decode it once, then keep only the owned preferences. */
  // oxlint-disable-next-line antislop/no-unknown-parameters -- this is the settings boundary: the stored row is unknown
  static decode(value: unknown): NetworkPreferences {
    const stored: StoredNetworkPreferences = Schema.decodeUnknownSync(preferencesSchema, { onExcessProperty: 'error' })(value)
    return { lanEnabled: stored.lanEnabled, bindAddress: stored.bindAddress, port: stored.port }
  }

  /** Capture detached boot values. Saving desired settings never mutates this snapshot. */
  static startupValues(input: NetworkPreferences): NetworkStartupValues {
    const preferences = Object.freeze(NetworkPreferencesModel.normalize(input))
    return Object.freeze({
      preferences,
      host: preferences.lanEnabled === null ? null : preferences.lanEnabled ? preferences.bindAddress : '127.0.0.1',
      port: preferences.port,
    })
  }
}
