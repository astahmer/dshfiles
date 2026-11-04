import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { HostContext } from '@dshfiles/dshx/effect'
import { readWebStartupOverrides } from '@dshfiles/dshx/host'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { LoopbackAccess } from './access.js'
import type { LoopbackAccessStatus } from './api.js'
import { NETWORK_SETTINGS_NAMESPACE, type NetworkPreferences, type NetworkStartupValues } from './network-preferences.js'
import type {} from './startup.js'

/** The loopback adjunct could not bind its listeners; the plugin does not start. */
export class LoopbackStartFailed extends Schema.TaggedError<LoopbackStartFailed>()('LoopbackStartFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'Localhost access could not open its loopback listeners. Free the DSH port on 127.0.0.1 and ::1, then restart DSH.'
  }
}

/**
 * The localhost adjunct of a LAN-bound Web server, open for the plugin Scope and published as the
 * `dshfilesLoopbackAccess` Cordis service for other Host code.
 */
export class LoopbackAdjunct extends Context.Service<LoopbackAdjunct, { readonly status: Effect.Effect<LoopbackAccessStatus> }>()(
  '@dshfiles/loopback-access/LoopbackAdjunct',
) {
  static readonly layer = Layer.effect(
    LoopbackAdjunct,
    Effect.gen(function* () {
      const host = yield* HostContext
      const access = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const opened = new LoopbackAccess(host.ctx.webServer)
            await opened.start()
            return opened
          },
          catch: cause => new LoopbackStartFailed({ cause }),
        }),
        opened => Effect.promise(() => opened.close()),
      )
      yield* Effect.sync(() => host.ctx.provide('dshfilesLoopbackAccess', access))
      return LoopbackAdjunct.of({ status: Effect.sync(() => access.status()) })
    }).pipe(Effect.withSpan('loopback access start')),
  )
}

/** The Host refused the settings replacement; the cause carries its code and message. */
export class NetworkSettingsReplaceFailed extends Schema.TaggedError<NetworkSettingsReplaceFailed>()('NetworkSettingsReplaceFailed', {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return 'The network startup preferences could not be saved.'
  }
}

/** What the network section reads from the running Host: its settings row, native listener, webserver row and boot plan. */
export class NetworkHost extends Context.Service<
  NetworkHost,
  {
    readonly descriptor: Effect.Effect<Option.Option<{ readonly revision: number; readonly value: unknown }>>
    readonly settingsWritable: Effect.Effect<boolean>
    readonly replace: (preferences: NetworkPreferences, expectedRevision: number) => Effect.Effect<void, NetworkSettingsReplaceFailed>
    readonly listener: Effect.Effect<{ readonly host: string; readonly port: number | undefined }>
    /** The native `webserver` Loader row's config, when the profile declares that row. */
    readonly webserverConfig: Effect.Effect<Option.Option<unknown>>
    readonly cliOverrides: Effect.Effect<{ readonly host?: string | undefined; readonly port?: number | undefined }>
    readonly boot: NetworkStartupValues
  }
>()('@dshfiles/loopback-access/NetworkHost') {
  static readonly layer = Layer.effect(
    NetworkHost,
    Effect.gen(function* () {
      const host = yield* HostContext
      const ctx = host.ctx
      return NetworkHost.of({
        descriptor: Effect.sync(() =>
          Option.fromUndefinedOr(ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === NETWORK_SETTINGS_NAMESPACE)),
        ),
        settingsWritable: Effect.sync(() => ctx.settings.writable),
        replace: (preferences, expectedRevision) =>
          Effect.tryPromise({
            try: () => ctx.settings.replace(NETWORK_SETTINGS_NAMESPACE, preferences, expectedRevision),
            catch: cause => new NetworkSettingsReplaceFailed({ cause }),
          }),
        listener: Effect.sync(() => ({ host: ctx.webServer.host, port: ctx.webServer.port })),
        webserverConfig: Effect.sync(() =>
          Option.map(
            Option.fromUndefinedOr(
              ctx.configEditor.entries().find(entry => entry.options.id === 'webserver' && entry.options.name === '@deepseek-ai/dsh-host-webserver'),
            ),
            row => row.options.config,
          ),
        ),
        cliOverrides: Effect.sync(() => readWebStartupOverrides(ctx)),
        boot: ctx.dshfilesNetworkStartup,
      })
    }),
  )
}
