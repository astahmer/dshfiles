import { Settings } from '@dshfiles/dshx/effect/settings'
import { Context, Effect, Layer, Stream } from 'effect'
import { AccountSettingsModel, aiAccountsSettings, type AccountSettingsSnapshot, type AiAccountsSettingsValue } from './settings.js'

const AiAccountsSettings = Settings.Tag<AiAccountsSettingsValue>(aiAccountsSettings.namespace)

/** The Host-side account preferences, read from the live `ai-accounts` namespace and refreshed on every commit. */
export class AccountSettings extends Context.Service<
  AccountSettings,
  {
    readonly current: Effect.Effect<AccountSettingsSnapshot>
    /** The current preferences, then every committed change. */
    readonly changes: Stream.Stream<AccountSettingsSnapshot>
  }
>()('@dshfiles/ai-accounts/AccountSettings') {
  static readonly layer = Layer.effect(
    AccountSettings,
    Effect.gen(function* () {
      const settings = yield* AiAccountsSettings
      return AccountSettings.of({
        current: Effect.map(settings.get, AccountSettingsModel.fromLive),
        changes: Stream.map(settings.changes, AccountSettingsModel.fromLive),
      })
    }),
  ).pipe(Layer.provide(Settings.layer(aiAccountsSettings)))
}
