import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect'

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })))

const fileUrlSchema = Schema.String.check(Schema.isStartingWith('file:'))

/** `@scope/name/client` → `@scope/name`; `name/sub` → `name`. */
export const packageNameOf = (moduleName: string): string => {
  const parts = moduleName.split('/')
  return (moduleName.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/')
}

/** The DSH profile directory the Host booted from, when its base URL is a file URL. */
export class ProfileDirectory extends Context.Service<ProfileDirectory, Option.Option<string>>()('@dshfiles/agent-toolkit/ProfileDirectory') {
  static readonly layer = Layer.effect(
    ProfileDirectory,
    Effect.gen(function* () {
      const host = yield* HostContext
      const path = yield* Path.Path
      const baseUrl = Schema.decodeUnknownOption(fileUrlSchema)(host.ctx.baseUrl)
      if (Option.isNone(baseUrl)) return Option.none()
      return yield* path.fromFileUrl(new URL(baseUrl.value)).pipe(Effect.option)
    }),
  )
}

/** Installed package versions as the DSH profile resolves them. */
export class PackageVersions extends Context.Service<
  PackageVersions,
  { readonly read: (packages: readonly string[]) => Effect.Effect<Record<string, string | null>> }
>()('@dshfiles/agent-toolkit/PackageVersions') {
  static readonly layer = Layer.effect(
    PackageVersions,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const profile = yield* ProfileDirectory

      /** The `node_modules` directories Node searches from `base`, nearest first. */
      const nodeModulesChain = (base: string): string[] => {
        const directories: string[] = []
        for (let directory = base; ; directory = path.dirname(directory)) {
          if (path.basename(directory) !== 'node_modules') directories.push(path.join(directory, 'node_modules'))
          if (path.dirname(directory) === directory) return directories
        }
      }

      /**
       * The profile directory, then each `@deepseek-ai` bundle it installs: DSH's built-in plugins are those bundles'
       * dependencies, reachable only from the bundle's own (pnpm-isolated) location.
       */
      const searchBases = Effect.fnUntraced(function* (profileDirectory: string) {
        const scope = path.join(profileDirectory, 'node_modules', '@deepseek-ai')
        const bundles = yield* fs.readDirectory(scope).pipe(Effect.orElseSucceed(() => []))
        const resolved = yield* Effect.forEach(bundles, name => fs.realPath(path.join(scope, name)).pipe(Effect.option), { concurrency: 8 })
        return [profileDirectory, ...resolved.flatMap(Option.toArray)]
      })

      /** Loading package.json by absolute path reads packages whose `exports` hide it. */
      const versionOf = Effect.fnUntraced(function* (directories: readonly string[], name: string) {
        for (const directory of directories) {
          const text = yield* fs.readFileString(path.join(directory, name, 'package.json')).pipe(Effect.option)
          const manifest = Option.flatMap(text, decodeManifest)
          if (Option.isSome(manifest) && manifest.value.name === name) return manifest.value.version
        }
        return null
      })

      const read = Effect.fn('package versions read')(function* (packages: readonly string[]) {
        const bases = Option.isNone(profile) ? [] : yield* searchBases(profile.value)
        const directories = bases.flatMap(nodeModulesChain)
        const names = [...new Set(packages.map(packageNameOf))]
        yield* Effect.annotateCurrentSpan({ 'agent_toolkit.packages': names.length })
        const versions = yield* Effect.forEach(names, name => Effect.map(versionOf(directories, name), version => [name, version] as const), { concurrency: 8 })
        return Object.fromEntries(versions)
      })

      return PackageVersions.of({ read })
    }),
  )
}
