import { isDeepStrictEqual } from 'node:util'
import { networkInterfaces } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-settings'
import { bindUrlHost, isLoopbackHost } from '@deepseek-ai/dsh-host-webserver'
import { readWebStartupOverrides } from '@dshfiles/dshx/host'
import { PluginApiError } from '@dshfiles/dshx/api'
import { z } from 'zod'
import type { LoopbackAccess } from './access.js'
import { networkSaveSchema, type NetworkForm, type NetworkSnapshot } from './network-api.js'
import {
  NETWORK_SETTINGS_NAMESPACE,
  NetworkPreferencesModel,
  preferencesSchema,
  type NetworkPreferences,
  type NetworkStartupValues,
} from './network-preferences.js'

const rawObject = z.record(z.string(), z.unknown())
const expression = z.object({ __jsExpr: z.string() }).strict()

/** Only our explicit native startup delegation is managed; never reinterpret custom profile code. */
const isManagedNetworkConfiguration = (value: z.infer<typeof rawObject>): boolean => {
  if (Object.hasOwn(value, '__jsExpr')) return false
  const host = expression.safeParse(value.host)
  const port = expression.safeParse(value.port)
  return (
    host.success &&
    port.success &&
    host.data.__jsExpr.startsWith('ctx.webStartup.host ?? ctx.dshfilesNetworkStartup.host ??') &&
    port.data.__jsExpr.startsWith('ctx.webStartup.port ?? ctx.dshfilesNetworkStartup.port ??')
  )
}

const localNetworkAddresses = (): NetworkSnapshot['addresses'] => {
  const result: NetworkSnapshot['addresses'] = []
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

export class NetworkController {
  readonly #ctx: Context
  readonly #access: LoopbackAccess
  readonly #boot: NetworkStartupValues
  #pending: Promise<NetworkSnapshot | undefined> = Promise.resolve(undefined)

  constructor(ctx: Context, access: LoopbackAccess, boot: NetworkStartupValues) {
    this.#ctx = ctx
    this.#access = access
    this.#boot = boot
  }

  #descriptor() {
    const descriptor = this.#ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === NETWORK_SETTINGS_NAMESPACE)
    if (descriptor === undefined)
      throw new PluginApiError('Network startup preferences are unavailable. Restart DSH to load the updated plugin.', { code: 'network-settings-unavailable' })
    return descriptor
  }

  snapshot(): NetworkSnapshot {
    const descriptor = this.#descriptor()
    const native = this.#ctx.webServer
    const port = native.port
    if (port === undefined) throw new Error('The native Web listener has not initialized.')
    const preferences = preferencesSchema.parse(descriptor.value)
    const saved = preferencesToForm(preferences, native.host, port)
    const applied = preferencesToForm(this.#boot.preferences, native.host, port)
    const current = this.#access.status()
    const row = this.#ctx.configEditor.entries().find(entry => entry.options.id === 'webserver' && entry.options.name === '@deepseek-ai/dsh-host-webserver')
    const raw = rawObject.safeParse(row?.options.config)
    const managed = row !== undefined && raw.success && isManagedNetworkConfiguration(raw.data)
    const unsupported = row === undefined || !raw.success || Object.hasOwn(raw.data, '__jsExpr')
    const integration = managed ? 'managed' : unsupported ? 'unsupported' : 'needs-setup'
    const overrides = readWebStartupOverrides(this.#ctx)
    return {
      revision: descriptor.revision,
      writable: this.#ctx.settings.writable && managed,
      saved,
      active: {
        host: native.host,
        port,
        localhostEnabled: isLoopbackHost(native.host) || current.state === 'forwarding',
        urls: [...new Set([current.upstreamOrigin, current.localhostOrigin].filter((origin): origin is string => origin !== null))],
      },
      addresses: localNetworkAddresses(),
      cliOverrides: { host: overrides.host ?? null, port: overrides.port ?? null },
      pendingRestart: !isDeepStrictEqual(intendedBinding(saved), intendedBinding(applied)),
      integration,
      unavailableReason: managed
        ? null
        : 'This profile overrides the native network configuration. Install the Network access startup wiring and restart DSH before editing it here.',
    }
  }

  save(input: z.infer<typeof networkSaveSchema>, signal: AbortSignal): Promise<NetworkSnapshot> {
    const parsed = networkSaveSchema.parse(input)
    const change = this.#pending.then(async () => {
      signal.throwIfAborted()
      const before = this.snapshot()
      if (!before.writable)
        throw new PluginApiError(before.unavailableReason ?? 'Network settings are read-only on this Host.', { code: 'network-settings-read-only' })
      if (before.revision !== parsed.expectedRevision)
        throw new PluginApiError('Network settings changed elsewhere. Reload the page before saving again.', { code: 'network-settings-conflict' })
      if (parsed.lanEnabled && !before.addresses.some(item => item.address === parsed.bindAddress))
        throw new PluginApiError('The selected LAN address is no longer available. Choose a current interface address.', {
          code: 'network-address-unavailable',
        })
      const preferences = NetworkPreferencesModel.normalize({
        lanEnabled: parsed.lanEnabled,
        bindAddress: parsed.bindAddress,
        port: parsed.port,
      })
      signal.throwIfAborted()
      // Every owned field is volatile: only desired preferences change. The
      // upstream startup provider and native listener retain their boot values.
      // Replace the owned section so a legacy localhost flag is not persisted again.
      await this.#ctx.settings.replace(NETWORK_SETTINGS_NAMESPACE, preferences, parsed.expectedRevision)
      return this.snapshot()
    })
    this.#pending = change.catch(() => undefined)
    return change
  }
}
