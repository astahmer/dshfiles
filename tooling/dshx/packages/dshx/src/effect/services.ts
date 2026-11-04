/**
 * Compatibility entry for `@dshfiles/dshx/effect/services`. Each standard service lives in its own subpath
 * (`@dshfiles/dshx/effect/<name>`); import from there. `child-process-spawner` and `llm` are left out because they
 * import Host packages a plugin must declare itself.
 */
import { Context, Effect, Layer, Schema } from 'effect'
import type { SettingsScope } from '../settings/protocol-2.js'

export { Communication, CommunicationFailed, liftPromiseClient } from './communication.js'
export { HostApis, HostApis as HostApiClient } from './host-apis.js'
export { HostTerminal, HostTerminalFailed } from './host-terminal.js'
export { KeyedMutex } from './keyed-mutex.js'
export { PluginStorage, PluginStorageFailed, PluginStorageInvalidInput } from './plugin-storage.js'
export { Settings, SettingsConflict, SettingsUnavailable, SettingsWriteFailed } from './settings.js'
export { StorageDomain, StorageDomainOpenFailed, StorageDomainReadFailed, StorageDomainWriteFailed } from './storage-domain.js'

/** @deprecated Each service now fails with its own tagged error; this remains for `SettingsRead`. */
export class EffectHostServiceError extends Schema.TaggedError<EffectHostServiceError>()('EffectHostServiceError', {
  service: Schema.Literals(['plugin-storage', 'secret-values', 'subprocess', 'host-api-client', 'communication', 'settings-read']),
  operation: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

interface SettingsReadShape<Value extends object> {
  get(): Effect.Effect<Value, EffectHostServiceError>
}

/** @deprecated Use `Settings.Tag(namespace)` with `Settings.layer(contract)`. */
export interface SettingsReadTag<Value extends object> extends Context.Service<SettingsReadTag<Value>, SettingsReadShape<Value>> {}

/** @deprecated Use `Settings.Tag(namespace)` with `Settings.layer(contract)`. */
export interface SettingsReadFactory<Value extends object> {
  readonly Tag: SettingsReadTag<Value>
  layer(scope: Pick<SettingsScope<Value>, 'get'>): Layer.Layer<SettingsReadTag<Value>>
}

const makeSettingsRead = <Value extends object>(namespace: string): SettingsReadFactory<Value> => {
  class SettingsReadService extends Context.Service<SettingsReadTag<Value>, SettingsReadShape<Value>>()(`@dshfiles/dshx/effect/SettingsRead/${namespace}`) {}
  return {
    Tag: SettingsReadService,
    layer: scope =>
      Layer.succeed(
        SettingsReadService,
        SettingsReadService.of({
          get: () => Effect.try({ try: () => scope.get(), catch: cause => new EffectHostServiceError({ service: 'settings-read', operation: 'get', cause }) }),
        }),
      ),
  }
}

/** @deprecated Use `Settings.Tag(namespace)` with `Settings.layer(contract)`. */
export const SettingsRead = { make: makeSettingsRead }
