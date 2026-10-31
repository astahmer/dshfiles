import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { z } from 'zod'

const manifestSchema = z.object({ name: z.string(), version: z.string() })

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
      const manifest = manifestSchema.safeParse(load(path))
      if (manifest.success && manifest.data.name === name) return manifest.data.version
    }
    return null
  }
  return Object.fromEntries([...new Set(input.packages.map(packageNameOf))].map(name => [name, versionOf(name)]))
}
