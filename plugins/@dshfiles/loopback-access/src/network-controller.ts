import { isDeepStrictEqual } from 'node:util'
import { networkInterfaces } from 'node:os'
import { bindUrlHost, isLoopbackHost } from '@deepseek-ai/dsh-host-webserver'
import { Context, Effect, Layer, Option, Schema, Semaphore } from 'effect'
import { LoopbackAdjunct, NetworkHost, type NetworkSettingsReplaceFailed } from './host-edge-promise.js'
import type { networkSaveSchema, NetworkAddress, NetworkForm, NetworkSnapshot } from './network-api.js'
import { NetworkPreferencesModel, type NetworkPreferences } from './network-preferences.js'

export class NetworkSettingsUnavailable extends Schema.TaggedError<NetworkSettingsUnavailable>()(
  'NetworkSettingsUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'network-settings-unavailable' },
) {
  override get message(): string {
    return 'Network startup preferences are unavailable. Restart DSH to load the updated plugin.'
  }
}

export class WebListenerUninitialized extends Schema.TaggedError<WebListenerUninitialized>()(
  'WebListenerUninitialized',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'web-listener-uninitialized' },
) {
  override get message(): string {
    return 'The native Web listener has not initialized. Reload the page once DSH finishes starting.'
  }
}

export class NetworkSettingsReadOnly extends Schema.TaggedError<NetworkSettingsReadOnly>()(
  'NetworkSettingsReadOnly',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'network-settings-read-only' },
) {
  override get message(): string {
    return this.reason
  }
}

export class NetworkSettingsConflict extends Schema.TaggedError<NetworkSettingsConflict>()(
  'NetworkSettingsConflict',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'network-settings-conflict' },
) {
  override get message(): string {
    return 'Network settings changed elsewhere. Reload the page before saving again.'
  }
}

export class NetworkAddressUnavailable extends Schema.TaggedError<NetworkAddressUnavailable>()(
  'NetworkAddressUnavailable',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'network-address-unavailable' },
) {
  override get message(): string {
    return 'The selected LAN address is no longer available. Choose a current interface address.'
  }
}

export class NetworkSettingsSaveFailed extends Schema.TaggedError<NetworkSettingsSaveFailed>()(
  'NetworkSettingsSaveFailed',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'network-settings-save-failed' },
) {
  override get message(): string {
    return 'Network settings could not be saved. Check that the profile settings file is writable, then retry.'
  }
}

export type NetworkReadFailure = NetworkSettingsUnavailable | WebListenerUninitialized
export type NetworkSaveFailure = NetworkReadFailure | NetworkSettingsReadOnly | NetworkSettingsConflict | NetworkAddressUnavailable | NetworkSettingsSaveFailed

const rawObject = Schema.Record(Schema.String, Schema.Unknown)
const expression = Schema.Struct({ __jsExpr: Schema.String })
const settingsConflictCause = Schema.Struct({ code: Schema.Literal('SETTINGS_CONFLICT') })

/** Only our explicit native startup delegation is managed; never reinterpret custom profile code. */
const isManagedNetworkConfiguration = (value: typeof rawObject.Type): boolean => {
  if (Object.hasOwn(value, '__jsExpr')) return false
  const host = Schema.decodeUnknownOption(expression, { onExcessProperty: 'error' })(value.host)
  const port = Schema.decodeUnknownOption(expression, { onExcessProperty: 'error' })(value.port)
  return (
    Option.isSome(host) &&
    Option.isSome(port) &&
    host.value.__jsExpr.startsWith('ctx.webStartup.host ?? ctx.dshfilesNetworkStartup.host ??') &&
    port.value.__jsExpr.startsWith('ctx.webStartup.port ?? ctx.dshfilesNetworkStartup.port ??')
  )
}

const localNetworkAddresses = (): NetworkSnapshot['addresses'] => {
  const result: NetworkAddress[] = []
  const seen = new Set<string>()
  for (const [interfaceName, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      // Scoped link-local IPv6 cannot form a browser URL in the stock Web app.
      if (entry.internal || (entry.family === 'IPv6' && entry.scopeid !== 0) || bindUrlHost(entry.address) === undefined || seen.has(entry.address)) continue
      if (entry.family !== 'IPv4' && entry.family !== 'IPv6') continue
      seen.add(entry.address)
      result.push({ address: entry.address, interfaceName, family: entry.family })
      if (result.length >= 128) return result
    }
  }
  return result.sort(
    (left, right) =>
      left.family.localeCompare(right.family) || left.interfaceName.localeCompare(right.interfaceName) || left.address.localeCompare(right.address),
  )
}

const preferencesToForm = (preferences: Readonly<NetworkPreferences>, host: string, port: number): NetworkForm => ({
  lanEnabled: preferences.lanEnabled ?? !isLoopbackHost(host),
  bindAddress: preferences.bindAddress ?? (isLoopbackHost(host) ? null : host),
  localhostEnabled: true,
  port: preferences.port ?? port,
})

const intendedBinding = (form: NetworkForm) => ({
  host: form.lanEnabled ? form.bindAddress : '127.0.0.1',
  port: form.port,
})

const saveFailure = (error: NetworkSettingsReplaceFailed) =>
  Option.isSome(Schema.decodeUnknownOption(settingsConflictCause)(error.cause))
    ? new NetworkSettingsConflict({ cause: error })
    : new NetworkSettingsSaveFailed({ cause: error })

/** The Network access section: what the running listener is, what the user saved for the next startup, and saving it. */
export class NetworkAccess extends Context.Service<
  NetworkAccess,
  {
    readonly snapshot: Effect.Effect<NetworkSnapshot, NetworkReadFailure>
    readonly save: (input: typeof networkSaveSchema.Type) => Effect.Effect<NetworkSnapshot, NetworkSaveFailure>
  }
>()('@dshfiles/loopback-access/NetworkAccess') {
  static readonly layer = Layer.effect(
    NetworkAccess,
    Effect.gen(function* () {
      const network = yield* NetworkHost
      const adjunct = yield* LoopbackAdjunct
      const saving = yield* Semaphore.make(1)

      const snapshot = Effect.gen(function* () {
        const descriptor = yield* Effect.flatMap(
          network.descriptor,
          Option.match({ onNone: () => Effect.fail(new NetworkSettingsUnavailable({})), onSome: Effect.succeed }),
        )
        const listener = yield* network.listener
        const port = listener.port
        if (port === undefined) return yield* new WebListenerUninitialized({})
        const saved = preferencesToForm(NetworkPreferencesModel.decode(descriptor.value), listener.host, port)
        const applied = preferencesToForm(network.boot.preferences, listener.host, port)
        const current = yield* adjunct.status
        const config = yield* network.webserverConfig
        const raw = Option.flatMap(config, Schema.decodeUnknownOption(rawObject))
        const managed = Option.isSome(config) && Option.isSome(raw) && isManagedNetworkConfiguration(raw.value)
        const unsupported = Option.isNone(config) || Option.isNone(raw) || Object.hasOwn(raw.value, '__jsExpr')
        const overrides = yield* network.cliOverrides
        const result: NetworkSnapshot = {
          revision: descriptor.revision,
          writable: (yield* network.settingsWritable) && managed,
          saved,
          active: {
            host: listener.host,
            port,
            localhostEnabled: isLoopbackHost(listener.host) || current.state === 'forwarding',
            urls: [...new Set([current.upstreamOrigin, current.localhostOrigin].filter((origin): origin is string => origin !== null))],
          },
          addresses: localNetworkAddresses(),
          cliOverrides: { host: overrides.host ?? null, port: overrides.port ?? null },
          pendingRestart: !isDeepStrictEqual(intendedBinding(saved), intendedBinding(applied)),
          integration: managed ? 'managed' : unsupported ? 'unsupported' : 'needs-setup',
          unavailableReason: managed
            ? null
            : 'This profile overrides the native network configuration. Install the Network access startup wiring and restart DSH before editing it here.',
        }
        return result
      }).pipe(Effect.withSpan('network access snapshot'))

      const save = Effect.fn('network access save')(function* (input: typeof networkSaveSchema.Type) {
        const before = yield* snapshot
        if (!before.writable) return yield* new NetworkSettingsReadOnly({ reason: before.unavailableReason ?? 'Network settings are read-only on this Host.' })
        if (before.revision !== input.expectedRevision) return yield* new NetworkSettingsConflict({})
        if (input.lanEnabled && !before.addresses.some(item => item.address === input.bindAddress)) return yield* new NetworkAddressUnavailable({})
        const preferences = NetworkPreferencesModel.normalize({ lanEnabled: input.lanEnabled, bindAddress: input.bindAddress, port: input.port })
        // Every owned field is volatile: only desired preferences change. The upstream startup provider and native
        // listener retain their boot values. Replace the owned section so a legacy localhost flag is not persisted again.
        yield* network.replace(preferences, input.expectedRevision).pipe(Effect.mapError(saveFailure))
        return yield* snapshot
      }, saving.withPermits(1))

      return NetworkAccess.of({ snapshot, save })
    }),
  )
}
