import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Effect, FileSystem, Layer, Option } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { BundleLabels } from './bundle-labels-promise.js'
import { InstalledVersions } from './installed-versions.js'
import { NativeSettings } from './native-settings-promise.js'
import { ReleaseCheck } from './release-check.js'
import { settingsShellSettings } from './settings.js'
import { SettingsTools } from './settings-tools.js'
import { settingsShellApi } from './shell-api.js'
import { PORTED_FROM, WELCOME_PORTED_FROM } from './upstream.js'

/** A newer DSH ships different native sources than the ones this plugin ports; say which to refresh. */
const PortDriftWarning = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const versions = yield* InstalledVersions
    const logger = host.ctx.logger('dshfiles-settings-shell')
    for (const [ported, installed] of [
      [PORTED_FROM, versions.upstream],
      [WELCOME_PORTED_FROM, versions.welcome],
    ] as const) {
      if (installed === null || installed === ported.version) continue
      logger.warn(
        'settings-shell: ported from %s@%s but DSH ships %s; refresh plugins/@dshfiles/settings-shell/src/native from the new package',
        ported.packageName,
        ported.version,
        installed,
      )
    }
  }),
)

const settingsShellLayer = Layer.mergeAll(SettingsTools.layer, ReleaseCheck.layer, BundleLabels.layer, PortDriftWarning).pipe(
  Layer.provideMerge(Layer.mergeAll(InstalledVersions.layer, NativeSettings.layer)),
  Layer.provideMerge(Layer.merge(nodeFileSystemLayer, FetchHttpClient.layer)),
)

const documentPath = Effect.fn('settings-shell document path read')(function* () {
  const native = yield* NativeSettings
  const fs = yield* FileSystem.FileSystem
  const path = yield* native.documentPath
  if (Option.isNone(path)) return { path: null, exists: false }
  // The desktop opener verifies paths against their real location (macOS temp homes sit behind /var → /private/var).
  const real = yield* Effect.option(fs.realPath(path.value))
  return Option.match(real, { onNone: () => ({ path: path.value, exists: false }), onSome: resolved => ({ path: resolved, exists: true }) })
})

export default DshxPlugin.make({
  name: '@dshfiles/settings-shell',
  settings: [settingsShellSettings],
  layer: settingsShellLayer,
  apis: [
    Api.bind(settingsShellApi, {
      documentPath,
      bundleLabels: () => BundleLabels.use(labels => labels.read),
      upstream: () =>
        InstalledVersions.use(versions =>
          Effect.succeed({
            portedFrom: PORTED_FROM.version,
            installed: versions.upstream,
            stale: versions.upstream !== null && versions.upstream !== PORTED_FROM.version,
          }),
        ),
      releaseStatus: () => ReleaseCheck.use(check => check.status),
      list: input => SettingsTools.use(tools => tools.list(input)),
      set: input => SettingsTools.use(tools => tools.set(input)),
      unset: input => SettingsTools.use(tools => tools.unset(input)),
      publishSearchEntries: input => SettingsTools.use(tools => tools.publishSearchEntries(input.entries)),
    }),
  ],
})
