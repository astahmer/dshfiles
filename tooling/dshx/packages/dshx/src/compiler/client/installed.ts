import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Walk up from a resolved entry to the nearest package.json that names a package. */
function nearestPackageManifest(from: string): string | undefined {
  let directory = dirname(from)
  for (;;) {
    const candidate = join(directory, 'package.json')
    try {
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'))
      if (isObject(parsed) && typeof parsed.name === 'string' && parsed.name.length > 0) return candidate
    } catch {
      // Keep walking up.
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

async function packageManifestPath(packageId: string): Promise<string | undefined> {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve(`${packageId}/package.json`)
  } catch {
    // A package without an exported ./package.json still resolves through its entry.
  }
  try {
    return nearestPackageManifest(require.resolve(packageId))
  } catch {
    return undefined
  }
}

/**
 * Locale namespaces an already-installed client package declares in its
 * `dsh.client.locales`. `dshx check --fix` writes that field, so it is a build
 * artifact of the owning plugin rather than something parsed back out of its
 * bundle. Undefined means the package is not installed from here, which the
 * caller treats as "no sibling claim".
 */
export async function installedLocaleNamespaces(packageId: string): Promise<readonly string[] | undefined> {
  const manifestPath = await packageManifestPath(packageId)
  if (manifestPath === undefined) return undefined
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    return undefined
  }
  if (!isObject(manifest)) return undefined
  const dsh = isObject(manifest.dsh) ? manifest.dsh : undefined
  const client = isObject(dsh?.client) ? dsh.client : undefined
  const locales = client?.locales
  if (!Array.isArray(locales)) return undefined
  return locales.filter((value): value is string => typeof value === 'string')
}
