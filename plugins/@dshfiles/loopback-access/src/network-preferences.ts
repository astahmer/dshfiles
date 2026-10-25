import { isLoopbackHost, isWildcardHost, normalizeBindAddress } from '@deepseek-ai/dsh-host-webserver'
import { z } from 'zod'

export const NETWORK_SETTINGS_NAMESPACE = 'dshfiles-network-startup'

const lanAddressSchema = z.string().transform((value, context) => {
  try {
    return NetworkPreferencesModel.normalizeLanAddress(value)
  } catch {
    context.addIssue({ code: 'custom', message: 'Choose a concrete non-loopback IPv4 or IPv6 address.' })
    return z.NEVER
  }
})

/** Null means inherit the native profile fallback, not an explicit disabled state. */
export const preferencesSchema = z
  .object({
    lanEnabled: z.boolean().nullable().default(null),
    bindAddress: lanAddressSchema.nullable().default(null),
    port: z.number().int().min(0).max(65535).nullable().default(null),
    localhostEnabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((preferences, context) => {
    if (preferences.lanEnabled === true && preferences.bindAddress === null) {
      context.addIssue({ code: 'custom', path: ['bindAddress'], message: 'Choose an interface address before enabling LAN access.' })
    }
  })

export type NetworkPreferences = z.infer<typeof preferencesSchema>
type NetworkPreferencesInput = z.input<typeof preferencesSchema>

export interface NetworkStartupValues {
  readonly preferences: Readonly<NetworkPreferences>
  readonly host: string | null
  readonly port: number | null
  readonly localhostEnabled: boolean
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

  static normalize(input: NetworkPreferencesInput): NetworkPreferences {
    return preferencesSchema.parse(input)
  }

  /** Capture detached boot values. Saving desired settings never mutates this snapshot. */
  static startupValues(input: NetworkPreferences): NetworkStartupValues {
    const preferences = Object.freeze(NetworkPreferencesModel.normalize(input))
    return Object.freeze({
      preferences,
      host: preferences.lanEnabled === null ? null : preferences.lanEnabled ? preferences.bindAddress : '127.0.0.1',
      port: preferences.port,
      localhostEnabled: preferences.localhostEnabled,
    })
  }
}
