import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'

/**
 * Whether a plugin's bundles still match the sources their last build read. Kept free of relative imports so
 * scripts/profile-sync.ts can load this source file under Node type stripping on a checkout where dshx is not built;
 * callers hand in their own JSON decode boundary.
 */

type DecodeJson = <Schema extends z.ZodType>(schema: Schema, text: string) => z.output<Schema>

const dependencyManifestSchema = z.object({ sources: z.array(z.string()), hashes: z.record(z.string(), z.string().nullable()).optional() })
const packageScriptsSchema = z.looseObject({ scripts: z.record(z.string(), z.string()).default({}) })

export type BundleFreshnessReport =
  | { readonly status: 'fresh' | 'not-buildable' | 'unbuilt' }
  | {
      readonly status: 'stale'
      /** The bundle file under dist/, e.g. `client.js`. */
      readonly bundle: string
      /** The plugin-relative source that changed or disappeared; null when the bundle itself is gone. */
      readonly source: string | null
      readonly reason: 'bundle-missing' | 'source-missing' | 'source-changed'
    }

/**
 * DSH loads a dist as it is, so after a base change or a failed build an old bundle boots against newer neighbours and
 * fails on imports. A source newer than its bundle counts only when its content differs from the hash the build
 * recorded, since a jj checkout rewrites files it leaves unchanged.
 */
const inspect = (input: { readonly directory: string; readonly decodeJson: DecodeJson }): BundleFreshnessReport => {
  const packagePath = join(input.directory, 'package.json')
  if (!existsSync(packagePath) || input.decodeJson(packageScriptsSchema, readFileSync(packagePath, 'utf8')).scripts.build === undefined)
    return { status: 'not-buildable' }
  const distDirectory = join(input.directory, 'dist')
  if (!existsSync(join(distDirectory, 'index.js'))) return { status: 'unbuilt' }
  for (const manifestFile of readdirSync(distDirectory).filter(file => file.endsWith('.js.deps.json'))) {
    const bundle = manifestFile.slice(0, -'.deps.json'.length)
    const bundlePath = join(distDirectory, bundle)
    if (!existsSync(bundlePath)) return { status: 'stale', bundle, source: null, reason: 'bundle-missing' }
    const builtAt = statSync(bundlePath).mtimeMs
    const manifest = input.decodeJson(dependencyManifestSchema, readFileSync(join(distDirectory, manifestFile), 'utf8'))
    for (const source of manifest.sources.filter(path => !path.includes('node_modules/'))) {
      const sourcePath = resolve(input.directory, source)
      if (!existsSync(sourcePath)) return { status: 'stale', bundle, source, reason: 'source-missing' }
      if (statSync(sourcePath).mtimeMs <= builtAt) continue
      const recorded = manifest.hashes?.[source]
      if (recorded === undefined || recorded !== createHash('sha256').update(readFileSync(sourcePath)).digest('hex'))
        return { status: 'stale', bundle, source, reason: 'source-changed' }
    }
  }
  return { status: 'fresh' }
}

export class BundleFreshness {
  static readonly inspect = inspect
}
