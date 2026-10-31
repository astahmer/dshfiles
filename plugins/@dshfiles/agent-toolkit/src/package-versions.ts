import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'

const manifestSchema = Schema.Struct({ name: Schema.String, version: Schema.String })

export class PackageVersionsReadError extends Schema.TaggedError<PackageVersionsReadError>()('PackageVersionsReadError', {
  message: Schema.String,
}) {}

/** `@scope/name/client` → `@scope/name`; `name/sub` → `name`. */
export const packageNameOf = (moduleName: string): string => {
  const parts = moduleName.split('/')
  return (moduleName.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/')
}

/**
 * Reads each package's own package.json from the node_modules directories Node would search from `bases`, in order.
 * Loading the file by absolute path instead of `require.resolve('<name>/package.json')` reads packages whose `exports`
 * hide it.
 */
export const readPackageVersions = (input: { readonly packages: readonly string[]; readonly bases: readonly string[] }): Record<string, string | null> => {
  const load = createRequire(import.meta.url)
  const searchPaths = input.bases.flatMap(base => createRequire(join(base, 'package.json')).resolve.paths('x') ?? [])
  const versionOf = (name: string): string | null => {
    for (const directory of searchPaths) {
      const path = join(directory, name, 'package.json')
      if (!existsSync(path)) continue
      const manifest = load(path)
      if (Schema.is(manifestSchema)(manifest) && manifest.name === name) return manifest.version
    }
    return null
  }
  return Object.fromEntries([...new Set(input.packages.map(packageNameOf))].map(name => [name, versionOf(name)]))
}

export const readPackageVersionsEffect = Effect.fn('agent toolkit versions')(
  (input: { readonly packages: readonly string[]; readonly bases: () => Promise<readonly string[]> }) =>
    Effect.tryPromise({
      try: async () => readPackageVersions({ packages: input.packages, bases: await input.bases() }),
      catch: () => new PackageVersionsReadError({ message: 'Could not read installed package versions.' }),
    }),
)
