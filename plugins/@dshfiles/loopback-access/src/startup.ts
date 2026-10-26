import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import schema from '@deepseek-ai/schemastery'
import {
  NETWORK_SETTINGS_NAMESPACE,
  NetworkPreferencesModel,
  preferencesSchema,
  type NetworkPreferences,
  type NetworkStartupValues,
} from './network-preferences.js'

export const name = NETWORK_SETTINGS_NAMESPACE
export const inject = ['settings']

export type Config = Volatile<NetworkPreferences>

/** A single volatile section validates cross-field invariants before any reference commits. */
export const Config = schema
  .transform(
    schema.object({
      lanEnabled: schema.union([schema.boolean(), schema.const(null)]).default(null),
      bindAddress: schema.union([schema.transform(schema.string(), NetworkPreferencesModel.normalizeLanAddress), schema.const(null)]).default(null),
      port: schema.union([schema.natural().max(65535), schema.const(null)]).default(null),
    }),
    value => preferencesSchema.parse(value),
  )
  .default({})
  .volatile()

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Immutable launch plan; desired preferences remain in the settings namespace. */
    dshfilesNetworkStartup: NetworkStartupValues
  }
}

/** Read the native section reference exactly once at activation. */
export const captureNetworkPreferences = (config: Config): NetworkStartupValues => NetworkPreferencesModel.startupValues(config.get())

export function apply(ctx: Context, config: Config): void {
  const startup = captureNetworkPreferences(config)
  ctx.provide('dshfilesNetworkStartup', startup)
  ctx.effect(() => ctx.settings.configure({ auto: false }))
}
